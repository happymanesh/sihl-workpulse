import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ApprovalStatus,
  HandoverItemDisposition,
  HandoverItemType,
  HandoverReason,
  HandoverStatus,
  TaskStatus,
  WorkPulseRole,
  prisma,
} from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";
import { decideFor, needsDualApproval, type HeldItem } from "./handover-core";

/**
 * Handover of everything one person holds (TM-FR-025 to 028).
 *
 * Built first for exits. Broadened to internal moves because they have the same
 * failure mode and happen far more often: work stays quietly attached to
 * somebody who has stopped doing it, and nobody notices until the month-end it
 * was supposed to produce does not appear.
 *
 * What differs between an exit and a move is not the scan - it is what each
 * item means. Those rules live in handover-core.ts so they can be tested
 * without a database.
 */
@Injectable()
export class HandoverService {
  constructor(private readonly audit: AuditService) {}

  private assertHrOrAdmin(actor: AuthenticatedUser): void {
    const allowed =
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD) ||
      actor.roles.includes(WorkPulseRole.MANAGER);
    if (!allowed) throw new ForbiddenException("Handovers are managed by HR, managers and System Admins");
  }

  /**
   * Builds (or rebuilds) the handover from live data.
   *
   * Regenerated rather than incrementally maintained: a handover is rare and the
   * cost of a fresh scan is trivial next to the risk of a stale list missing
   * something the person picked up last week.
   */
  async build(
    actor: AuthenticatedUser,
    input: {
      employeeId: string;
      reason?: HandoverReason;
      effectiveDate?: Date;
      toDepartmentId?: string;
    },
  ) {
    this.assertHrOrAdmin(actor);
    const { employeeId } = input;
    const reason = input.reason ?? HandoverReason.EXIT;

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, departmentId: true },
    });
    if (!employee) throw new NotFoundException("Employee not found");

    if (reason === HandoverReason.INTERNAL_TRANSFER) {
      if (!input.toDepartmentId) {
        throw new BadRequestException("An internal transfer needs the department the employee is moving to");
      }
      if (input.toDepartmentId === employee.departmentId) {
        throw new BadRequestException(
          "That is the department they are already in. Use a role change instead.",
        );
      }
    }

    const existing = await prisma.handover.findFirst({
      where: { employeeId, status: HandoverStatus.OPEN },
      select: { id: true, reason: true },
    });
    if (existing && existing.reason !== reason) {
      throw new BadRequestException(
        `An open ${existing.reason.toLowerCase().replace("_", " ")} handover already exists for this employee. ` +
          "Complete or cancel it before starting another.",
      );
    }

    const [openTasks, deskCards, activities, raci, daci, processes, policies, delegations] = await Promise.all([
      prisma.task.findMany({
        where: {
          assigneeEmployeeId: employeeId,
          status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] },
        },
        select: {
          id: true,
          reference: true,
          title: true,
          priority: true,
          departmentId: true,
          taskType: { select: { code: true } },
          deskCardActivity: { select: { deskCard: { select: { holderEmployeeId: true } } } },
        },
      }),
      prisma.deskCard.findMany({
        where: { holderEmployeeId: employeeId, status: { not: ApprovalStatus.RETIRED } },
        select: { id: true, code: true, name: true },
      }),
      prisma.deskCardActivity.findMany({
        where: { deskCard: { holderEmployeeId: employeeId }, isActive: true, frequency: { not: null } },
        select: { id: true, title: true },
      }),
      prisma.raciAssignment.findMany({
        where: { employeeId },
        select: { id: true, role: true, project: { select: { name: true } } },
      }),
      prisma.daciAssignment.findMany({
        where: { employeeId },
        select: { id: true, role: true, decision: { select: { title: true, status: true } } },
      }),
      prisma.process.findMany({ where: { ownerEmployeeId: employeeId }, select: { id: true, name: true } }),
      prisma.policy.findMany({
        where: { OR: [{ ownerEmployeeId: employeeId }, { approverEmployeeId: employeeId }] },
        select: { id: true, name: true },
      }),
      prisma.delegation.findMany({
        where: { OR: [{ fromEmployeeId: employeeId }, { toEmployeeId: employeeId }], revertedAt: null },
        select: { id: true, reason: true },
      }),
    ]);

    const ctx = { reason, fromDepartmentId: employee.departmentId };
    type NewItem = {
      itemType: HandoverItemType;
      entityId: string;
      description: string;
      isBlocking: boolean;
      disposition: HandoverItemDisposition;
    };
    const items: NewItem[] = [];

    const push = (itemType: HandoverItemType, entityId: string, description: string, held: Partial<HeldItem> = {}) => {
      const v = decideFor({ itemType, ...held } as HeldItem, ctx);
      items.push({ itemType, entityId, description, isBlocking: v.isBlocking, disposition: v.disposition });
    };

    for (const t of openTasks) {
      push(HandoverItemType.OPEN_TASK, t.id, `${t.reference} · ${t.title}`, {
        priority: t.priority,
        taskTypeCode: t.taskType.code,
        taskDepartmentId: t.departmentId,
        // Generated by a desk card this person currently holds, so it leaves
        // with the desk card rather than with the person.
        fromOutgoingDeskCard: t.deskCardActivity?.deskCard.holderEmployeeId === employeeId,
      });
    }
    for (const c of deskCards) {
      push(HandoverItemType.DESK_CARD_HOLDER, c.id, `Desk card: ${c.name} (${c.code})`);
    }
    for (const a of activities) {
      push(HandoverItemType.RECURRING_ACTIVITY, a.id, `Recurring: ${a.title}`);
    }
    for (const r of raci) {
      push(HandoverItemType.RACI_ROLE, r.id, `${r.role} on ${r.project.name}`, { raciRole: r.role });
    }
    for (const d of daci) {
      push(HandoverItemType.DACI_ROLE, d.id, `${d.role} on decision "${d.decision.title}"`, {
        daciRole: d.role,
        decisionIsOpen: d.decision.status === "OPEN",
      });
    }
    for (const p of processes) {
      push(HandoverItemType.PROCESS_OWNER, p.id, `Process owner: ${p.name}`);
    }
    for (const p of policies) {
      push(HandoverItemType.POLICY_OWNER, p.id, `Policy owner or approver: ${p.name}`);
    }
    for (const d of delegations) {
      push(HandoverItemType.DELEGATION, d.id, `Active cover: ${d.reason}`);
    }

    const handover = await prisma.$transaction(async (tx) => {
      const open = await tx.handover.findFirst({
        where: { employeeId, status: HandoverStatus.OPEN },
      });

      if (open) {
        // Preserve what has already been settled; only refresh what is
        // outstanding, so a rebuild does not undo somebody's work.
        const done = await tx.handoverItem.findMany({
          where: { handoverId: open.id, OR: [{ transferredAt: { not: null } }, { waivedReason: { not: null } }] },
          select: { entityId: true },
        });
        const settled = new Set(done.map((d) => d.entityId));
        await tx.handoverItem.deleteMany({
          where: { handoverId: open.id, transferredAt: null, waivedReason: null },
        });
        await tx.handoverItem.createMany({
          data: items.filter((i) => !settled.has(i.entityId)).map((i) => ({ ...i, handoverId: open.id })),
        });
        return tx.handover.update({
          where: { id: open.id },
          data: {
            effectiveDate: input.effectiveDate ?? open.effectiveDate,
            toDepartmentId: input.toDepartmentId ?? open.toDepartmentId,
          },
          include: { items: true },
        });
      }

      return tx.handover.create({
        data: {
          employeeId,
          reason,
          effectiveDate: input.effectiveDate,
          toDepartmentId: input.toDepartmentId,
          items: { create: items },
        },
        include: { items: true },
      });
    });

    await this.audit.record({
      entityType: "Handover",
      entityId: handover.id,
      action: "built",
      actorId: actor.id,
      after: {
        employeeId,
        reason,
        items: handover.items.length,
        blocking: items.filter((i) => i.isBlocking).length,
        retained: items.filter((i) => i.disposition === HandoverItemDisposition.RETAINED).length,
      },
    });

    return handover;
  }

  /** The employee's open handover, if any. */
  async get(employeeId: string) {
    return prisma.handover.findFirst({
      where: { employeeId, status: HandoverStatus.OPEN },
      include: {
        employee: {
          select: { id: true, name: true, email: true, designation: true, department: { select: { name: true } } },
        },
        toDepartment: { select: { id: true, name: true } },
        items: { orderBy: [{ isBlocking: "desc" }, { disposition: "asc" }, { itemType: "asc" }] },
      },
    });
  }

  /** Every handover this person has had. The record of their moves. */
  async history(employeeId: string) {
    return prisma.handover.findMany({
      where: { employeeId },
      include: { toDepartment: { select: { name: true } }, items: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Either manager may change what happens to an item before signing.
   *
   * The defaults are a starting point, not a verdict: only the two managers know
   * whether a particular piece of work is genuinely the person's or the seat's.
   */
  async setDisposition(actor: AuthenticatedUser, itemId: string, disposition: HandoverItemDisposition, reason?: string) {
    this.assertHrOrAdmin(actor);

    const item = await prisma.handoverItem.findUnique({
      where: { id: itemId },
      include: { handover: { select: { id: true, reason: true, status: true } } },
    });
    if (!item) throw new NotFoundException("Handover item not found");
    if (item.transferredAt) throw new BadRequestException("That item has already been transferred");
    if (item.handover.status !== HandoverStatus.OPEN) {
      throw new BadRequestException("That handover is no longer open");
    }
    if (item.handover.reason === HandoverReason.EXIT && disposition === HandoverItemDisposition.RETAINED) {
      throw new BadRequestException(
        "Nothing can be retained on an exit — the employee is leaving, so it has to go to somebody.",
      );
    }

    const updated = await prisma.handoverItem.update({
      where: { id: itemId },
      data: {
        disposition,
        // Retained work has no second party to wait for, so it cannot block.
        isBlocking: disposition === HandoverItemDisposition.RETAINED ? false : item.isBlocking,
      },
    });

    await this.audit.record({
      entityType: "Handover",
      entityId: item.handover.id,
      action: "item_disposition_changed",
      actorId: actor.id,
      before: { itemType: item.itemType, disposition: item.disposition },
      after: { disposition: updated.disposition },
      reason: reason ?? `${item.description}: now ${disposition}`,
    });

    return updated;
  }

  /**
   * TM-FR-026: transfer preserves the original owner in history on every item.
   * The underlying record is repointed; the fact that it was theirs is not
   * erased.
   */
  async transferItem(actor: AuthenticatedUser, itemId: string, toEmployeeId: string) {
    this.assertHrOrAdmin(actor);

    const item = await prisma.handoverItem.findUnique({
      where: { id: itemId },
      include: { handover: { select: { id: true, employeeId: true, status: true } } },
    });
    if (!item) throw new NotFoundException("Handover item not found");
    if (item.transferredAt) throw new BadRequestException("This item has already been transferred");
    if (item.disposition === HandoverItemDisposition.RETAINED) {
      throw new BadRequestException(
        "That item stays with the employee. Change it to hand over first if it should move.",
      );
    }

    const to = await prisma.employee.findUnique({ where: { id: toEmployeeId } });
    if (!to?.isActive) throw new BadRequestException("Transfer target must be an active employee");

    const from = item.handover.employeeId;
    if (toEmployeeId === from) {
      throw new BadRequestException("Cannot hand work over to the person handing it over");
    }

    await prisma.$transaction(async (tx) => {
      switch (item.itemType) {
        case HandoverItemType.OPEN_TASK:
          await tx.task.update({ where: { id: item.entityId }, data: { assigneeEmployeeId: toEmployeeId } });
          break;
        case HandoverItemType.DESK_CARD_HOLDER:
          await tx.deskCardHolderHistory.updateMany({
            where: { deskCardId: item.entityId, employeeId: from, toDate: null },
            data: { toDate: new Date() },
          });
          await tx.deskCardHolderHistory.create({
            data: {
              deskCardId: item.entityId,
              employeeId: toEmployeeId,
              fromDate: new Date(),
              reason: "Transferred on handover",
              actorUserId: actor.id,
            },
          });
          await tx.deskCard.update({
            where: { id: item.entityId },
            data: { holderEmployeeId: toEmployeeId, holderSince: new Date(), acknowledgedAt: null },
          });
          break;
        case HandoverItemType.RACI_ROLE:
          await tx.raciAssignment.update({ where: { id: item.entityId }, data: { employeeId: toEmployeeId } });
          break;
        case HandoverItemType.DACI_ROLE:
          await tx.daciAssignment.update({ where: { id: item.entityId }, data: { employeeId: toEmployeeId } });
          break;
        case HandoverItemType.PROCESS_OWNER:
          await tx.process.update({ where: { id: item.entityId }, data: { ownerEmployeeId: toEmployeeId } });
          break;
        case HandoverItemType.POLICY_OWNER:
          await tx.policy.updateMany({
            where: { id: item.entityId, ownerEmployeeId: from },
            data: { ownerEmployeeId: toEmployeeId },
          });
          await tx.policy.updateMany({
            where: { id: item.entityId, approverEmployeeId: from },
            data: { approverEmployeeId: toEmployeeId },
          });
          break;
        default:
          // RECURRING_ACTIVITY follows its desk card; DELEGATION is informational.
          break;
      }

      await tx.handoverItem.update({
        where: { id: itemId },
        data: { transferredToEmployeeId: toEmployeeId, transferredAt: new Date() },
      });
    });

    await this.audit.record({
      entityType: "Handover",
      entityId: item.handover.id,
      action: "item_transferred",
      actorId: actor.id,
      before: { itemType: item.itemType, entityId: item.entityId, originalOwner: from },
      after: { transferredTo: toEmployeeId },
      reason: `Handover: ${item.description}`,
    });

    return this.get(from);
  }

  /**
   * TM-FR-028: a manager signs off their side of an internal move.
   *
   * Two signatures, because they attest to different things. The releasing
   * manager confirms the work really has been handed over; the receiving one
   * confirms they know what is arriving with the person. One signature is how
   * somebody gets transferred with their old obligations still attached.
   */
  async approve(actor: AuthenticatedUser, employeeId: string, side: "RELEASING" | "RECEIVING") {
    this.assertHrOrAdmin(actor);

    const handover = await this.get(employeeId);
    if (!handover) throw new NotFoundException("No open handover for this employee");
    if (!needsDualApproval(handover.reason)) {
      throw new BadRequestException("Only an internal transfer requires both managers to sign");
    }

    const data =
      side === "RELEASING"
        ? { releasingApprovedByUserId: actor.id, releasingApprovedAt: new Date() }
        : { receivingApprovedByUserId: actor.id, receivingApprovedAt: new Date() };

    const other = side === "RELEASING" ? handover.receivingApprovedByUserId : handover.releasingApprovedByUserId;
    if (other && other === actor.id) {
      throw new BadRequestException(
        "The same person cannot sign both sides of a transfer. That is the point of having two.",
      );
    }

    const after = await prisma.handover.update({ where: { id: handover.id }, data });

    await this.audit.record({
      entityType: "Handover",
      entityId: handover.id,
      action: side === "RELEASING" ? "releasing_manager_approved" : "receiving_manager_approved",
      actorId: actor.id,
      after: { side },
    });

    return after;
  }

  /** What is standing in the way of completing. Retained items never appear. */
  async blockers(employeeId: string) {
    const handover = await prisma.handover.findFirst({
      where: { employeeId, status: HandoverStatus.OPEN },
      include: {
        items: {
          where: {
            isBlocking: true,
            transferredAt: null,
            waivedReason: null,
            disposition: HandoverItemDisposition.HAND_OVER,
          },
        },
      },
    });
    return handover?.items ?? [];
  }

  /**
   * TM-FR-025: the hard stop. A System Admin may override, but never silently -
   * the reason is mandatory and the override is audited.
   *
   * Completing an internal transfer also moves the employee's department, so the
   * org record and the handover cannot disagree.
   */
  async complete(actor: AuthenticatedUser, employeeId: string, overrideReason?: string) {
    this.assertHrOrAdmin(actor);

    const handover = await prisma.handover.findFirst({
      where: { employeeId, status: HandoverStatus.OPEN },
    });
    if (!handover) throw new NotFoundException("No open handover for this employee");

    if (needsDualApproval(handover.reason) && !(handover.releasingApprovedAt && handover.receivingApprovedAt)) {
      const missing = !handover.releasingApprovedAt ? "the releasing manager" : "the receiving manager";
      throw new BadRequestException(`Waiting on ${missing} to sign. Both managers must approve a transfer.`);
    }

    const outstanding = await this.blockers(employeeId);

    if (outstanding.length > 0) {
      if (!overrideReason?.trim()) {
        throw new BadRequestException(
          `${outstanding.length} blocking item(s) remain: ${outstanding
            .map((i) => i.description)
            .join("; ")}. Transfer them, or override with a reason.`,
        );
      }
      if (!actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN)) {
        throw new ForbiddenException("Only a System Admin can override a handover");
      }
    }

    const overridden = outstanding.length > 0;

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.handover.update({
        where: { id: handover.id },
        data: {
          status: overridden ? HandoverStatus.OVERRIDDEN : HandoverStatus.COMPLETE,
          overrideReason: overridden ? overrideReason : null,
          overrideByUserId: overridden ? actor.id : null,
          overriddenAt: overridden ? new Date() : null,
        },
      });

      // Frappe HR remains the master for Employee.department, and the nightly
      // sync will reassert it. Setting it here keeps workPulse correct in the
      // meantime rather than showing the person in a department they have left
      // until the next sync runs.
      if (handover.reason === HandoverReason.INTERNAL_TRANSFER && handover.toDepartmentId) {
        await tx.employee.update({
          where: { id: employeeId },
          data: { departmentId: handover.toDepartmentId },
        });
      }

      return updated;
    });

    await this.audit.record({
      entityType: "Handover",
      entityId: handover.id,
      action: overridden ? "completed_with_override" : "completed",
      actorId: actor.id,
      after: {
        status: after.status,
        reason: handover.reason,
        outstandingBlockers: outstanding.length,
        movedToDepartmentId: handover.toDepartmentId ?? undefined,
      },
      reason: overrideReason,
    });

    return after;
  }
}
