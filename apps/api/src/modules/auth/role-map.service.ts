import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { WorkPulseRole, prisma } from "@workpulse/db";
import type { AuthenticatedUser } from "./identity.service";
import { AuditService } from "../audit/audit.service";
import { SynapseDirectoryService } from "./synapse-directory.service";

/**
 * Administration of the Synapse -> workPulse role mapping.
 *
 * Two rules are enforced here rather than trusted to whoever is editing:
 *
 *   1. **CLIENT_SELF can never be mapped.** It is held by external clients.
 *      Mapping it to anything - even EMPLOYEE - would give customers workPulse
 *      accounts and desk cards. This was caught once already in Phase 0, when a
 *      fallback role would have done exactly that; leaving it merely ABSENT
 *      from the map invites a future admin to "complete" the map and reopen it.
 *      It is refused in code.
 *
 *   2. **A mapping must name a Synapse role that exists.** A row pointing at a
 *      role code Synapse has never heard of grants nothing and looks like
 *      coverage, which is worse than an obvious gap.
 */
@Injectable()
export class RoleMapService {
  /**
   * Synapse roles held by parties outside SIHL. Never mappable, at any
   * privilege level, by anybody.
   */
  static readonly NEVER_MAPPABLE = ["CLIENT_SELF"];

  constructor(
    private readonly audit: AuditService,
    private readonly directory: SynapseDirectoryService,
  ) {}

  private assertAdmin(actor: AuthenticatedUser): void {
    if (!actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN)) {
      throw new ForbiddenException("Only a system administrator may change role mappings");
    }
  }

  /** Current mappings, alongside the Synapse roles that actually exist. */
  async list(actor: AuthenticatedUser) {
    if (
      !actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) &&
      !actor.roles.includes(WorkPulseRole.AUDIT)
    ) {
      throw new ForbiddenException("Only a system administrator or Audit may read role mappings");
    }

    const [mappings, synapseRoles] = await Promise.all([
      prisma.synapseRoleMap.findMany({ orderBy: { synapseRoleCode: "asc" } }),
      this.directory.listRoles(),
    ]);

    const mappedCodes = new Set(mappings.filter((m) => m.isActive).map((m) => m.synapseRoleCode));

    return {
      mappings,
      synapseRoles: synapseRoles.map((r) => ({
        ...r,
        isMapped: mappedCodes.has(r.roleCode),
        isMappable: !RoleMapService.NEVER_MAPPABLE.includes(r.roleCode),
      })),
      // Null when the directory is unreachable, so "no roles" and "could not
      // ask" do not look identical on screen.
      directoryReachable: synapseRoles.length > 0 || (await this.directory.isReachable()),
    };
  }

  async upsert(
    actor: AuthenticatedUser,
    input: { synapseRoleCode: string; workPulseRole: WorkPulseRole; reason?: string },
  ) {
    this.assertAdmin(actor);

    const code = input.synapseRoleCode.trim().toUpperCase();

    if (RoleMapService.NEVER_MAPPABLE.includes(code)) {
      throw new BadRequestException(
        `${code} is held by external clients and must never be mapped to a workPulse role. ` +
          "Mapping it would give customers workPulse accounts.",
      );
    }

    const synapseRoles = await this.directory.listRoles();
    if (synapseRoles.length > 0 && !synapseRoles.some((r) => r.roleCode === code)) {
      throw new BadRequestException(
        `Synapse has no role "${code}". A mapping to a role that does not exist grants nothing ` +
          "and looks like coverage. Ask the CTO to create it in Synapse first.",
      );
    }

    const before = await prisma.synapseRoleMap.findUnique({ where: { synapseRoleCode: code } });

    const mapping = await prisma.synapseRoleMap.upsert({
      where: { synapseRoleCode: code },
      create: { synapseRoleCode: code, workPulseRole: input.workPulseRole, isActive: true },
      update: { workPulseRole: input.workPulseRole, isActive: true },
    });

    await this.audit.record({
      entityType: "SynapseRoleMap",
      entityId: String(mapping.id),
      action: before ? "UPDATE_MAPPING" : "CREATE_MAPPING",
      actorId: actor.id,
      before: before
        ? { synapseRoleCode: before.synapseRoleCode, workPulseRole: before.workPulseRole, isActive: before.isActive }
        : null,
      after: { synapseRoleCode: code, workPulseRole: input.workPulseRole, isActive: true },
      reason: input.reason ?? `Mapped ${code} to ${input.workPulseRole}`,
    });

    return mapping;
  }

  /**
   * Deactivates a mapping. Never deletes it - a removed mapping is a change in
   * who could reach the system, and the row is the record of it.
   */
  async deactivate(actor: AuthenticatedUser, synapseRoleCode: string, reason: string) {
    this.assertAdmin(actor);
    if (!reason.trim()) throw new BadRequestException("Removing a mapping requires a reason");

    const before = await prisma.synapseRoleMap.findUnique({ where: { synapseRoleCode } });
    if (!before) throw new BadRequestException("No such mapping");

    const mapping = await prisma.synapseRoleMap.update({
      where: { synapseRoleCode },
      data: { isActive: false },
    });

    await this.audit.record({
      entityType: "SynapseRoleMap",
      entityId: String(mapping.id),
      action: "DEACTIVATE_MAPPING",
      actorId: actor.id,
      before: { workPulseRole: before.workPulseRole, isActive: before.isActive },
      after: { workPulseRole: mapping.workPulseRole, isActive: false },
      reason,
    });

    return mapping;
  }
}
