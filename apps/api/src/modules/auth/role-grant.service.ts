import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { WorkPulseRole, prisma } from "@workpulse/db";
import type { AuthenticatedUser } from "./identity.service";
import { AuditService } from "../audit/audit.service";

/**
 * Direct workPulse role grants.
 *
 * Synapse has five roles - ADMIN, SUPPORT_LEAD, PRODUCT_OPS, SUPPORT_DESK and
 * CLIENT_SELF - and SynapseRoleMap already covers the four that should map.
 * Six workPulse roles have no Synapse counterpart AT ALL:
 *
 *     DEPARTMENT_HEAD  PROJECT_MANAGER  EXECUTIVE
 *     EXECUTIVE_RESTRICTED  AUDIT  INTEGRATION_SERVICE
 *
 * They cannot be fixed by adding mapping rows, because there is nothing to map
 * from. Pointing one of them at an existing operational role - SUPPORT_LEAD to
 * EXECUTIVE, say - would hand confidential-task visibility and shadow-score
 * access to whoever runs the support desk. That is not a mapping, it is an
 * invention of authority.
 *
 * `User.localRoles` is the mechanism the schema already anticipated for this
 * ("grants Synapse has no concept of - notably AUDIT"). This service is the
 * write path it was missing.
 */
@Injectable()
export class RoleGrantService {
  private readonly logger = new Logger(RoleGrantService.name);

  constructor(private readonly audit: AuditService) {}

  /**
   * Roles that must never be granted to the caller by the caller.
   *
   * AUDIT exists precisely to watch people who administer the system, and
   * EXECUTIVE_RESTRICTED reads HR, legal and disciplinary work. A SYSTEM_ADMIN
   * who could hand either to themselves would make the Phase 6 and 7 separation
   * theatre - the whole point is that administering workPulse is not standing to
   * read people. Granting them to someone ELSE stays possible, is audited, and
   * is visible to Compliance through `holders()`.
   */
  static readonly NO_SELF_GRANT: WorkPulseRole[] = [
    WorkPulseRole.AUDIT,
    WorkPulseRole.EXECUTIVE_RESTRICTED,
  ];

  /** Roles that carry a standing obligation to record why they were given. */
  static readonly REASON_REQUIRED: WorkPulseRole[] = [
    WorkPulseRole.AUDIT,
    WorkPulseRole.EXECUTIVE_RESTRICTED,
    WorkPulseRole.EXECUTIVE,
    WorkPulseRole.INTEGRATION_SERVICE,
  ];

