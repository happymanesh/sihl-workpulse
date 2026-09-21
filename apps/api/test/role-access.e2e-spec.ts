import { BadRequestException, ForbiddenException, INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { WorkPulseRole, prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { RoleGrantService } from "../src/modules/auth/role-grant.service";
import { RoleMapService } from "../src/modules/auth/role-map.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

const RUN = `role-${Date.now()}`;
const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)("Role grants and mappings (e2e)", () => {
  let app: INestApplication;
  let grants: RoleGrantService;
  let maps: RoleMapService;

  /** A real workPulse user row, created for this suite and removed after. */
  let subjectUid: number;
  let subjectId: string;
  let adminUid: number;
  let adminId: string;
  let serviceUid: number;

  const admin = (): AuthenticatedUser =>
    ({
      id: adminId,
      synapseUserUid: adminUid,
      username: `${RUN}-admin`,
      fullName: "Admin",
      companyCode: "SIHL",
      hierarchyCode: "9999",
      roles: [WorkPulseRole.SYSTEM_ADMIN],
      employeeId: null,
      isEmployeeUnlinked: true,
    }) as AuthenticatedUser;

  const nonAdmin = (): AuthenticatedUser => ({ ...admin(), roles: [WorkPulseRole.MANAGER] }) as AuthenticatedUser;
  const auditor = (): AuthenticatedUser => ({ ...admin(), roles: [WorkPulseRole.AUDIT] }) as AuthenticatedUser;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    grants = app.get(RoleGrantService);
    maps = app.get(RoleMapService);

    // Uids well outside Synapse's real range, so nothing here can collide with
    // a live directory record.
    const base = 900_000 + (Date.now() % 10_000);
    subjectUid = base;
    adminUid = base + 1;
    serviceUid = base + 2;

    const employee = await prisma.employee.findFirst({ where: { isActive: true } });

    const subject = await prisma.user.create({
      data: { synapseUserUid: subjectUid, synapseUsername: `${RUN}-subject`, isEmployeeUnlinked: true },
    });
    subjectId = subject.id;

    const adminUser = await prisma.user.create({
      data: { synapseUserUid: adminUid, synapseUsername: `${RUN}-admin`, isEmployeeUnlinked: true },
    });
    adminId = adminUser.id;

    // A user WITH an employee record, to prove INTEGRATION_SERVICE is refused
    // on a person.
    await prisma.user.create({
      data: {
        synapseUserUid: serviceUid,
        synapseUsername: `${RUN}-person`,
        employeeId: employee?.id,
        isEmployeeUnlinked: !employee,
      },
    });
  }, 60_000);

  afterAll(async () => {
    const ids = [subjectUid, adminUid, serviceUid];
    const users = await prisma.user.findMany({
      where: { synapseUserUid: { in: ids } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { entityType: "User", entityId: { in: users.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({ where: { synapseUserUid: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "SynapseRoleMap", reason: { contains: RUN } } });
    await app.close();
  }, 60_000);

  // -------------------------------------------------------------------------

  describe("granting", () => {
    it("grants a role that Synapse has no concept of", async () => {
      const r = await grants.grant(admin(), {
        synapseUserUid: subjectUid,
        role: WorkPulseRole.DEPARTMENT_HEAD,
      });
      expect(r.changed).toBe(true);
      expect(r.localRoles).toContain(WorkPulseRole.DEPARTMENT_HEAD);
    }, 30_000);

    it("is idempotent", async () => {
      const r = await grants.grant(admin(), {
        synapseUserUid: subjectUid,
        role: WorkPulseRole.DEPARTMENT_HEAD,
      });
      expect(r.changed).toBe(false);
    }, 30_000);

    it("refuses a caller who is not a system administrator", async () => {
      await expect(
        grants.grant(nonAdmin(), { synapseUserUid: subjectUid, role: WorkPulseRole.MANAGER }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuses a user who has never signed in", async () => {
      await expect(
        grants.grant(admin(), { synapseUserUid: 999_999_99, role: WorkPulseRole.MANAGER }),
      ).rejects.toThrow(/never signed in/i);
    });

    describe("sensitive roles", () => {
      it("requires a written reason", async () => {
        await expect(
          grants.grant(admin(), { synapseUserUid: subjectUid, role: WorkPulseRole.AUDIT }),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("grants with one", async () => {
        const r = await grants.grant(admin(), {
          synapseUserUid: subjectUid,
          role: WorkPulseRole.AUDIT,
          reason: `${RUN} joint CTO and Compliance sign-off`,
        });
        expect(r.localRoles).toContain(WorkPulseRole.AUDIT);
      }, 30_000);

      it("refuses AUDIT granted to yourself", async () => {
        // A SYSTEM_ADMIN who could hand themselves AUDIT would make the Phase 6
        // and 7 separation theatre - AUDIT exists to watch the people who
        // administer the system.
        await expect(
          grants.grant(admin(), {
            synapseUserUid: adminUid,
            role: WorkPulseRole.AUDIT,
            reason: "I need it",
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it("refuses EXECUTIVE_RESTRICTED granted to yourself", async () => {
        await expect(
          grants.grant(admin(), {
            synapseUserUid: adminUid,
            role: WorkPulseRole.EXECUTIVE_RESTRICTED,
            reason: "I need it",
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      it("allows a non-sensitive self-grant", async () => {
        // The bar is on roles that read people, not on administration itself.
        const r = await grants.grant(admin(), {
          synapseUserUid: adminUid,
          role: WorkPulseRole.PROJECT_MANAGER,
        });
        expect(r.changed).toBe(true);
      }, 30_000);
    });

    it("refuses INTEGRATION_SERVICE on a person", async () => {
      await expect(
        grants.grant(admin(), {
          synapseUserUid: serviceUid,
          role: WorkPulseRole.INTEGRATION_SERVICE,
          reason: "Command Centre feed",
        }),
      ).rejects.toThrow(/service accounts/i);
    });

    it("audits the grant with actor and reason", async () => {
      const entries = await prisma.auditLog.findMany({
        where: { entityType: "User", entityId: subjectId, action: "GRANT_ROLE" },
        orderBy: { createdAt: "desc" },
      });
      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].actorId).toBe(adminId);
      expect(entries.some((e) => e.reason?.includes(RUN))).toBe(true);
    }, 30_000);
  });

  describe("revoking", () => {
    it("removes the role and audits it", async () => {
      const r = await grants.revoke(admin(), {
        synapseUserUid: subjectUid,
        role: WorkPulseRole.DEPARTMENT_HEAD,
        reason: `${RUN} no longer required`,
      });
      expect(r.localRoles).not.toContain(WorkPulseRole.DEPARTMENT_HEAD);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "User", entityId: subjectId, action: "REVOKE_ROLE" },
      });
      expect(entries.length).toBeGreaterThan(0);
    }, 30_000);

    it("is idempotent", async () => {
      const r = await grants.revoke(admin(), {
        synapseUserUid: subjectUid,
        role: WorkPulseRole.DEPARTMENT_HEAD,
      });
      expect(r.changed).toBe(false);
    }, 30_000);
  });

  describe("visibility", () => {
    it("lists holders to an administrator and to Audit", async () => {
      await expect(grants.holders(admin())).resolves.toBeDefined();
      await expect(grants.holders(auditor())).resolves.toBeDefined();
    }, 30_000);

    it("refuses everyone else", async () => {
      // A sensitive role nobody can enumerate is a role nobody is reviewing.
      await expect(grants.holders(nonAdmin())).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("reports which roles nobody can reach", async () => {
      const coverage = await grants.coverage();
      const byRole = new Map(coverage.map((c) => [c.role, c]));

      // Mapped from Synapse since Phase 0.
      expect(byRole.get(WorkPulseRole.SYSTEM_ADMIN)?.isUnreachable).toBe(false);
      // Granted above.
      expect(byRole.get(WorkPulseRole.AUDIT)?.isUnreachable).toBe(false);

      for (const c of coverage) {
        expect(typeof c.isUnreachable).toBe("boolean");
      }
    }, 30_000);
  });

  describe("mappings", () => {
    it("refuses to map CLIENT_SELF at any privilege level", async () => {
      // Held by external clients. Mapping it - even to EMPLOYEE - would give
      // customers workPulse accounts and desk cards.
      await expect(
        maps.upsert(admin(), {
          synapseRoleCode: "CLIENT_SELF",
          workPulseRole: WorkPulseRole.EMPLOYEE,
          reason: "tidying the map",
        }),
      ).rejects.toThrow(/external clients/i);
    });

    it("refuses a Synapse role that does not exist", async () => {
      // A row pointing at a role Synapse has never heard of grants nothing and
      // looks like coverage.
      await expect(
        maps.upsert(admin(), {
          synapseRoleCode: `${RUN}-NOPE`,
          workPulseRole: WorkPulseRole.AUDIT,
          reason: "invented",
        }),
      ).rejects.toThrow(/no role/i);
    }, 30_000);

    it("refuses a caller who is not a system administrator", async () => {
      await expect(
        maps.upsert(nonAdmin(), {
          synapseRoleCode: "ADMIN",
          workPulseRole: WorkPulseRole.SYSTEM_ADMIN,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("shows the real Synapse catalogue alongside the mappings", async () => {
      const view = await maps.list(admin());
      expect(Array.isArray(view.mappings)).toBe(true);
      const clientSelf = view.synapseRoles.find((r) => r.roleCode === "CLIENT_SELF");
      if (clientSelf) expect(clientSelf.isMappable).toBe(false);
    }, 30_000);
  });
});
