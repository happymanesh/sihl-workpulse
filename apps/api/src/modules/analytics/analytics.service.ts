import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import {
  ActorType,
  Priority,
  TaskFlagStatus,
  TaskStatus,
  WorkPulseRole,
  prisma,
} from "@workpulse/db";
import type { AuthenticatedUser } from "../auth/identity.service";
import { AuditService } from "../audit/audit.service";
import { SlaService } from "../sla/sla.service";
import {
  computeComponents,
  hasSufficientVolume,
  sumWtu,
  wtu,
  type ComponentInputs,
} from "./analytics-core";

const DONE: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.CLOSED];

/**
 * Operational analytics (Addendum 02).
 *
 * Computes and stores the five components per employee per period. It does NOT
 * compute a composite score - that is Phase 7, behind a shadow quarter and HR
 * sign-off, and analytics-core deliberately provides no function for it.
 *
 * Three fairness properties are enforced here rather than left to the reader:
 *
 *   1. Flagged work is excluded from BOTH numerator and denominator until a
 *      human reviews the flag (Addendum 02 Section 4.7). A heuristic never
 *      silently docks anyone.
 *   2. Below the volume floor the components are stored but reported as
 *      "insufficient data" - never as a low result.
 *   3. Visibility is SYMMETRIC: the employee sees exactly the figures their
 *      manager and HR see, computed by this one code path. There is no
 *      "manager view" of a number the subject cannot see.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly sla: SlaService,
  ) {}

  // -------------------------------------------------------------------------
  // Computation
  // -------------------------------------------------------------------------

  /**
   * Gathers a period's inputs for one employee and computes the components.
   *
   * Read-only apart from the upsert at the end, so the same call backs both the
   * scheduled job and an on-demand recompute.
   */
  async computeFor(employeeId: string, periodStart: Date, periodEnd: Date) {
    // Work OWED in the period: due inside the window. Cancelled work is
    // excluded because it was withdrawn, not failed.
    const due = await prisma.task.findMany({
      where: {
        assigneeEmployeeId: employeeId,
        dueDate: { gte: periodStart, lte: periodEnd },
        status: { not: TaskStatus.CANCELLED },
      },
      select: {
        id: true,
        priority: true,
        estimatedMinutes: true,
        status: true,
        dueDate: true,
        completedAt: true,
        deskCardActivityId: true,
        flags: { select: { status: true } },
      },
    });

    // Addendum 02 Section 4.7: an OPEN flag, or one a reviewer upheld, removes
    // the task from the calculation entirely. A DISMISSED flag restores it -
    // being wrongly suspected must cost the employee nothing.
    const isExcluded = (t: (typeof due)[number]) =>
      t.flags.some(
        (f) => f.status === TaskFlagStatus.OPEN || f.status === TaskFlagStatus.REVIEWED_ACCEPTED,
      );

    const counted = due.filter((t) => !isExcluded(t));
    const flagged = due.filter(isExcluded);
    const closed = counted.filter((t) => DONE.includes(t.status));

    // SLA position is assessed AT COMPLETION, not as of now: a task finished
    // inside its window must not degrade because the report ran later.
    let wtuSlaTracked = 0;
    let wtuOnTime = 0;
    for (const t of closed) {
      const assessment = await this.sla.assess(t.id, t.completedAt ?? t.dueDate);
      if (!assessment) continue; // no SLA applies - not a timeliness obligation
      const units = wtu(t);
      wtuSlaTracked += units;
      if (assessment.state !== "BREACHED") wtuOnTime += units;
    }

    // Rework: a task that went to REJECTED or REOPENED at any point, counted
    // ONCE however many times it bounced. Repeated rejection says something
    // about the review loop, not only about the performer.
    const reworked = await prisma.taskStatusHistory.groupBy({
      by: ["taskId"],
      where: {
        taskId: { in: counted.map((t) => t.id) },
        toStatus: { in: [TaskStatus.REJECTED, TaskStatus.REOPENED] },
      },
    });
    const reworkedIds = new Set(reworked.map((r) => r.taskId));
    const wtuReopened = sumWtu(counted.filter((t) => reworkedIds.has(t.id)));

    // Governance: the control obligations this person OWED as reviewer - the
    // maker-checker and verification duties attached to the role.
    const [controlObligationsOwed, controlObligationsMet] = await Promise.all([
      prisma.task.count({
        where: {
          reviewerEmployeeId: employeeId,
          dueDate: { gte: periodStart, lte: periodEnd },
          status: { not: TaskStatus.CANCELLED },
          taskType: { requiresVerification: true },
        },
      }),
      prisma.task.count({
        where: {
          reviewerEmployeeId: employeeId,
          dueDate: { gte: periodStart, lte: periodEnd },
          status: { in: [TaskStatus.VERIFIED, TaskStatus.CLOSED] },
          taskType: { requiresVerification: true },
        },
      }),
    ]);

    // Contribution: closed work NOT generated from the person's own desk card -
    // stepping outside the standing remit.
    const beyondDeskCard = closed.filter((t) => t.deskCardActivityId === null);

    const inputs: ComponentInputs = {
      wtuDue: sumWtu(counted),
      wtuClosed: sumWtu(closed),
      wtuOnTimeOfSlaTracked: wtuOnTime,
      wtuSlaTracked,
      wtuReopened,
      wtuRejected: 0, // folded into wtuReopened above: counted once, not twice
      wtuEvidenceFlagged: 0, // flagged work is excluded outright, not penalised
      controlObligationsOwed,
      controlObligationsMet,
      wtuBeyondDeskCard: sumWtu(beyondDeskCard),
    };

    const components = computeComponents(inputs);
    const sufficient = hasSufficientVolume(inputs.wtuDue);

    const row = await prisma.analyticsPeriod.upsert({
      where: { employeeId_periodStart_periodEnd: { employeeId, periodStart, periodEnd } },
      create: {
        employeeId,
        periodStart,
        periodEnd,
        wtuDue: inputs.wtuDue,
        wtuClosed: inputs.wtuClosed,
        wtuOnTime,
        wtuReopened,
        wtuFlagged: sumWtu(flagged),
        ...components,
        hasSufficientVolume: sufficient,
      },
      update: {
        wtuDue: inputs.wtuDue,
        wtuClosed: inputs.wtuClosed,
        wtuOnTime,
        wtuReopened,
        wtuFlagged: sumWtu(flagged),
        ...components,
        hasSufficientVolume: sufficient,
        computedAt: new Date(),
      },
    });

    return { ...row, excludedFlaggedTasks: flagged.length };
  }

  /** Recomputes every active employee for a period. Drives the monthly job. */
  async computeAll(periodStart: Date, periodEnd: Date) {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let computed = 0;
    for (const e of employees) {
      try {
        await this.computeFor(e.id, periodStart, periodEnd);
        computed += 1;
      } catch (error) {
        // One employee's bad data must not abort the whole period.
        this.logger.error(`Analytics failed for employee ${e.id}`, error as Error);
      }
    }

    await this.audit.record({
      entityType: "AnalyticsPeriod",
      entityId: `${periodStart.toISOString()}..${periodEnd.toISOString()}`,
      action: "COMPUTE_PERIOD",
      actorType: ActorType.SYSTEM,
      after: { employees: employees.length, computed },
    });

    return { employees: employees.length, computed };
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  private async mayViewReportCard(actor: AuthenticatedUser, employeeId: string): Promise<boolean> {
    if (actor.employeeId === employeeId) return true; // always your own

    if (
      actor.roles.includes(WorkPulseRole.AUDIT) ||
      actor.roles.includes(WorkPulseRole.EXECUTIVE) ||
      actor.roles.includes(WorkPulseRole.EXECUTIVE_RESTRICTED) ||
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN)
    ) {
      return true;
    }

    const isLineRole =
      actor.roles.includes(WorkPulseRole.MANAGER) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD);
    if (!actor.employeeId || !isLineRole) return false;

    const [me, subject] = await Promise.all([
      prisma.employee.findUnique({ where: { id: actor.employeeId }, select: { departmentId: true } }),
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: { departmentId: true, managerId: true },
      }),
    ]);
    if (!subject) return false;
    if (subject.managerId === actor.employeeId) return true;

    return Boolean(
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD) &&
        me?.departmentId &&
        me.departmentId === subject.departmentId,
    );
  }

  /**
   * The monthly report card.
   *
   * Returns the identical payload whoever asks - subject, manager, HR or Audit.
   * Asymmetry here is how a performance system loses the room: an employee who
   * cannot see the number being discussed about them cannot dispute it, and
   * TM-FR-124 gives them the right to.
   */
  async reportCard(actor: AuthenticatedUser, employeeId: string, periodStart: Date, periodEnd: Date) {
    if (!(await this.mayViewReportCard(actor, employeeId))) {
      throw new ForbiddenException("You do not have access to that report card");
    }

    const [period, employee, openFlags] = await Promise.all([
      prisma.analyticsPeriod.findUnique({
        where: { employeeId_periodStart_periodEnd: { employeeId, periodStart, periodEnd } },
      }),
      prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true, name: true, designation: true, department: { select: { name: true } } },
      }),
      // The subject sees their own flags. A flag they cannot see is a flag they
      // cannot contest.
      prisma.taskFlag.findMany({
        where: { subjectEmployeeId: employeeId, status: TaskFlagStatus.OPEN },
        select: { id: true, flagType: true, detail: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      employee,
      period,
      // Stated, not implied: the UI shows this instead of the components.
      insufficientData: !period || !period.hasSufficientVolume,
      openFlags,
      // TM-FR-124: the dispute route ships with the numbers, not after them.
      disputeWindowDays: 14,
    };
  }

  /** Period rows for a set of employees, for a manager's team view. */
  async teamPeriods(
    actor: AuthenticatedUser,
    employeeIds: string[],
    periodStart: Date,
    periodEnd: Date,
  ) {
    const permitted: string[] = [];
    for (const id of employeeIds) {
      if (await this.mayViewReportCard(actor, id)) permitted.push(id);
    }

    return prisma.analyticsPeriod.findMany({
      where: { employeeId: { in: permitted }, periodStart, periodEnd },
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { employee: { name: "asc" } },
    });
  }

  /** Priority mix an assigner used in the period (Addendum 02 Section 6.2). */
  async priorityMixFor(
    assignerUserId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Priority[]> {
    const created = await prisma.auditLog.findMany({
      where: {
        entityType: "Task",
        action: "CREATE",
        actorId: assignerUserId,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      select: { entityId: true },
    });

    const tasks = await prisma.task.findMany({
      where: { id: { in: created.map((r) => r.entityId) } },
      select: { priority: true },
    });
    return tasks.map((t) => t.priority);
  }
}
