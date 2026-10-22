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

export interface UpdateDeskCardInput {
  id: string;
  name?: string;
  description?: string | null;
  departmentId?: string;
  reason?: string;
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
          include: {
            // requiresVerification comes along because the detail screen has to
            // explain WHY an activity cannot be approved yet, and that answer
            // depends on it. Without these the screen can only say "approve an
            // activity first", which is true and useless.
            taskType: { select: { id: true, code: true, name: true, requiresVerification: true } },
            workflow: {
              select: {
                versions: {
                  where: { status: ApprovalStatus.APPROVED },
                  select: { id: true },
                  take: 1,
                },
              },
            },
            // The control each obligation serves. Without it the detail page
            // cannot show why the work exists, which is the whole point of
            // requiring the link before approval.
            process: { select: { id: true, code: true, name: true, status: true } },
          },
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
   * Corrects the card itself - its name, its description, or the department it
   * belongs to.
   *
   * The department is not decoration. A generated task takes its department
   * from the card, not from whoever happens to hold it, so the department
   * decides which SLA definitions match the work and who gets escalated to
   * when it breaches. A card sitting in the wrong department quietly sends
   * every breach to the wrong head, which is why moving one needs a reason
   * recorded against it.
   *
   * The code is deliberately not editable: it is what audit trails, exports
   * and anything outside workPulse use to refer to this card. A card created
   * under the wrong code is retired and replaced, not renamed underneath
   * everything that already points at it.
   */
  async update(actor: AuthenticatedUser, input: UpdateDeskCardInput) {
    this.assertCanGovern(actor, "Editing a desk card");

    const before = await prisma.deskCard.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundException(`Desk card ${input.id} not found`);

    const movingDepartment =
      input.departmentId !== undefined && input.departmentId !== before.departmentId;

    if (movingDepartment && !input.reason?.trim()) {
      throw new BadRequestException(
        "Moving a desk card to another department requires a reason - it changes which SLAs apply and who is escalated to",
      );
    }

    if (movingDepartment) {
      const department = await prisma.department.findUnique({
        where: { id: input.departmentId },
        select: { id: true },
      });
      if (!department) throw new NotFoundException("That department does not exist");
    }

    const data: Prisma.DeskCardUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description?.trim() ?? null;
    if (movingDepartment) data.department = { connect: { id: input.departmentId } };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Nothing to change");
    }

    const after = await prisma.deskCard.update({ where: { id: before.id }, data });

    await this.audit.record({
      entityType: "DeskCard",
      entityId: before.id,
      action: "updated",
      actorId: actor.id,
      before: {
        name: before.name,
        description: before.description,
        departmentId: before.departmentId,
      },
      after: { name: after.name, description: after.description, departmentId: after.departmentId },
      reason: input.reason,
    });

    return after;
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

  /**
   * Every desk card the calling user holds.
   *
   * Plural on purpose. holderEmployeeId is not unique and somebody can
   * legitimately hold two seats - a Compliance Officer who is also Risk
   * Committee Secretary - and this used findFirst, so the second card and every
   * obligation on it were invisible to the person carrying them.
   */
  async findMine(actor: AuthenticatedUser) {
    if (!actor.employeeId) return [];
    return prisma.deskCard.findMany({
      where: { holderEmployeeId: actor.employeeId, status: { not: ApprovalStatus.RETIRED } },
      // Deterministic, so two cards do not swap places between visits.
      orderBy: [{ holderSince: "desc" }, { code: "asc" }],
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
