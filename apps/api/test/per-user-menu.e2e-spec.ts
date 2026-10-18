import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { prisma } from "@workpulse/db";
import { AppModule } from "../src/app.module";
import { MenuService } from "../src/modules/auth/menu.service";
import type { AuthenticatedUser } from "../src/modules/auth/identity.service";

/**
 * Per-person menus.
 *
 * What these assert, above everything else, is that this cannot become a
 * permission: it only ever subtracts, only an administrator may touch it, and
 * every change is in the audit trail.
 */

const RUN = `e2e-menu-${Date.now()}`;

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "test-user",
    synapseUserUid: 999,
    username: "tester",
    fullName: "Test User",
    companyCode: "SIHL",
    hierarchyCode: "0200",
    roles: ["SYSTEM_ADMIN"],
    employeeId: null,
    isEmployeeUnlinked: false,
    hiddenNavKeys: [],
    ...overrides,
  } as AuthenticatedUser;
}

const canRun = Boolean(process.env.DATABASE_URL);
const d = canRun ? describe : describe.skip;

d("Per-user menus (e2e)", () => {
  let app: INestApplication;
  let menus: MenuService;

  let subjectUid: number;
  let originalHidden: string[];

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    await app.init();
    menus = app.get(MenuService);

    const user = await prisma.user.findFirst({
      select: { synapseUserUid: true, hiddenNavKeys: true },
      orderBy: { synapseUsername: "asc" },
    });
    if (!user) throw new Error("No workPulse user has signed in; nothing to adjust.");

    subjectUid = user.synapseUserUid;
    originalHidden = user.hiddenNavKeys;
  }, 60_000);

  afterAll(async () => {
    if (subjectUid !== undefined) {
      await prisma.user.update({
        where: { synapseUserUid: subjectUid },
        data: { hiddenNavKeys: originalHidden },
      });
    }
    await prisma.auditLog.deleteMany({
      where: { entityType: "User", action: "menu_changed", reason: { contains: RUN } },
    });
    await app?.close();
  }, 60_000);

  it("refuses anybody who is not a system administrator", async () => {
    for (const roles of [["DEPARTMENT_HEAD"], ["MANAGER"], ["AUDIT"], ["EMPLOYEE"]]) {
      await expect(
        menus.setHidden(actor({ roles: roles as AuthenticatedUser["roles"] }), {
          synapseUserUid: subjectUid,
          hiddenNavKeys: ["/mis"],
          reason: RUN,
        }),
      ).rejects.toThrow(/system administrator/);
    }
  });

  it("will not hide somebody's own tasks", async () => {
    await expect(
      menus.setHidden(actor(), {
        synapseUserUid: subjectUid,
        hiddenNavKeys: ["/tasks"],
        reason: RUN,
      }),
    ).rejects.toThrow(/cannot be hidden/);
  });

  it("refuses something that is not a route", async () => {
    await expect(
      menus.setHidden(actor(), {
        synapseUserUid: subjectUid,
        hiddenNavKeys: ["DROP TABLE users"],
        reason: RUN,
      }),
    ).rejects.toThrow(/not a menu route/);
  });

  it("hides what it is given, de-duplicated, and audits before and after", async () => {
    const result = await menus.setHidden(actor(), {
      synapseUserUid: subjectUid,
      hiddenNavKeys: ["/mis", "/mis", " /command-centre ", ""],
      reason: `${RUN} keep their screen to their own work`,
    });

    expect(result.hiddenNavKeys.sort()).toEqual(["/command-centre", "/mis"]);

    const entry = await prisma.auditLog.findFirst({
      where: { entityType: "User", action: "menu_changed" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry?.beforeJson).toMatchObject({ hiddenNavKeys: originalHidden });
    expect(entry?.afterJson).toMatchObject({ hiddenNavKeys: ["/mis", "/command-centre"] });
    expect(entry?.reason).toContain("their own work");
  });

  it("lists everybody with a shortened menu, for review", async () => {
    const rows = await menus.adjusted(actor({ roles: ["AUDIT"] }));
    expect(rows.some((r) => r.synapseUserUid === subjectUid)).toBe(true);
  });

  it("empties the list again when everything is ticked back on", async () => {
    const result = await menus.setHidden(actor(), {
      synapseUserUid: subjectUid,
      hiddenNavKeys: [],
      reason: `${RUN} restored`,
    });
    expect(result.hiddenNavKeys).toEqual([]);
  });

  it("stores nothing that could widen anybody's access", async () => {
    // The column holds a hide list and nothing else. There is deliberately no
    // "extra entries" field anywhere on the user, because an additive menu
    // would be a second permission model disagreeing with the roles.
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names).toContain("hiddenNavKeys");
    expect(names.filter((n) => /nav|menu/i.test(n))).toEqual(["hiddenNavKeys"]);
  });
});
