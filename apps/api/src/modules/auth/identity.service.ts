import { Injectable, Logger } from "@nestjs/common";
import { prisma, WorkPulseRole } from "@workpulse/db";
import { SynapseDirectoryService } from "./synapse-directory.service";
import type { SynapseSessionPayload } from "./synapse-session.service";

/**
 * The authenticated caller, as every part of workPulse sees them. Both
 * transports (REST guards and tRPC middleware) resolve to this same shape, so
 * they cannot drift on what "who is calling" means.
 */
export interface AuthenticatedUser {
  /** workPulse User.id */
  id: string;
  synapseUserUid: number;
  username: string;
  fullName: string;
  companyCode: string;
  hierarchyCode: string;
  /** Effective roles: mapped Synapse roles UNION local workPulse grants. */
  roles: WorkPulseRole[];
  employeeId: string | null;
  isEmployeeUnlinked: boolean;
}

/**
 * Turns a verified Synapse session into a workPulse caller.
 *
 * Runs on every authenticated request, so it is deliberately three cheap
 * queries and one upsert - not a join across two databases.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly directory: SynapseDirectoryService) {}

  /**
   * Returns null for any reason the caller should not proceed - deactivated in
   * Synapse, directory unreachable, user gone. Callers must treat null as
   * "reject", never as "carry on unauthenticated".
   */
  async resolve(session: SynapseSessionPayload): Promise<AuthenticatedUser | null> {
    // Live revocation check. Never skip this on the strength of a valid JWT.
    const synapseUser = await this.directory.findActiveUser(session.userUid);
    if (!synapseUser) return null;

    const roleCodes = await this.directory.findRoleCodes(session.userUid);
    const mappedRoles = await this.mapRoles(roleCodes);
    const user = await this.upsertUser(synapseUser.uid, synapseUser.username, synapseUser.email);

    // Access requires an explicit grant. There is deliberately NO fallback role
    // for users whose Synapse roles map to nothing.
    //
    // Synapse authenticates external parties as well as staff - CLIENT_SELF is
    // a real role held by real clients. Defaulting the unmapped to EMPLOYEE
    // would silently hand a client a workPulse account and a desk card.
    // Unmapped means no access; granting it is an explicit act in
    // SynapseRoleMap or a local grant.
    const roles = Array.from(new Set<WorkPulseRole>([...mappedRoles, ...user.localRoles]));
    if (roles.length === 0) {
      this.logger.warn(
        `Denying ${synapseUser.username}: Synapse roles [${roleCodes.join(", ") || "none"}] map to no workPulse role`,
      );
      return null;
    }

    return {
      id: user.id,
      synapseUserUid: synapseUser.uid,
      username: synapseUser.username,
      fullName: synapseUser.fullName,
      companyCode: session.companyCode,
      hierarchyCode: session.hierarchyCode,
      roles,
      employeeId: user.employeeId,
      isEmployeeUnlinked: user.isEmployeeUnlinked,
    };
  }

  private async mapRoles(synapseRoleCodes: string[]): Promise<WorkPulseRole[]> {
    if (synapseRoleCodes.length === 0) return [];
    const maps = await prisma.synapseRoleMap.findMany({
      where: { synapseRoleCode: { in: synapseRoleCodes }, isActive: true },
      select: { workPulseRole: true },
    });
    return maps.map((m) => m.workPulseRole);
  }

  /**
   * Lazily provisions the local join row on first sign-in, and re-attempts the
   * Frappe HR link each time it is still missing - an employee record created
   * after the user's first login should link on their next request rather than
   * needing an admin to intervene.
   */
  private async upsertUser(uid: number, username: string, email: string | null) {
    const employee = email
      ? await prisma.employee.findUnique({ where: { email }, select: { id: true } })
      : null;

    if (!employee && email) {
      this.logger.warn(
        `Synapse user ${username} (uid ${uid}) has no Frappe HR employee for email ${email} - flagged unlinked`,
      );
    }

    return prisma.user.upsert({
      where: { synapseUserUid: uid },
      create: {
        synapseUserUid: uid,
        synapseUsername: username,
        employeeId: employee?.id,
        isEmployeeUnlinked: !employee,
        lastSeenAt: new Date(),
      },
      update: {
        synapseUsername: username,
        // Only ever fills a missing link; never repoints an established one, which
        // would silently move a person's work to a different employee record.
        ...(employee ? { employeeId: employee.id, isEmployeeUnlinked: false } : {}),
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        employeeId: true,
        isEmployeeUnlinked: true,
        localRoles: true,
      },
    });
  }
}
