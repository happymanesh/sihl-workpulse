import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { TaskAttachmentKind, TaskCommentKind, TaskStatus, prisma } from "@workpulse/db";
import { FlagService } from "./flag.service";
import {
  flagAbnormalSplitting,
  flagClosuresWithoutEvidence,
  flagReassignmentPatterns,
  type ClosureEvidence,
  type CreatedTask,
  type ReassignmentEvent,
} from "./antigaming-core";

/**
 * Runs the three anti-gaming heuristics over a trailing window.
 *
 * Nightly rather than continuously: two of the three are PATTERN detectors that
 * need a window to see anything, and a heuristic that fires the instant a
 * threshold is crossed would flag people mid-day for work they were still
 * doing.
 *
 * The job only raises flags. Nothing here changes anyone's numbers - that
 * happens when a human reviews the flag in FlagService.
 */
@Injectable()
export class AntiGamingJob {
  private readonly logger = new Logger(AntiGamingJob.name);
  private running = false;

  constructor(private readonly flags: FlagService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: "anti-gaming" })
  async nightly(): Promise<void> {
    if (this.running) {
      this.logger.warn("Previous anti-gaming pass still running; skipping this tick");
      return;
    }
    this.running = true;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      const result = await this.run(start, end);
      if (result.created > 0) {
        this.logger.log(`Anti-gaming pass raised ${result.created} flag(s)`);
      }
    } catch (err) {
      this.logger.error(`Anti-gaming pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Exposed so the pass can be run on demand for a specific window. */
  async run(windowStart: Date, windowEnd: Date) {
    const [closures, reassignments, created] = await Promise.all([
      this.closureEvidence(windowStart, windowEnd),
      this.reassignmentEvents(windowStart, windowEnd),
      this.createdTasks(windowStart, windowEnd),
    ]);

    const candidates = [
      ...flagClosuresWithoutEvidence(closures),
      ...flagReassignmentPatterns(reassignments),
      ...flagAbnormalSplitting(created),
    ];

    return this.flags.raise(candidates, windowStart, windowEnd);
  }

  // -------------------------------------------------------------------------

  private async closureEvidence(from: Date, to: Date): Promise<ClosureEvidence[]> {
    const tasks = await prisma.task.findMany({
      where: {
        status: { in: [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.CLOSED] },
        completedAt: { gte: from, lte: to },
        taskType: { requiresEvidence: true },
      },
      select: {
        id: true,
        reference: true,
        assigneeEmployeeId: true,
        checklistItems: { select: { isDone: true } },
        statusHistory: {
          where: { toStatus: { in: [TaskStatus.COMPLETED, TaskStatus.CLOSED] } },
          select: { reason: true },
        },
        comments: {
          where: { kind: { in: [TaskCommentKind.COMPLETION, TaskCommentKind.REVIEW] } },
          select: { id: true },
        },
        attachments: {
          // Withdrawn files do not count. A file attached and then taken off
          // again is not evidence that the work was done, and the audit trail
          // still shows both, so nothing is hidden by leaving it out here.
          where: { kind: TaskAttachmentKind.EVIDENCE, removedAt: null },
          select: { id: true },
        },
      },
    });

    return tasks.map((t) => ({
      taskId: t.id,
      reference: t.reference,
      assigneeEmployeeId: t.assigneeEmployeeId,
      requiresEvidence: true,
      hasChecklistCompletion: t.checklistItems.some((i) => i.isDone),
      hasAttachment: t.attachments.length > 0,
      // A real completion or review note now, rather than the old proxy of
      // "did the closing transition happen to carry a reason". Both still
      // count: a reason given at closure is evidence too.
      hasComment:
        t.comments.length > 0 || t.statusHistory.some((h) => Boolean(h.reason?.trim())),
    }));
  }

  private async reassignmentEvents(from: Date, to: Date): Promise<ReassignmentEvent[]> {
    // Reassignment is not a status change, so it is read from the audit trail -
    // the one record that cannot have been edited away.
    const entries = await prisma.auditLog.findMany({
      where: {
        entityType: "Task",
        action: "REASSIGN",
        createdAt: { gte: from, lte: to },
      },
      select: { entityId: true, actorId: true, beforeJson: true, createdAt: true },
    });

    const taskIds = entries.map((e) => e.entityId);
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, dueDate: true },
    });
    const dueById = new Map(tasks.map((t) => [t.id, t.dueDate]));

    const events: ReassignmentEvent[] = [];
    for (const e of entries) {
      const before = e.beforeJson as { assigneeEmployeeId?: string } | null;
      const fromEmployeeId = before?.assigneeEmployeeId;
      const dueDate = dueById.get(e.entityId);
      if (!fromEmployeeId || !e.actorId || !dueDate) continue;

      events.push({
        taskId: e.entityId,
        fromEmployeeId,
        byUserId: e.actorId,
        // Overdue AT THE MOMENT of reassignment, not as of now: moving work
        // that still had time left is ordinary load-balancing.
        wasOverdue: dueDate < e.createdAt,
      });
    }
    return events;
  }

  private async createdTasks(from: Date, to: Date): Promise<CreatedTask[]> {
    const entries = await prisma.auditLog.findMany({
      where: { entityType: "Task", action: "CREATE", createdAt: { gte: from, lte: to } },
      select: { entityId: true, actorId: true, createdAt: true },
    });

    const users = await prisma.user.findMany({
      where: { id: { in: entries.map((e) => e.actorId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, employeeId: true },
    });
    const employeeByUser = new Map(users.map((u) => [u.id, u.employeeId]));

    const tasks = await prisma.task.findMany({
      where: { id: { in: entries.map((e) => e.entityId) } },
      select: { id: true, estimatedMinutes: true },
    });
    const minutesById = new Map(tasks.map((t) => [t.id, t.estimatedMinutes]));

    const out: CreatedTask[] = [];
    for (const e of entries) {
      const employeeId = e.actorId ? employeeByUser.get(e.actorId) : null;
      if (!employeeId) continue;
      out.push({
        taskId: e.entityId,
        createdByEmployeeId: employeeId,
        dayKey: e.createdAt.toISOString().slice(0, 10),
        estimatedMinutes: minutesById.get(e.entityId) ?? null,
      });
    }
    return out;
  }
}
