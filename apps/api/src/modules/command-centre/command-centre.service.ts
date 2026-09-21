import { Injectable, Logger } from "@nestjs/common";
import {
  CommandCentreEventType,
  Priority,
  TaskOrigin,
  TaskStatus,
  prisma,
} from "@workpulse/db";
import { SlaService } from "../sla/sla.service";
import {
  blockedEvents,
  breachEvents,
  criticalOverdueEvents,
  missedComplianceEvents,
  projectHealthEvents,
  topLevelEscalationEvents,
  trendOf,
  type EnterprisePulse,
  type EventCandidate,
} from "./command-centre-core";

const SETTLED: TaskStatus[] = [
  TaskStatus.CLOSED,
  TaskStatus.CANCELLED,
];

const HOUR = 60 * 60 * 1000;

/**
 * TM-FR-058: the CEO Command Centre feed.
 *
 * Two properties are enforced here rather than left to the consumer:
 *
 *   1. **Confidential work never enters the stream.** The exclusion is applied
 *      when events are GENERATED, not when they are read. A consumer holding an
 *      integration token has no parameter that widens it, because the excluded
 *      rows were never written.
 *
 *   2. **The feed is a cursor, not a dashboard.** A consumer asks "what has
 *      happened since sequence N". That is what lets the Command Centre run on
 *      its own cadence without WMP knowing how it renders, and what makes
 *      re-delivery safe.
 */
@Injectable()
export class CommandCentreService {
  private readonly logger = new Logger(CommandCentreService.name);

