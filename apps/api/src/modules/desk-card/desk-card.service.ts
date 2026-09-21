import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, Prisma, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";

export interface CreateDeskCardInput {
  code: string;
  name: string;
  description?: string;
  departmentId: string;
}

export interface TransferHolderInput {
  deskCardId: string;
  toEmployeeId: string;
  reason: string;
}

/**
 * Desk Cards: the standing obligations attached to a role (Addendum 01).
 *
 * Every mutation here records an audit entry, per CLAUDE.md: capture before,
 * mutate, capture after, record with a reason where the business rules demand
 * one. tRPC procedures call this service; they never reach for Prisma directly,
 * because that is how the audit rule stays enforceable rather than aspirational.
 */
@Injectable()
export class DeskCardService {
  constructor(private readonly audit: AuditService) {}

  private canGovern(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD)
    );
  }

  private assertCanGovern(actor: AuthenticatedUser, what: string): void {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException(`${what} may only be done by a Department Head or System Admin`);
    }
  }

  async list(params: { departmentId?: string; includeRetired?: boolean } = {}) {
    return prisma.deskCard.findMany({
      where: {
        departmentId: params.departmentId,
        status: params.includeRetired ? undefined : { not: ApprovalStatus.RETIRED },
      },
      include: {
        department: { select: { id: true, name: true } },
        holder: { select: { id: true, name: true, email: true, designation: true } },
        _count: { select: { activities: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async findById(id: string) {
    const card = await prisma.deskCard.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        holder: { select: { id: true, name: true, email: true, designation: true } },
        activities: {
          orderBy: [{ priority: "asc" }, { title: "asc" }],
          include: { taskType: { select: { id: true, code: true, name: true } } },
        },
        holderHistory: {
          orderBy: { fromDate: "desc" },
          include: { employee: { select: { id: true, name: true } } },
        },
      },
    });
    if (!card) throw new NotFoundException(`Desk card ${id} not found`);
    return card;
  }

  async create(actor: AuthenticatedUser, input: CreateDeskCardInput) {
    this.assertCanGovern(actor, "Creating a desk card");

    const card = await prisma.deskCard.create({
      data: {
        code: input.code.trim(),
        name: input.name.trim(),
        description: input.description?.trim(),
        departmentId: input.departmentId,
        status: ApprovalStatus.DRAFT,
      },
    });

    await this.audit.record({
      entityType: "DeskCard",
      entityId: card.id,
      action: "created",
      actorId: actor.id,
      after: { code: card.code, name: card.name, departmentId: card.departmentId },
    });

    return card;
  }

  /**
   * Draft -> Pending Review -> Approved. Only an Approved card generates work
   * (TM-FR-074), so this is the gate between describing a role and putting it
   * into production.
   */
  async setStatus(actor: AuthenticatedUser, deskCardId: string, to: ApprovalStatus, reason?: string) {
    this.assertCanGovern(actor, "Changing desk card status");

    const before = await prisma.deskCard.findUnique({ where: { id: deskCardId } });
    if (!before) throw new NotFoundException(`Desk card ${deskCardId} not found`);

    if (before.status === to) {
      throw new BadRequestException(`Desk card is already ${to}`);
    }
    if (to === ApprovalStatus.RETIRED && !reason?.trim()) {
      throw new BadRequestException("Retiring a desk card requires a reason");
    }

    const after = await prisma.deskCard.update({
      where: { id: deskCardId },
      data: {
        status: to,
        approvedByUserId: to === ApprovalStatus.APPROVED ? actor.id : before.approvedByUserId,
        approvedAt: to === ApprovalStatus.APPROVED ? new Date() : before.approvedAt,
      },
    });

    await this.audit.record({
      entityType: "DeskCard",
      entityId: deskCardId,
      action: to === ApprovalStatus.APPROVED ? "approved" : `status_changed_to_${to.toLowerCase()}`,
      actorId: actor.id,
      before: { status: before.status },
      after: { status: after.status },
      reason,
    });

    return after;
  }

  /**
   * One-click handover (TM-FR-077).
   *
   * Transfers FUTURE generation only. Tasks already generated stay with their
   * current assignee and are handled by the reassignment and exit-checklist
   * rules in Phase 5 - moving them silently here would rewrite who did what.
   *
   * The outgoing holder is never overwritten: their history row is closed and a
   * new one opened, in one transaction so the card can never show two current
   * holders or none.
   */
  async transferHolder(actor: AuthenticatedUser, input: TransferHolderInput) {
    this.assertCanGovern(actor, "Transferring a desk card");

    if (!input.reason?.trim()) {
      throw new BadRequestException("Transferring a desk card requires a reason");
    }

    const before = await prisma.deskCard.findUnique({ where: { id: input.deskCardId } });
    if (!before) throw new NotFoundException(`Desk card ${input.deskCardId} not found`);
    if (before.holderEmployeeId === input.toEmployeeId) {
      throw new BadRequestException("That employee already holds this desk card");
    }

    const employee = await prisma.employee.findUnique({ where: { id: input.toEmployeeId } });
    if (!employee) throw new NotFoundException(`Employee ${input.toEmployeeId} not found`);
    if (!employee.isActive) {
      throw new BadRequestException("Cannot transfer a desk card to an inactive employee");
    }

    const now = new Date();

    const after = await prisma.$transaction(async (tx) => {
      if (before.holderEmployeeId) {
        await tx.deskCardHolderHistory.updateMany({
          where: { deskCardId: before.id, employeeId: before.holderEmployeeId, toDate: null },
          data: { toDate: now },
        });
      }

      await tx.deskCardHolderHistory.create({
        data: {
          deskCardId: before.id,
          employeeId: input.toEmployeeId,
          fromDate: now,
          reason: input.reason,
          actorUserId: actor.id,
        },
      });

      return tx.deskCard.update({
        where: { id: before.id },
        data: {
          holderEmployeeId: input.toEmployeeId,
          holderSince: now,
          // A new holder has not acknowledged the card they have just been given.
          acknowledgedAt: null,
        },
      });
    });

    await this.audit.record({
      entityType: "DeskCard",
      entityId: before.id,
      action: "holder_transferred",
      actorId: actor.id,
      before: { holderEmployeeId: before.holderEmployeeId },
      after: { holderEmployeeId: after.holderEmployeeId },
      reason: input.reason,
    });

    return after;
  }

  /**
   * TM-FR-078. Recorded, but deliberately not a gate on generation - work does
   * not stop because someone has not clicked acknowledge.
   */
  async acknowledge(actor: AuthenticatedUser, deskCardId: string) {
    const card = await prisma.deskCard.findUnique({
      where: { id: deskCardId },
      include: { holder: { select: { id: true } } },
    });
    if (!card) throw new NotFoundException(`Desk card ${deskCardId} not found`);

    if (!actor.employeeId || card.holderEmployeeId !== actor.employeeId) {
      throw new ForbiddenException("Only the current holder can acknowledge a desk card");
    }

    const after = await prisma.deskCard.update({
      where: { id: deskCardId },
      data: { acknowledgedAt: new Date() },
    });

    await this.audit.record({
      entityType: "DeskCard",
      entityId: deskCardId,
      action: "acknowledged",
      actorId: actor.id,
      after: { acknowledgedAt: after.acknowledgedAt },
    });

    return after;
  }

  /** The desk card held by the calling user, if any. Powers their own view. */
  async findMine(actor: AuthenticatedUser) {
    if (!actor.employeeId) return null;
    return prisma.deskCard.findFirst({
      where: { holderEmployeeId: actor.employeeId, status: { not: ApprovalStatus.RETIRED } },
      include: {
        department: { select: { id: true, name: true } },
        activities: {
          where: { isActive: true, status: ApprovalStatus.APPROVED },
          orderBy: [{ priority: "asc" }, { title: "asc" }],
          include: { taskType: { select: { id: true, code: true, name: true } } },
        },
      },
    });
  }

  /**
   * Total committed minutes per week across a card's active activities.
   * Feeds capacity in Phase 2 and the WTU denominator in Addendum 02, so the
   * arithmetic lives here rather than being re-derived per screen.
   */
  weeklyCommittedMinutes(activities: { estimatedMinutes: number; frequency: string | null; interval: number }[]) {
    const perWeek: Record<string, number> = {
      DAILY: 5, // working days
      WEEKLY: 1,
      MONTHLY: 12 / 52,
      QUARTERLY: 4 / 52,
      YEARLY: 1 / 52,
    };
    return activities.reduce((total, a) => {
      if (!a.frequency) return total;
      const occurrences = (perWeek[a.frequency] ?? 0) / Math.max(a.interval, 1);
      return total + a.estimatedMinutes * occurrences;
    }, 0);
  }
}

export type DeskCardWithDetail = Prisma.PromiseReturnType<DeskCardService["findById"]>;
