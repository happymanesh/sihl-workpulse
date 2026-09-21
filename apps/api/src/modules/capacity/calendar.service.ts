import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, TaskStatus, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";
import {
  endOfWeek,
  overlaps,
  startOfWeek,
  totalBlockedMinutes,
  utilisation,
  weeklyCommittedMinutes,
} from "./capacity-core";

export interface CreateBlockInput {
  taskId?: string;
  title?: string;
  startAt: Date;
  endAt: Date;
  /** Blocking on someone else's calendar requires a manager role. */
  employeeId?: string;
}

const MAX_BLOCK_MINUTES = 12 * 60;

@Injectable()
export class CalendarService {
  constructor(private readonly audit: AuditService) {}

  private isManager(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.MANAGER) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD) ||
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN)
    );
  }

  /**
   * Resolves whose calendar is being written to.
   *
   * Defaults to the caller's own. Blocking time on somebody else's calendar is
   * a managerial act, not an ordinary one - a peer silently filling your day is
   * how a planning tool becomes a nuisance.
   */
  private resolveOwner(actor: AuthenticatedUser, employeeId?: string): string {
    const target = employeeId ?? actor.employeeId;
    if (!target) {
      throw new BadRequestException(
        "Your Synapse account is not linked to an employee record, so you have no calendar yet",
      );
    }
    if (target !== actor.employeeId && !this.isManager(actor)) {
      throw new ForbiddenException("Only a manager can block time on someone else's calendar");
    }
    return target;
  }

  async listBlocks(actor: AuthenticatedUser, params: { from: Date; to: Date; employeeId?: string }) {
    const employeeId = params.employeeId ?? actor.employeeId;
    if (!employeeId) return [];
    if (employeeId !== actor.employeeId && !this.isManager(actor)) {
      throw new ForbiddenException("Only a manager can view someone else's calendar");
    }

    return prisma.timeBlock.findMany({
      where: { employeeId, startAt: { gte: params.from }, endAt: { lte: params.to } },
      include: {
        task: {
          select: { id: true, reference: true, title: true, priority: true, status: true, dueDate: true },
        },
      },
      orderBy: { startAt: "asc" },
    });
  }

  async createBlock(actor: AuthenticatedUser, input: CreateBlockInput) {
    const employeeId = this.resolveOwner(actor, input.employeeId);

    if (input.endAt <= input.startAt) {
      throw new BadRequestException("A block must end after it starts");
    }
    const minutes = (input.endAt.getTime() - input.startAt.getTime()) / 60_000;
    if (minutes > MAX_BLOCK_MINUTES) {
      throw new BadRequestException("A single block cannot be longer than 12 hours");
    }
    if (!input.taskId && !input.title?.trim()) {
      throw new BadRequestException("Give the block a title, or attach it to a task");
    }

    if (input.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: input.taskId },
        select: { id: true, status: true, assigneeEmployeeId: true },
      });
      if (!task) throw new NotFoundException("Task not found");
      const settled: TaskStatus[] = [TaskStatus.CLOSED, TaskStatus.CANCELLED];
      if (settled.includes(task.status)) {
        throw new BadRequestException("That task is closed; there is nothing left to plan for it");
      }
    }

    // Double-booking would double-count against capacity, making the figure
    // meaningless. Rejecting is kinder than silently inflating utilisation.
    const sameDay = await prisma.timeBlock.findMany({
      where: {
        employeeId,
        startAt: { lt: input.endAt },
        endAt: { gt: input.startAt },
      },
      select: { id: true, startAt: true, endAt: true, title: true, task: { select: { title: true } } },
    });
    const clash = sameDay.find((b) => overlaps(b, { startAt: input.startAt, endAt: input.endAt }));
    if (clash) {
      const what = clash.task?.title ?? clash.title ?? "another block";
      throw new BadRequestException(`That overlaps "${what}" already in the calendar`);
    }

    const block = await prisma.timeBlock.create({
      data: {
        employeeId,
        taskId: input.taskId,
        title: input.title?.trim(),
        startAt: input.startAt,
        endAt: input.endAt,
        createdByUserId: actor.id,
      },
      include: { task: { select: { id: true, reference: true, title: true } } },
    });

    await this.audit.record({
      entityType: "TimeBlock",
      entityId: block.id,
      action: "created",
      actorId: actor.id,
      after: {
        employeeId,
        taskId: block.taskId,
        startAt: block.startAt,
        endAt: block.endAt,
      },
    });

    return block;
  }

  async deleteBlock(actor: AuthenticatedUser, blockId: string) {
    const block = await prisma.timeBlock.findUnique({ where: { id: blockId } });
    if (!block) throw new NotFoundException("Block not found");
    if (block.employeeId !== actor.employeeId && !this.isManager(actor)) {
      throw new ForbiddenException("You can only remove blocks from your own calendar");
    }

    await prisma.timeBlock.delete({ where: { id: blockId } });

    await this.audit.record({
      entityType: "TimeBlock",
      entityId: blockId,
      action: "deleted",
      actorId: actor.id,
      before: { employeeId: block.employeeId, startAt: block.startAt, endAt: block.endAt },
    });

    return { id: blockId };
  }

  /**
   * Committed load, blocked time and utilisation for one employee.
   *
   * Committed comes from the desk card's approved, active activities - the
   * governed estimates - not from what the person chose to put in their diary.
   * Blocked is what they actually planned. The two answer different questions
   * and are reported separately on purpose.
   */
  async utilisationFor(employeeId: string, weekOf: Date = new Date()) {
    const from = startOfWeek(weekOf);
    const to = endOfWeek(weekOf);

    const [budget, card, blocks] = await Promise.all([
      prisma.capacityBudget.findUnique({ where: { employeeId } }),
      prisma.deskCard.findFirst({
        where: { holderEmployeeId: employeeId, status: ApprovalStatus.APPROVED },
        include: {
          activities: {
            where: { status: ApprovalStatus.APPROVED, isActive: true, isPaused: false },
            select: { estimatedMinutes: true, frequency: true, interval: true },
          },
        },
      }),
      prisma.timeBlock.findMany({
        where: { employeeId, startAt: { gte: from }, endAt: { lte: to } },
        select: { startAt: true, endAt: true },
      }),
    ]);

    const committed = weeklyCommittedMinutes(card?.activities ?? []);
    const blocked = totalBlockedMinutes(blocks);

    return {
      employeeId,
      weekStart: from,
      hasBudget: Boolean(budget),
      ...utilisation(budget?.weeklyMinutes ?? 0, committed, blocked),
    };
  }

  /**
   * TM-FR-051 + TM-FR-052: the manager's team view.
   *
   * Counts and utilisation per member, so "who is overloaded" and "who has
   * capacity" are answerable without asking anyone.
   */
  async teamWorkload(actor: AuthenticatedUser, departmentId?: string) {
    if (!this.isManager(actor)) {
      throw new ForbiddenException("Team workload is available to managers and department heads");
    }

    const employees = await prisma.employee.findMany({
      where: { isActive: true, departmentId: departmentId ?? undefined },
      select: { id: true, name: true, designation: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    return Promise.all(
      employees.map(async (e) => {
        const [open, critical, overdue, blocked, util] = await Promise.all([
          prisma.task.count({
            where: { assigneeEmployeeId: e.id, status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] } },
          }),
          prisma.task.count({
            where: {
              assigneeEmployeeId: e.id,
              priority: "CRITICAL",
              status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] },
            },
          }),
          prisma.task.count({
            where: {
              assigneeEmployeeId: e.id,
              dueDate: { lt: now },
              status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED, TaskStatus.VERIFIED] },
            },
          }),
          prisma.task.count({ where: { assigneeEmployeeId: e.id, status: TaskStatus.BLOCKED } }),
          this.utilisationFor(e.id, now),
        ]);

        return {
          employee: e,
          counts: { open, critical, overdue, blocked },
          utilisation: util,
        };
      }),
    );
  }

  async setBudget(actor: AuthenticatedUser, employeeId: string, weeklyMinutes: number) {
    if (!this.isManager(actor)) {
      throw new ForbiddenException("Only a manager can set a capacity budget");
    }
    if (weeklyMinutes <= 0 || weeklyMinutes > 7 * 24 * 60) {
      throw new BadRequestException("Weekly capacity must be a positive number of minutes within a week");
    }

    const before = await prisma.capacityBudget.findUnique({ where: { employeeId } });

    const after = await prisma.capacityBudget.upsert({
      where: { employeeId },
      create: { employeeId, weeklyMinutes, updatedByUserId: actor.id },
      update: { weeklyMinutes, updatedByUserId: actor.id },
    });

    await this.audit.record({
      entityType: "CapacityBudget",
      entityId: after.id,
      action: before ? "updated" : "created",
      actorId: actor.id,
      before: before ? { weeklyMinutes: before.weeklyMinutes } : null,
      after: { employeeId, weeklyMinutes: after.weeklyMinutes },
    });

    return after;
  }
}