  private assertMayGrant(actor: AuthenticatedUser): void {
    if (!actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN)) {
      throw new ForbiddenException("Only a system administrator may grant workPulse roles");
    }
  }

  async grant(
    actor: AuthenticatedUser,
    input: { synapseUserUid: number; role: WorkPulseRole; reason?: string },
  ) {
    this.assertMayGrant(actor);

    const user = await prisma.user.findUnique({
      where: { synapseUserUid: input.synapseUserUid },
      select: { id: true, synapseUsername: true, localRoles: true, employeeId: true },
    });
    if (!user) {
      throw new NotFoundException(
        "That user has never signed in to workPulse. They must sign in once before a role can be granted.",
      );
    }

    if (user.id === actor.id && RoleGrantService.NO_SELF_GRANT.includes(input.role)) {
      throw new ForbiddenException(
        `${input.role} cannot be granted to yourself. Ask another administrator, so the grant has a second name against it.`,
      );
    }

    if (RoleGrantService.REASON_REQUIRED.includes(input.role) && !input.reason?.trim()) {
      throw new BadRequestException(`Granting ${input.role} requires a written reason`);
    }

    // INTEGRATION_SERVICE is for machine accounts consuming the Command Centre
    // feed. On a person it would be a standing credential nobody reviews.
    if (input.role === WorkPulseRole.INTEGRATION_SERVICE && user.employeeId) {
      throw new BadRequestException(
        "INTEGRATION_SERVICE is for service accounts. This Synapse user is linked to an employee record.",
      );
    }

    if (user.localRoles.includes(input.role)) {
      return { changed: false, localRoles: user.localRoles };
    }

    const localRoles = [...user.localRoles, input.role];
    await prisma.user.update({ where: { id: user.id }, data: { localRoles } });

    await this.audit.record({
      entityType: "User",
      entityId: user.id,
      action: "GRANT_ROLE",
      actorId: actor.id,
      before: { localRoles: user.localRoles },
      after: { localRoles },
      reason: input.reason ?? `Granted ${input.role}`,
    });

    this.logger.warn(
      `${actor.username} granted ${input.role} to ${user.synapseUsername} (uid ${input.synapseUserUid})`,
    );

    return { changed: true, localRoles };
  }

  async revoke(
    actor: AuthenticatedUser,
    input: { synapseUserUid: number; role: WorkPulseRole; reason?: string },
  ) {
    this.assertMayGrant(actor);

    const user = await prisma.user.findUnique({
      where: { synapseUserUid: input.synapseUserUid },
      select: { id: true, synapseUsername: true, localRoles: true },
    });
    if (!user) throw new NotFoundException("User not found");

    if (!user.localRoles.includes(input.role)) {
      return { changed: false, localRoles: user.localRoles };
    }

    const localRoles = user.localRoles.filter((r) => r !== input.role);
    await prisma.user.update({ where: { id: user.id }, data: { localRoles } });

    await this.audit.record({
      entityType: "User",
      entityId: user.id,
      action: "REVOKE_ROLE",
      actorId: actor.id,
      before: { localRoles: user.localRoles },
      after: { localRoles },
      reason: input.reason ?? `Revoked ${input.role}`,
    });

    return { changed: true, localRoles };
  }

  /**
   * Everyone holding a directly granted role, and what it came from.
   *
   * Read by Compliance as much as by administrators: a sensitive role nobody
   * can enumerate is a sensitive role nobody is reviewing.
   */
  async holders(actor: AuthenticatedUser) {
    if (
      !actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) &&
      !actor.roles.includes(WorkPulseRole.AUDIT)
    ) {
      throw new ForbiddenException("Only a system administrator or Audit may list role holders");
    }

    const users = await prisma.user.findMany({
      where: { NOT: { localRoles: { isEmpty: true } } },
      select: {
        id: true,
        synapseUserUid: true,
        synapseUsername: true,
        localRoles: true,
        isEmployeeUnlinked: true,
        lastSeenAt: true,
        employee: { select: { id: true, name: true, designation: true } },
      },
      orderBy: { synapseUsername: "asc" },
    });

    // The grant trail, so a holder can be traced to who gave it and why.
    const grants = await prisma.auditLog.findMany({
      where: { entityType: "User", action: { in: ["GRANT_ROLE", "REVOKE_ROLE"] } },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, action: true, actorId: true, reason: true, createdAt: true },
      take: 500,
    });

    return users.map((u) => ({
      ...u,
      grantHistory: grants.filter((g) => g.entityId === u.id),
    }));
  }

  /**
   * The coverage report: which workPulse roles nobody can currently reach.
   *
   * This is what turned a silent gap into a known one. Every role below with
   * zero reachable holders is a shipped control nobody can exercise.
   */
  async coverage() {
    const [mappings, users] = await Promise.all([
      prisma.synapseRoleMap.findMany({
        where: { isActive: true },
        select: { synapseRoleCode: true, workPulseRole: true },
      }),
      prisma.user.findMany({ select: { localRoles: true } }),
    ]);

    const grantedLocally = new Set(users.flatMap((u) => u.localRoles));
    const mappedFromSynapse = new Map<WorkPulseRole, string[]>();
    for (const m of mappings) {
      mappedFromSynapse.set(m.workPulseRole, [
        ...(mappedFromSynapse.get(m.workPulseRole) ?? []),
        m.synapseRoleCode,
      ]);
    }

    return Object.values(WorkPulseRole).map((role) => {
      const via = mappedFromSynapse.get(role) ?? [];
      const local = grantedLocally.has(role);
      return {
        role,
        synapseRoles: via,
        hasLocalGrant: local,
        // Unreachable means no Synapse role maps to it AND nobody holds it
        // directly - the control exists and nobody can exercise it.
        isUnreachable: via.length === 0 && !local,
      };
    });
  }
}
