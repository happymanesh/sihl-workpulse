import { Injectable, Logger } from "@nestjs/common";
import { Prisma, TaskStatus, prisma } from "@workpulse/db";
import { SlaService } from "../sla/sla.service";
import {
  assessAccuracy,
  assessRisk,
  isAssessable,
  type PredictionInputs,
  type RiskAssessment,
} from "./prediction-core";

const SETTLED: TaskStatus[] = [
  TaskStatus.COMPLETED,
  TaskStatus.VERIFIED,
  TaskStatus.CLOSED,
  TaskStatus.CANCELLED,
];

/**
 * SLA-breach risk assessment.
 *
 * Predictions are STORED rather than computed per request, for one reason: a
 * prediction nobody scores is decoration. `SlaPrediction.actuallyBreached` is
 * backfilled when the task settles, and `accuracy()` reports whether the model
 * is beating the base rate. If it is not, that should be visible and said
 * plainly rather than discovered a year later.
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);

  constructor(private readonly sla: SlaService) {}

  /**
   * Assesses one task. Returns null when the task cannot meaningfully breach -
   * settled, paused, or with no SLA attached.
   */
  async assessTask(taskId: string, asOf: Date = new Date()): Promise<RiskAssessment | null> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        priority: true,
        dueDate: true,
        assigneeEmployeeId: true,
        blockingOwnerEmployeeId: true,
        taskTypeId: true,
        checklistItems: { select: { isDone: true } },
        statusHistory: { select: { fromStatus: true, toStatus: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!task || !isAssessable(task.status)) return null;

    const assessment = await this.sla.assess(task.id, asOf);
    if (!assessment) return null; // no SLA applies - nothing to predict

    // Active minutes come from the assessment rather than being recomputed
    // here: the predictor and the escalation engine must never disagree about
    // how much of the window has been used.

    const [assigneeOverdueCount, taskTypeBreachRate] = await Promise.all([
      prisma.task.count({
        where: {
          assigneeEmployeeId: task.assigneeEmployeeId,
          id: { not: task.id },
          dueDate: { lt: asOf },
          status: { notIn: SETTLED },
        },
      }),
      this.taskTypeBreachRate(task.taskTypeId),
    ]);

    const STARTED_STATES: TaskStatus[] = [TaskStatus.IN_PROGRESS, TaskStatus.PENDING_REVIEW];
    const REWORK_STATES: TaskStatus[] = [TaskStatus.REJECTED, TaskStatus.REOPENED];

    const started = task.statusHistory.some((h) => STARTED_STATES.includes(h.toStatus));

    const inputs: PredictionInputs = {
      status: task.status,
      priority: task.priority,
      activeMinutes: assessment.activeMinutes,
      resolutionMinutes: assessment.resolutionMinutes,
      hasStarted: started,
      reworkCount: task.statusHistory.filter((h) => REWORK_STATES.includes(h.toStatus)).length,
      blockCount: task.statusHistory.filter((h) => h.toStatus === TaskStatus.BLOCKED).length,
      isBlockedWithoutOwner:
        task.status === TaskStatus.BLOCKED && task.blockingOwnerEmployeeId === null,
      assigneeOverdueCount,
      taskTypeBreachRate,
      checklistProgress:
        task.checklistItems.length === 0
          ? null
          : task.checklistItems.filter((c) => c.isDone).length / task.checklistItems.length,
    };

    return assessRisk(inputs);
  }

  /**
   * Historic breach rate for a task type, or null when there is not enough
   * history to say.
   *
   * The floor matters: three tasks of which one breached is not a 33% breach
   * rate, it is three tasks. Returning null keeps that factor out of the
   * assessment entirely rather than letting it invent a signal.
   */
  private async taskTypeBreachRate(taskTypeId: string, floor = 20): Promise<number | null> {
    const [settled, breached] = await Promise.all([
      prisma.task.count({ where: { taskTypeId, status: { in: SETTLED } } }),
      prisma.task.count({
        where: {
          taskTypeId,
          status: { in: SETTLED },
          escalations: { some: { thresholdPercent: { gte: 100 } } },
        },
      }),
    ]);
    if (settled < floor) return null;
    return breached / settled;
  }

  /** Assesses every open, SLA-bearing task and records what it found. */
  async runSweep(asOf: Date = new Date()) {
    const open = await prisma.task.findMany({
      where: { status: { notIn: SETTLED } },
      select: { id: true, status: true },
    });

    let assessed = 0;
    let recorded = 0;
    const errors: string[] = [];

    for (const t of open) {
      if (!isAssessable(t.status)) continue;
      try {
        const result = await this.assessTask(t.id, asOf);
        if (!result) continue;
        assessed += 1;

        await prisma.slaPrediction.create({
          data: {
            taskId: t.id,
            risk: result.risk,
            factorsJson: result.factors as unknown as Prisma.InputJsonValue,
            predictedAt: asOf,
          },
        });
        recorded += 1;
      } catch (err) {
        errors.push(`${t.id}: ${(err as Error).message}`);
      }
    }

    return { open: open.length, assessed, recorded, errors };
  }

  /**
   * Backfills outcomes for settled tasks.
   *
   * A breach is recorded from the escalation trail rather than recomputed, so
   * the outcome is whatever the SLA engine actually said at the time - not a
   * later re-derivation that might disagree with the escalation people received.
   */
  async recordOutcomes(): Promise<{ updated: number }> {
    const pending = await prisma.slaPrediction.findMany({
      where: { actuallyBreached: null, task: { status: { in: SETTLED } } },
      select: { id: true, taskId: true },
      take: 2000,
    });
    if (pending.length === 0) return { updated: 0 };

    const breachedTaskIds = new Set(
      (
        await prisma.taskEscalation.findMany({
          where: { taskId: { in: pending.map((p) => p.taskId) }, thresholdPercent: { gte: 100 } },
          select: { taskId: true },
          distinct: ["taskId"],
        })
      ).map((e) => e.taskId),
    );

    const now = new Date();
    let updated = 0;
    for (const p of pending) {
      await prisma.slaPrediction.update({
        where: { id: p.id },
        data: { actuallyBreached: breachedTaskIds.has(p.taskId), outcomeAt: now },
      });
      updated += 1;
    }
    return { updated };
  }

  /**
   * How the model has actually performed.
   *
   * Surfaced in the UI, not buried in a log. A model whose skill is at or below
   * zero is not helping, and the people relying on it are entitled to know.
   */
  async accuracy(since?: Date) {
    const scored = await prisma.slaPrediction.findMany({
      where: { actuallyBreached: { not: null }, ...(since ? { predictedAt: { gte: since } } : {}) },
      select: { risk: true, actuallyBreached: true },
    });

    return assessAccuracy(
      scored.map((s) => ({ risk: s.risk, actuallyBreached: Boolean(s.actuallyBreached) })),
    );
  }

  /** Highest-risk open work, for a supervisor's morning triage. */
  async atRisk(limit = 25, departmentId?: string) {
    // Latest prediction per task, so a task assessed repeatedly appears once.
    const latest = await prisma.slaPrediction.findMany({
      where: {
        actuallyBreached: null,
        task: { status: { notIn: SETTLED }, ...(departmentId ? { departmentId } : {}) },
      },
      orderBy: { predictedAt: "desc" },
      select: {
        id: true,
        risk: true,
        factorsJson: true,
        predictedAt: true,
        task: {
          select: {
            id: true,
            reference: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignee: { select: { name: true } },
          },
        },
      },
      take: 500,
    });

    const seen = new Set<string>();
    return latest
      .filter((p) => {
        if (seen.has(p.task.id)) return false;
        seen.add(p.task.id);
        return true;
      })
      .sort((a, b) => b.risk - a.risk)
      .slice(0, limit);
  }
}
