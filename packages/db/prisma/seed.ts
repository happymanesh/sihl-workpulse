/**
 * Local dev seed data. Run via `npm run db:seed`.
 *
 * This does NOT seed Employee/Department - those come exclusively from the
 * Frappe HR sync job (apps/api/src/jobs/frappe-hr-sync.job.ts), which in
 * FRAPPE_SYNC_MODE=mock generates realistic fixture employees/departments on
 * its own. Run `npm run sync:frappe-hr` after this seed to populate them.
 *
 * It also does NOT seed users. Identity belongs to Synapse
 * (docs/synapse-integration.md): a workPulse User row is created lazily on
 * first successful sign-in. Inventing local users here would create exactly the
 * second identity store the integration exists to avoid.
 *
 * What it does seed is the Synapse-role -> workPulse-role mapping, which is
 * workPulse's own configuration and has to exist before the first sign-in can
 * resolve to anything above EMPLOYEE.
 *
 * IMPORTANT: ROLE_MAP below is authoritative, not additive. Any mapping NOT
 * listed here is deactivated when this runs - including one an administrator
 * added through the Access screen. So a mapping that should survive a
 * redeployment has to be added to this list as well, or the next seed quietly
 * revokes it and the people who depended on it lose access at the next sign-in.
 */
import { PrismaClient, WorkPulseRole } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Task Types (BRS Section 13). The Task Type is what switches on the optional
 * governance behaviours, which is how the BRS reconciles "everything is a task"
 * with "not every task needs verification and evidence".
 *
 * Appendix F's agreed default: Critical, Compliance-sourced and Management
 * tasks require Verification before Closure; everything else auto-closes after
 * a grace period.
 */
const TASK_TYPES = [
  {
    code: "ROUTINE",
    name: "Routine",
    requiresVerification: false,
    requiresEvidence: false,
    requiresMakerChecker: false,
    autoCloseAfterHours: 24,
  },
  {
    code: "OPERATIONAL",
    name: "Operational",
    requiresVerification: false,
    requiresEvidence: true,
    requiresMakerChecker: false,
    autoCloseAfterHours: 48,
  },
  {
    code: "COMPLIANCE",
    name: "Compliance",
    requiresVerification: true,
    requiresEvidence: true,
    requiresMakerChecker: true,
    autoCloseAfterHours: null,
  },
  {
    code: "CRITICAL_OPS",
    name: "Critical Operations",
    requiresVerification: true,
    requiresEvidence: true,
    requiresMakerChecker: true,
    autoCloseAfterHours: null,
  },
  {
    code: "MANAGEMENT",
    name: "Management Direction",
    requiresVerification: true,
    requiresEvidence: false,
    requiresMakerChecker: false,
    autoCloseAfterHours: null,
  },
  {
    code: "PROJECT",
    name: "Project",
    requiresVerification: false,
    requiresEvidence: true,
    requiresMakerChecker: false,
    autoCloseAfterHours: null,
  },
] as const;

/**
 * Maps Synapse's real RoleMaster.roleCode values (read from Synapse on
 * 8 Sep 2026) onto workPulse roles.
 *
 * Two roles are deliberately NOT mapped, and both omissions are load-bearing:
 *
 *   CLIENT_SELF - external clients, not staff. Synapse authenticates customers
 *                 as well as employees. Mapping this, or relying on any
 *                 default-role fallback, would hand a client a workPulse
 *                 account and a desk card. IdentityService denies access to
 *                 anyone whose roles map to nothing, precisely so this stays
 *                 safe if someone adds a fallback later.
 *
 *   AUDIT       - BRS Appendix F requires joint CTO + Compliance sign-off, so
 *                 it is granted as a local role on a named user, never handed
 *                 out wholesale by a role mapping.
 *
 * Add a row here only when SIHL has decided that role should have workPulse
 * access. Absence is the safe default.
 */
const ROLE_MAP: { synapseRoleCode: string; workPulseRole: WorkPulseRole }[] = [
  // Super Admin
  { synapseRoleCode: "ADMIN", workPulseRole: WorkPulseRole.SYSTEM_ADMIN },
  // The baseline every member of staff holds. It is also what makes workPulse
  // reachable from the Synapse launcher at hierarchy 0200, so a deployment
  // without it leaves people holding a role and no way to open the app.
  { synapseRoleCode: "EMPLOYEE", workPulseRole: WorkPulseRole.EMPLOYEE },
  // Department Head. Note the casing: Synapse's role is `DeptHead`, and the
  // older all-caps `DEPT_HEAD` row is deliberately left deactivated.
  { synapseRoleCode: "DeptHead", workPulseRole: WorkPulseRole.DEPARTMENT_HEAD },
  { synapseRoleCode: "Project_Manager", workPulseRole: WorkPulseRole.PROJECT_MANAGER },
  { synapseRoleCode: "Executive", workPulseRole: WorkPulseRole.EXECUTIVE },
  { synapseRoleCode: "Executive_Restricted", workPulseRole: WorkPulseRole.EXECUTIVE_RESTRICTED },
  // Service accounts for systems that raise work through /intake.
  { synapseRoleCode: "Integrated_Service", workPulseRole: WorkPulseRole.INTEGRATION_SERVICE },
  // Asst Product Manager
  { synapseRoleCode: "APM_001", workPulseRole: WorkPulseRole.EMPLOYEE },
  // Product / Ops
  { synapseRoleCode: "PRODUCT_OPS", workPulseRole: WorkPulseRole.EMPLOYEE },
  // Support Desk
  { synapseRoleCode: "SUPPORT_DESK", workPulseRole: WorkPulseRole.EMPLOYEE },
  // Support Lead - leads a team, so MANAGER rather than EMPLOYEE
  { synapseRoleCode: "SUPPORT_LEAD", workPulseRole: WorkPulseRole.MANAGER },
];

async function main() {
  console.log("Seeding workPulse local dev data...");

  for (const entry of ROLE_MAP) {
    await prisma.synapseRoleMap.upsert({
      where: { synapseRoleCode: entry.synapseRoleCode },
      update: { workPulseRole: entry.workPulseRole, isActive: true },
      create: entry,
    });
  }

  for (const t of TASK_TYPES) {
    await prisma.taskType.upsert({
      where: { code: t.code },
      update: {
        name: t.name,
        requiresVerification: t.requiresVerification,
        requiresEvidence: t.requiresEvidence,
        requiresMakerChecker: t.requiresMakerChecker,
        autoCloseAfterHours: t.autoCloseAfterHours,
        isActive: true,
      },
      create: { ...t },
    });
  }
  console.log(`${TASK_TYPES.length} task types in place.`);

  // Deactivate any mapping no longer in ROLE_MAP rather than deleting it, so a
  // revoked grant leaves a trace instead of vanishing.
  const { count } = await prisma.synapseRoleMap.updateMany({
    where: { synapseRoleCode: { notIn: ROLE_MAP.map((r) => r.synapseRoleCode) }, isActive: true },
    data: { isActive: false },
  });

  console.log(`Seed complete. ${ROLE_MAP.length} Synapse role mappings active.`);
  if (count > 0) console.log(`Deactivated ${count} mapping(s) no longer listed.`);
  console.log("CLIENT_SELF is intentionally unmapped - external clients get no workPulse access.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
