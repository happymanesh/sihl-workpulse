import { WorkPulseRole, prisma } from "@workpulse/db";
import { IdentityService } from "../src/modules/auth/identity.service";
import type { SynapseDirectoryService, SynapseUserRecord } from "../src/modules/auth/synapse-directory.service";
import type { SynapseSessionPayload } from "../src/modules/auth/synapse-session.service";

/**
 * Users link to employees by EMPLOYEE CODE, never by email (2026-10-07).
 *
 * Real database for workPulse's own tables (this codebase does not mock Prisma); the Synapse
 * directory is stubbed, because what is under test is how workPulse uses what Synapse says —
 * the directory's own SQL (including its suspension check) runs against Synapse.
 */
const RUN = `idlink-${Date.now()}`;
const canRun = Boolean(process.env.DATABASE_URL);

(canRun ? describe : describe.skip)("Identity links users to employees by employee code (e2e)", () => {
  const base = 950_000 + (Date.now() % 10_000);
  const roleCode = `${RUN}-ROLE`;
  const shared = `${RUN}-team@sihl.example`;
  const directoryUsers = new Map<number, SynapseUserRecord | null>();

  const directory = {
    findActiveUser: async (uid: number) => directoryUsers.get(uid) ?? null,
    findRoleCodes: async () => [roleCode],
  } as unknown as SynapseDirectoryService;
  const identity = new IdentityService(directory);

  const session = (uid: number) => ({ userUid: uid, companyCode: "SIHL", hierarchyCode: "0200" }) as SynapseSessionPayload;
  const person = (uid: number, employeeCode: string | null, email: string | null): SynapseUserRecord => ({
    uid,
    username: `${RUN}-${uid}`,
    fullName: "Test",
    email,
    employeeCode,
    isActive: true,
  });

  let empA: string;
  let empB: string;

  beforeAll(async () => {
    await prisma.synapseRoleMap.create({ data: { synapseRoleCode: roleCode, workPulseRole: WorkPulseRole.EMPLOYEE } });
    // Two people behind ONE team mailbox — the case email linking got wrong.
    empA = (await prisma.employee.create({ data: { employeeCode: `${RUN}-A`, name: "A", email: shared } })).id;
    empB = (await prisma.employee.create({ data: { employeeCode: `${RUN}-B`, name: "B", email: shared } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { synapseUsername: { startsWith: RUN } } });
    await prisma.employee.deleteMany({ where: { employeeCode: { startsWith: RUN } } });
    await prisma.synapseRoleMap.deleteMany({ where: { synapseRoleCode: roleCode } });
    await prisma.$disconnect();
  });

  it("links each user to their own employee even when they share a mailbox", async () => {
    directoryUsers.set(base, person(base, `${RUN}-B`, shared));
    directoryUsers.set(base + 1, person(base + 1, `${RUN}-A`, shared));

    const b = await identity.resolve(session(base));
    const a = await identity.resolve(session(base + 1));

    expect(b?.employeeId).toBe(empB);
    expect(a?.employeeId).toBe(empA);
    expect(a?.isEmployeeUnlinked).toBe(false);
  });

  it("a user without an employee code is flagged unlinked, whatever their email", async () => {
    directoryUsers.set(base + 2, person(base + 2, null, shared));
    const u = await identity.resolve(session(base + 2));
    expect(u?.employeeId).toBeNull();
    expect(u?.isEmployeeUnlinked).toBe(true);
  });

  it("an unknown code stays unlinked rather than guessing", async () => {
    directoryUsers.set(base + 3, person(base + 3, `${RUN}-NOPE`, shared));
    const u = await identity.resolve(session(base + 3));
    expect(u?.employeeId).toBeNull();
  });

  it("a user the directory refuses (inactive or suspended in Synapse) gets nothing", async () => {
    directoryUsers.set(base + 4, null);
    expect(await identity.resolve(session(base + 4))).toBeNull();
  });
});
