import { Injectable, Logger } from "@nestjs/common";
import {
  ActorType,
  ApprovalStatus,
  TaskOrigin,
  TaskStatus,
  prisma,
  type DeskCardActivity,
} from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import { dueDatesToGenerate, toDayKey, type HolidaySet } from "./recurrence-core";

export interface GenerationResult {
  startedAt: string;
  finishedAt: string;
  activitiesConsidered: number;
  tasksGenerated: number;
  tasksMarkedMissed: number;
  errors: string[];
}

/**
 * Generates Task instances from Desk Card Activities.
 *
 * The single recurrence engine (Addendum 01 Section 3.3). Safe to run
 * repeatedly: generation is driven by each activity's `lastGeneratedFor`, so a
 * second run in the same day, or a catch-up after an outage, produces each
 * occurrence exactly once.
 */
@Injectable()
export class RecurrenceService {
  private readonly logger = new Logger(RecurrenceService.name);

  constructor(private readonly audit: AuditService) {}

  /**
   * Non-working days.
   *
   * Currently weekends only. The BRS reuses Frappe's Holiday List, which is not
   * yet synced - when it is, this is the one place that changes, and every
   * date calculation picks it up because they all take the set as an argument.
   */
  private async loadHolidays(): Promise<HolidaySet> {
    return new Set<string>();
  }

  private async nextReference(): Promise<string> {
    const [{ nextval }] = await prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('task_reference_seq') AS nextval
    `;
    return `WP-${String(nextval).padStart(6, "0")}`;
  }

  /**
   * One generation pass.
   *
   * An activity is eligible only when everything in the chain is live: the card
   * is Approved and has a holder, and the activity is Approved, active and not
   * paused. Pausing or losing a holder stops FUTURE generation and touches
   * nothing already created (TM-FR-002, TM-FR-079).
   */
  async generateDue(asOf: Date = new Date()): Promise<GenerationResult> {
    const startedAt = new Date().toISOString();
    const errors: string[] = [];
    let tasksGenerated = 0;

    const holidays = await this.loadHolidays();

    const activities = await prisma.deskCardActivity.findMany({
      where: {
        status: ApprovalStatus.APPROVED,
        isActive: true,
        isPaused: false,
        frequency: { not: null },
        deskCard: {
          status: ApprovalStatus.APPROVED,
          holderEmployeeId: { not: null },
        },
      },
      include: {
        deskCard: { select: { id: true, holderEmployeeId: true, departmentId: true } },
        taskType: { select: { id: true } },
      },
    });

    for (const activity of activities) {
      try {
        tasksGenerated += await this.generateForActivity(activity, asOf, holidays);
      } catch (err) {
        const message = `Activity ${activity.id} (${activity.title}): ${(err as Error).message}`;
        this.logger.error(message);
        errors.push(message);
      }
    }

    const tasksMarkedMissed = await this.flagMissed(asOf);

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      activitiesConsidered: activities.length,
      tasksGenerated,
      tasksMarkedMissed,
      errors,
    };
  }

  private async generateForActivity(
    activity: DeskCardActivity & { deskCard: { id: string; holderEmployeeId: string | null; departmentId: string } },
    asOf: Date,
    holidays: HolidaySet,
  ): Promise<number> {
    const holderId = activity.deskCard.holderEmployeeId;
    if (!holderId) return 0;

    const dueDates = dueDatesToGenerate(
      {
        frequency: activity.frequency,
        interval: activity.interval,
        daysOfWeek: activity.daysOfWeek,
        dayOfMonth: activity.dayOfMonth,
        startDate: activity.startDate,
        endDate: activity.endDate,
      },
      activity.lastGeneratedFor,
      asOf,
      activity.leadTimeDays,
      holidays,
    );

    if (dueDates.length === 0) return 0;

    // TM-FR-083: resolve the approved workflow version ONCE per pass and pin it
    // onto every task created here. Looked up now rather than read through the
    // activity later, because "the procedure in force when this was generated"
    // is the thing an auditor needs, and it changes over time.
    const workflow = await prisma.workflow.findUnique({
      where: { deskCardActivityId: activity.id },
      select: { id: true },
    });
    const pinnedVersion = workflow
      ? await prisma.workflowVersion.findFirst({
          where: { workflowId: workflow.id, status: ApprovalStatus.APPROVED },
          orderBy: { versionNumber: "desc" },
          select: { id: true },
        })
      : null;

    let created = 0;
    for (const dueDate of dueDates) {
      // Belt and braces against double-generation: lastGeneratedFor is the
      // primary guard, but a crash between creating the task and updating the
      // activity would otherwise repeat one instance. Checking first makes the
      // whole pass replay-safe.
      const existing = await prisma.task.findFirst({
        where: { deskCardActivityId: activity.id, dueDate },
        select: { id: true },
      });
      if (existing) continue;

      const reference = await this.nextReference();

      const task = await prisma.$transaction(async (tx) => {
        const t = await tx.task.create({
          data: {
            reference,
            title: activity.title,
            description: activity.description,
            taskTypeId: activity.taskTypeId,
            priority: activity.priority,
            origin: TaskOrigin.DESK_CARD,
            status: TaskStatus.ASSIGNED,
            deskCardActivityId: activity.id,
            workflowVersionId: pinnedVersion?.id,
            assigneeEmployeeId: holderId,
            departmentId: activity.deskCard.departmentId,
            dueDate,
            estimatedMinutes: activity.estimatedMinutes,
          },
        });

        await tx.taskStatusHistory.create({
          data: {
            taskId: t.id,
            fromStatus: null,
            toStatus: TaskStatus.ASSIGNED,
            // Generated by the scheduler, not a person. TM-FR-065 requires an
            // actor on every transition; SYSTEM is that actor here.
            actorType: ActorType.SYSTEM,
          },
        });

        await tx.deskCardActivity.update({
          where: { id: activity.id },
          data: { lastGeneratedFor: dueDate },
        });

        return t;
      });

      await this.audit.record({
        entityType: "Task",
        entityId: task.id,
        action: "generated_from_activity",
        actorType: ActorType.SYSTEM,
        after: {
          reference: task.reference,
          deskCardActivityId: activity.id,
          workflowVersionId: pinnedVersion?.id ?? null,
          assigneeEmployeeId: holderId,
          dueDate: toDayKey(dueDate),
        },
      });

      created++;
    }

    return created;
  }

  /**
   * TM-FR-003: a recurring instance that passed its due date without ever being
   * started is Missed - a distinct signal from merely overdue, because nobody
   * even picked it up.
   */
  private async flagMissed(asOf: Date): Promise<number> {
    const { count } = await prisma.task.updateMany({
      where: {
        origin: TaskOrigin.DESK_CARD,
        isMissed: false,
        startedAt: null,
        dueDate: { lt: asOf },
        status: { in: [TaskStatus.ASSIGNED, TaskStatus.ACCEPTED] },
      },
      data: { isMissed: true },
    });

    if (count > 0) {
      this.logger.warn(`${count} recurring task(s) flagged as missed`);
    }
    return count;
  }
}