  constructor(private readonly sla: SlaService) {}

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  /**
   * Detects everything currently worth an executive's attention.
   *
   * Every query below carries `isConfidential: false`. That is the single most
   * important line in this file: a BFSI entity whose CEO feed leaked HR, legal
   * or disciplinary matters to an integration account would have built an
   * exposure, not a control.
   */
  async detect(asOf: Date = new Date()): Promise<EventCandidate[]> {
    const notConfidential = { isConfidential: false as const };

    const [openTasks, escalations, projects] = await Promise.all([
      prisma.task.findMany({
        where: { ...notConfidential, status: { notIn: SETTLED } },
        select: {
          id: true,
          reference: true,
          title: true,
          priority: true,
          status: true,
          origin: true,
          dueDate: true,
          isMissed: true,
          blockedReason: true,
          blockingOwnerEmployeeId: true,
          assigneeEmployeeId: true,
          departmentId: true,
          deskCardActivityId: true,
          assignee: { select: { name: true } },
          department: { select: { name: true } },
          statusHistory: {
            where: { toStatus: TaskStatus.BLOCKED },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
      prisma.taskEscalation.findMany({
        where: { task: { ...notConfidential, status: { notIn: SETTLED } } },
        select: {
          taskId: true,
          level: true,
          task: {
            select: {
              reference: true,
              title: true,
              departmentId: true,
              assigneeEmployeeId: true,
              taskTypeId: true,
              assignee: { select: { name: true } },
            },
          },
        },
      }),
      prisma.project.findMany({
        select: { id: true, name: true, health: true },
      }),
    ]);

    // --- SLA breaches -------------------------------------------------------
    const breached: Parameters<typeof breachEvents>[0] = [];
    for (const t of openTasks) {
      if (!t.assignee) continue;
      const a = await this.sla.assess(t.id, asOf);
      if (!a || a.state !== "BREACHED") continue;
      breached.push({
        taskId: t.id,
        reference: t.reference,
        title: t.title,
        priority: t.priority,
        departmentId: t.departmentId,
        departmentName: t.department?.name ?? null,
        assigneeEmployeeId: t.assigneeEmployeeId,
        assigneeName: t.assignee.name,
        overdueMinutes: a.activeMinutes - a.resolutionMinutes,
      });
    }

    // --- Escalations that ran out of chain ----------------------------------
    const maxLevels = await this.maxEscalationLevels();
    const escalationSubjects = escalations.map((e) => ({
      taskId: e.taskId,
      reference: e.task.reference,
      title: e.task.title,
      level: e.level,
      maxLevel: maxLevels.get(e.task.taskTypeId) ?? 0,
      departmentId: e.task.departmentId,
      assigneeEmployeeId: e.task.assigneeEmployeeId,
      assigneeName: e.task.assignee?.name ?? "Unassigned",
    }));

    // --- Overdue, blocked, missed compliance --------------------------------
    const overdue = openTasks
      .filter((t) => t.dueDate < asOf && t.assignee)
      .map((t) => ({
        taskId: t.id,
        reference: t.reference,
        title: t.title,
        priority: t.priority,
        status: t.status,
        overdueHours: (asOf.getTime() - t.dueDate.getTime()) / HOUR,
        departmentId: t.departmentId,
        assigneeEmployeeId: t.assigneeEmployeeId,
        assigneeName: t.assignee!.name,
      }));

    // blockingOwnerEmployeeId carries no Prisma relation, so the names are
    // resolved in one query rather than per task.
    const blockedTasks = openTasks.filter(
      (t) => t.status === TaskStatus.BLOCKED && t.statusHistory[0],
    );
    const blockingOwnerNames = await this.employeeNames(
      blockedTasks.map((t) => t.blockingOwnerEmployeeId),
    );

    const blocked = blockedTasks
      .map((t) => ({
        taskId: t.id,
        reference: t.reference,
        title: t.title,
        blockedHours: (asOf.getTime() - t.statusHistory[0].createdAt.getTime()) / HOUR,
        blockedReason: t.blockedReason,
        blockingOwnerEmployeeId: t.blockingOwnerEmployeeId,
        blockingOwnerName: t.blockingOwnerEmployeeId
          ? blockingOwnerNames.get(t.blockingOwnerEmployeeId) ?? null
          : null,
        departmentId: t.departmentId,
        assigneeEmployeeId: t.assigneeEmployeeId,
      }));

    // Recurring obligations only. An ad-hoc task nobody started is a management
    // matter; a recurring compliance obligation nobody started is a regulatory
    // one, and only the second belongs here.
    const missedCompliance = openTasks
      .filter((t) => t.isMissed && t.origin === TaskOrigin.DESK_CARD && t.deskCardActivityId)
      .map((t) => ({
        taskId: t.id,
        reference: t.reference,
        title: t.title,
        departmentId: t.departmentId,
        departmentName: t.department?.name ?? null,
        assigneeEmployeeId: t.assigneeEmployeeId,
        dueDate: t.dueDate,
      }));

    // --- Project health -----------------------------------------------------
    const previousHealth = await this.previousProjectHealth(projects.map((p) => p.id));
    const healthSubjects = projects.map((p) => ({
      projectId: p.id,
      name: p.name,
      health: p.health,
      previousHealth: previousHealth.get(p.id) ?? null,
      // Project has no owning department - a project spans them by definition.
      departmentId: null,
    }));

    return [
      ...breachEvents(breached),
      ...topLevelEscalationEvents(escalationSubjects),
      ...criticalOverdueEvents(overdue),
      ...blockedEvents(blocked),
      ...missedComplianceEvents(missedCompliance),
      ...projectHealthEvents(healthSubjects),
    ];
  }

  /** Names for a set of employee ids, ignoring nulls and duplicates. */
  private async employeeNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
    if (unique.length === 0) return new Map();
    const rows = await prisma.employee.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Highest escalation level configured per task type. */
  private async maxEscalationLevels(): Promise<Map<string, number>> {
    const defs = await prisma.slaDefinition.findMany({
      where: { isActive: true, taskTypeId: { not: null } },
      select: { taskTypeId: true, escalationRules: { select: { level: true } } },
    });

    const out = new Map<string, number>();
    for (const d of defs) {
      if (!d.taskTypeId) continue;
      const max = d.escalationRules.reduce((m, r) => Math.max(m, r.level), 0);
      out.set(d.taskTypeId, Math.max(out.get(d.taskTypeId) ?? 0, max));
    }
    return out;
  }

  /**
   * The health each project was last reported at.
   *
   * Read from the audit trail rather than a `previousHealth` column, because the
   * audit trail already records every change and a denormalised column would be
   * a second source of truth that could drift from it.
   */
  private async previousProjectHealth(projectIds: string[]) {
    const entries = await prisma.auditLog.findMany({
      where: { entityType: "Project", entityId: { in: projectIds }, action: "SET_HEALTH" },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, beforeJson: true },
    });

    const out = new Map<string, "GREEN" | "AMBER" | "RED">();
    for (const e of entries) {
      if (out.has(e.entityId)) continue; // most recent wins
      const before = e.beforeJson as { health?: "GREEN" | "AMBER" | "RED" } | null;
      if (before?.health) out.set(e.entityId, before.health);
    }
    return out;
  }

  /**
   * Writes newly detected events and closes ones whose condition has lifted.
   *
   * Idempotent by dedupe key: re-running the pass on an unchanged enterprise
   * writes nothing. That is what makes it safe on a short cron.
   */
  async refresh(asOf: Date = new Date()) {
    const candidates = await this.detect(asOf);
    const liveKeys = new Set(candidates.map((c) => c.dedupeKey));

    const open = await prisma.commandCentreEvent.findMany({
      where: { resolvedAt: null },
      select: { id: true, dedupeKey: true },
    });
    const openKeys = new Set(open.map((e) => e.dedupeKey));

    let raised = 0;
    for (const c of candidates) {
      if (openKeys.has(c.dedupeKey)) continue;
      await prisma.commandCentreEvent.create({
        data: {
          eventType: c.eventType,
          severity: c.severity,
          headline: c.headline,
          detail: c.detail,
          taskId: c.taskId,
          projectId: c.projectId,
          departmentId: c.departmentId,
          employeeId: c.employeeId,
          dedupeKey: c.dedupeKey,
          occurredAt: asOf,
        },
      });
      raised += 1;
    }

    // Resolution is as much a part of the feed as the alert. A Command Centre
    // that could only ever accumulate open items would be unreadable by week
    // three.
    const stale = open.filter((e) => !liveKeys.has(e.dedupeKey));
    if (stale.length > 0) {
      await prisma.commandCentreEvent.updateMany({
        where: { id: { in: stale.map((e) => e.id) } },
        data: { resolvedAt: asOf },
      });
    }

    return { detected: candidates.length, raised, resolved: stale.length };
  }

  // -------------------------------------------------------------------------
  // The feed itself
  // -------------------------------------------------------------------------

  /**
   * Events after a cursor position (TM-FR-058).
   *
   * `sequence` is a BigInt in the database and is serialised to a string on the
   * way out: a sequence past 2^53 would silently lose precision as a JSON
   * number, and a cursor that quietly skips events is worse than no cursor.
   */
  async since(cursor: bigint | null, limit = 100, includeResolved = false) {
    const events = await prisma.commandCentreEvent.findMany({
      where: {
        ...(cursor === null ? {} : { sequence: { gt: cursor } }),
        ...(includeResolved ? {} : { resolvedAt: null }),
      },
      orderBy: { sequence: "asc" },
      take: Math.min(limit, 500),
      select: {
        id: true,
        sequence: true,
        eventType: true,
        severity: true,
        headline: true,
        detail: true,
        occurredAt: true,
        resolvedAt: true,
        task: { select: { id: true, reference: true } },
        project: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true } },
      },
    });

    return {
      events: events.map((e) => ({ ...e, sequence: e.sequence.toString() })),
      nextCursor: events.length > 0 ? events[events.length - 1].sequence.toString() : cursor?.toString() ?? null,
      hasMore: events.length === Math.min(limit, 500),
    };
  }

  /** Enterprise headline figures, with direction of travel. */
  async pulse(periodStart: Date, periodEnd: Date) {
    const notConfidential = { isConfidential: false as const };
    const spanMs = periodEnd.getTime() - periodStart.getTime();
    const priorStart = new Date(periodStart.getTime() - spanMs);

    const onTimeFor = async (from: Date, to: Date) => {
      const done = await prisma.task.findMany({
        where: {
          ...notConfidential,
          status: { in: [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.CLOSED] },
          completedAt: { gte: from, lte: to },
        },
        select: { completedAt: true, dueDate: true },
      });
      if (done.length === 0) return null;
      const onTime = done.filter((t) => t.completedAt && t.completedAt <= t.dueDate).length;
      return Math.round((onTime / done.length) * 100);
    };

    const now = new Date();
    const [openTasks, overdueTasks, criticalOpen, blockedTasks, slaBreaches, onTime, prior] =
      await Promise.all([
        prisma.task.count({ where: { ...notConfidential, status: { notIn: SETTLED } } }),
        prisma.task.count({
          where: { ...notConfidential, status: { notIn: SETTLED }, dueDate: { lt: now } },
        }),
        prisma.task.count({
          where: { ...notConfidential, status: { notIn: SETTLED }, priority: Priority.CRITICAL },
        }),
        prisma.task.count({ where: { ...notConfidential, status: TaskStatus.BLOCKED } }),
        prisma.commandCentreEvent.count({
          where: { eventType: CommandCentreEventType.SLA_BREACH, resolvedAt: null },
        }),
        onTimeFor(periodStart, periodEnd),
        onTimeFor(priorStart, periodStart),
      ]);

    const pulse: EnterprisePulse = {
      openTasks,
      overdueTasks,
      criticalOpen,
      blockedTasks,
      slaBreaches,
      onTimePercent: onTime,
      previousOnTimePercent: prior,
    };

    return { ...pulse, trend: trendOf(pulse) };
  }
}
