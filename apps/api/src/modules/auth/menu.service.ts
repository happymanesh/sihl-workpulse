import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import { IdentityService, type AuthenticatedUser } from "./identity.service";

/**
 * Which menu entries a particular person sees.
 *
 * Two things this is NOT, both worth stating because the opposite is the
 * obvious misreading:
 *
 *   It is not access control. Hiding /mis from somebody does not stop them
 *   reading MIS - the procedure behind it checks their roles, exactly as it did
 *   before, and that check is the only thing standing between anyone and the
 *   data. A second permission model that disagrees with the first is worse than
 *   no second model, because people would start trusting it.
 *
 *   It is not additive. There is no way to show somebody an entry their roles
 *   do not grant. The stored list only ever subtracts from what the role
 *   already allows, so a menu edit can never widen anybody's reach.
 *
 * What it is for: a department head who wants their team to open workPulse and
 * see four things rather than fourteen. That is a real request, and the honest
 * answer to it is a shorter menu, not a fake permission.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * The one entry that cannot be hidden.
   *
   * Somebody whose menu is entirely empty has an application that appears
   * broken, and the first thing they do is raise a ticket. Their own work is
   * also the one screen every single user needs.
   */
  static readonly ALWAYS_VISIBLE = "/tasks";

  /**
   * Routes are checked for shape, not against a list of known screens.
   *
   * The catalogue of entries lives in the web app, where the menu is actually
   * rendered, and copying it here would create two lists to keep in step. A key
   * that matches no screen hides nothing, which is the harmless outcome; the
   * admin screen only ever sends routes it just rendered.
   */
  private static readonly ROUTE = /^\/[a-z0-9\-/]*$/;

  private requireAdmin(actor: AuthenticatedUser) {
    if (!actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN)) {
      throw new ForbiddenException("Only a system administrator may change somebody's menu");
    }
  }

  /** What is currently hidden for one person. Readable by Audit as well. */
  async forUser(actor: AuthenticatedUser, synapseUserUid: number) {
    if (
      !actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) &&
      !actor.roles.includes(WorkPulseRole.AUDIT)
    ) {
      throw new ForbiddenException("Only a system administrator or Audit may read this");
    }

    const user = await prisma.user.findUnique({
      where: { synapseUserUid },
      select: {
        synapseUserUid: true,
        synapseUsername: true,
        hiddenNavKeys: true,
        localRoles: true,
        employee: { select: { name: true, department: { select: { name: true } } } },
      },
    });
    if (!user) throw new NotFoundException("That user has never signed in to workPulse");

    // The roles they would resolve to right now, so the screen can offer the
    // entries they actually see rather than every entry that exists.
    const effectiveRoles = await this.identity.effectiveRoles(
      user.synapseUserUid,
      user.localRoles,
    );

    return { ...user, effectiveRoles };
  }

  /**
   * Replace the hidden list wholesale rather than adding and removing one at a
   * time: the admin screen shows every entry with a tick, so what it has is the
   * whole answer, and a wholesale write cannot leave a half-applied state.
   */
  async setHidden(
    actor: AuthenticatedUser,
    input: { synapseUserUid: number; hiddenNavKeys: string[]; reason?: string },
  ) {
    this.requireAdmin(actor);

    const before = await prisma.user.findUnique({
      where: { synapseUserUid: input.synapseUserUid },
      select: { id: true, synapseUsername: true, hiddenNavKeys: true },
    });
    if (!before) throw new NotFoundException("That user has never signed in to workPulse");

    const keys = Array.from(new Set(input.hiddenNavKeys.map((k) => k.trim()).filter(Boolean)));

    for (const key of keys) {
      if (!MenuService.ROUTE.test(key)) {
        throw new BadRequestException(`"${key}" is not a menu route`);
      }
    }
    if (keys.includes(MenuService.ALWAYS_VISIBLE)) {
      throw new BadRequestException(
        "Their own tasks cannot be hidden — it is the one screen everybody needs, and an empty menu looks like a broken application.",
      );
    }

    const after = await prisma.user.update({
      where: { synapseUserUid: input.synapseUserUid },
      data: { hiddenNavKeys: keys },
      select: { synapseUserUid: true, synapseUsername: true, hiddenNavKeys: true },
    });

    await this.audit.record({
      entityType: "User",
      entityId: before.id,
      action: "menu_changed",
      actorId: actor.id,
      before: { hiddenNavKeys: before.hiddenNavKeys },
      after: { hiddenNavKeys: after.hiddenNavKeys },
      reason: input.reason?.trim() || `Menu adjusted for ${before.synapseUsername}`,
    });

    return after;
  }

  /** Everyone who currently has something hidden, so the practice is reviewable. */
  async adjusted(actor: AuthenticatedUser) {
    if (
      !actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) &&
      !actor.roles.includes(WorkPulseRole.AUDIT)
    ) {
      throw new ForbiddenException("Only a system administrator or Audit may read this");
    }

    return prisma.user.findMany({
      where: { NOT: { hiddenNavKeys: { isEmpty: true } } },
      select: {
        synapseUserUid: true,
        synapseUsername: true,
        hiddenNavKeys: true,
        employee: { select: { name: true } },
      },
      orderBy: { synapseUsername: "asc" },
    });
  }
}
