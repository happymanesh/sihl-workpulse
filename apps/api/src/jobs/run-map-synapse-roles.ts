/**
 * One-off: map Synapse roles onto workPulse roles.
 *
 * Goes through RoleMapService rather than writing SynapseRoleMap directly, so
 * the CLIENT_SELF refusal, the "does this Synapse role exist" check and the
 * audit entry all apply exactly as they would from the screen. A mapping
 * written straight to the table would skip all three.
 *
 *   npm run map:synapse-roles -w apps/api -- DeptHead=DEPARTMENT_HEAD Audit=AUDIT
 *
 * With no arguments it maps nothing and prints what is currently unmapped.
 */
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { WorkPulseRole, prisma } from "@workpulse/db";
import { AppModule } from "../app.module";
import { RoleMapService } from "../modules/auth/role-map.service";
import type { AuthenticatedUser } from "../modules/auth/identity.service";

async function main() {
  const log = new Logger("map-synapse-roles");
  const pairs = process.argv.slice(2).filter((a) => a.includes("="));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const maps = app.get(RoleMapService);

  // Act as a real administrator so the audit trail names somebody, not "system".
  const adminUser = await prisma.user.findFirst({
    where: { synapseUsername: "Admin001" },
    select: { id: true, synapseUserUid: true, synapseUsername: true },
  });
  if (!adminUser) throw new Error("No Admin001 user row - sign in to workPulse once first.");

  const actor = {
    id: adminUser.id,
    synapseUserUid: adminUser.synapseUserUid,
    username: adminUser.synapseUsername,
    fullName: adminUser.synapseUsername,
    companyCode: "SIHL",
    hierarchyCode: "9999",
    roles: [WorkPulseRole.SYSTEM_ADMIN],
    employeeId: null,
    isEmployeeUnlinked: true,
  } as AuthenticatedUser;

  if (pairs.length === 0) {
    const view = await maps.list(actor);
    log.log("Unmapped Synapse roles:");
    for (const r of view.synapseRoles.filter((x) => !x.isMapped && x.isMappable)) {
      log.log(`  ${r.roleCode}  (${r.roleName})`);
    }
    await app.close();
    return;
  }

  for (const pair of pairs) {
    const [code, role] = pair.split("=");
    if (!(role in WorkPulseRole)) {
      log.error(`"${role}" is not a workPulse role. Skipped.`);
      continue;
    }
    try {
      const saved = await maps.upsert(actor, {
        synapseRoleCode: code,
        workPulseRole: role as WorkPulseRole,
        reason: "Mapped after the six roles were created in Synapse",
      });
      log.log(`✓ ${saved.synapseRoleCode} -> ${saved.workPulseRole}`);
    } catch (err) {
      log.error(`✗ ${code}: ${(err as Error).message}`);
    }
  }

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
