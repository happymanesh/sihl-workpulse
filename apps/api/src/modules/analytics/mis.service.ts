import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, TaskStatus, WorkPulseRole, prisma } from "@workpulse/db";
import type { AuthenticatedUser } from "../auth/identity.service";
import { excludeConfidentialFromAggregate } from "./visibility-core";
import {
  aggregate,
  aggregateBy,

  MIS_STAGES,
  toCsv,
  type MisCounts,
  type MisStageKey,
  type MisTaskRow,
} from "./mis-core";

export type { MisCounts, MisStageKey } from "./mis-core";
export { MIS_STAGES } from "./mis-core";

export interface MisRow extends MisCounts {
  id: string;
  label: string;
}

/**
 * Enterprise MIS with drill-down (TM-FR-054 to 058).
 *
 * Two properties hold at every level:
 *
 *   1. Confidential work is excluded from aggregates for everyone except the
 *      Audit role, and the exclusion is DISCLOSED on the result rather than
 *      silently shrinking the totals.
 *
 *   2. Drill-down re-checks access at each level. A Department Head drilling
 *      into another department is refused - the same rule at the top and the
 *      bottom, not a filter applied only to the first screen.
 */
@Injectable()
export class MisService {
  private isExecutive(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.EXECUTIVE) ||
      actor.roles.includes(WorkPulseRole.EXECUTIVE_RESTRICTED) ||
      actor.roles.includes(WorkPulseRole.AUDIT)
    );
  }

  /** Departments this caller may see. Null means "all". */
  private async permittedDepartmentIds(actor: AuthenticatedUser): Promise<string[] | null> {
    if (this.isExecutive(actor)) return null;

    if (!actor.employeeId) return [];
    const me = await prisma.employee.findUnique({
      where: { id: actor.employeeId },
      select: { departmentId: true },
    });

    // Department Heads and Managers see their own department. Cross-department
    // visibility is an explicit grant, not a role side effect (BRS 18.2).
    if (
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD) ||
      actor.roles.includes(WorkPulseRole.MANAGER)
    ) {
      return me?.departmentId ? [me.departmentId] : [];
    }
    return [];
  }

  private baseWhere(actor: AuthenticatedUser, extra: Prisma.TaskWhereInput = {}): Prisma.TaskWhereInput {
    return {
      ...extra,
      // TM-FR-058: confidential content is out of aggregates by default.
      ...(excludeConfidentialFromAggregate(actor) ? { isConfidential: false } : {}),
    };
  }

  /**
   * The rows every figure on this screen is counted from.
   *
   * One query, not seven per row. The set is deliberately the same one the
   * drill-down lists: still open, or finished inside the period. That is what
   * makes a stage count clickable - the number and the list behind it come
   * from the same definition, so they cannot disagree.
   */
  private async rowsFor(
    actor: AuthenticatedUser,
    scope: Prisma.TaskWhereInput,
    periodStart: Date,
    periodEnd: Date,
    extraSelect: Prisma.TaskSelect = {},
  ) {
    return prisma.task.findMany({
      where: this.baseWhere(actor, {
        ...scope,
        OR: [
          { status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] } },
          { completedAt: { gte: periodStart, lte: periodEnd } },
        ],
      }),
      select: {
        status: true,
        dueDate: true,
        completedAt: true,
        isMissed: true,
        priority: true,
        ...extraSelect,
      },
    });
  }

  private static asRow(r: {
    status: TaskStatus;
    dueDate: Date;
    completedAt: Date | null;
    isMissed: boolean;
    priority: string;
  }): MisTaskRow {
    return {
      status: r.status,
      dueDate: r.dueDate,
      completedAt: r.completedAt,
      isMissed: r.isMissed,
      priority: r.priority,
    };
  }

  /** Level 1: the enterprise figure, scoped to what this caller may see. */
  async enterprise(actor: AuthenticatedUser, periodStart: Date, periodEnd: Date) {
    const permitted = await this.permittedDepartmentIds(actor);
    const scope: Prisma.TaskWhereInput = permitted ? { departmentId: { in: permitted } } : {};

    const rows = await this.rowsFor(actor, scope, periodStart, periodEnd);
    const counts = aggregate(rows.map(MisService.asRow), {
      now: new Date(),
      periodStart,
      periodEnd,
    });

    const confidentialExcluded = excludeConfidentialFromAggregate(actor)
      ? await prisma.task.count({ where: { ...scope, isConfidential: true } })
      : 0;

    return {
      ...counts,
      scopeIsLimited: permitted !== null,
      // Disclosed, never silent: a total that looks wrong can be explained.
      confidentialExcluded,
    };
  }

  /** Level 2: by department. */
  async byDepartment(actor: AuthenticatedUser, periodStart: Date, periodEnd: Date): Promise<MisRow[]> {
    const permitted = await this.permittedDepartmentIds(actor);
    const departments = await prisma.department.findMany({
      where: permitted ? { id: { in: permitted } } : {},
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const rows = await this.rowsFor(
      actor,
      permitted ? { departmentId: { in: permitted } } : {},
      periodStart,
      periodEnd,
      { departmentId: true },
    );

    return aggregateBy(
      rows.map((r) => ({ ...MisService.asRow(r), key: r.departmentId })),
      departments.map((d) => ({ id: d.id, label: d.name })),
      { now: new Date(), periodStart, periodEnd },
    ).map((r) => ({ id: r.id, label: r.label, ...r.counts }));
  }

  /**
   * Level 3: by employee within a department.
   *
   * TM-FR-055: the access check runs again here. Drilling in is not a bypass -
   * a Department Head asking for another department's employees is refused at
   * this level exactly as at the level above.
   */
  async byEmployee(
    actor: AuthenticatedUser,
    departmentId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<MisRow[]> {
    const permitted = await this.permittedDepartmentIds(actor);
    if (permitted !== null && !permitted.includes(departmentId)) {
      throw new ForbiddenException("You do not have access to that department");
    }

    const employees = await prisma.employee.findMany({
      where: { departmentId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const rows = await this.rowsFor(actor, { departmentId }, periodStart, periodEnd, {
      assigneeEmployeeId: true,
    });

    return aggregateBy(
      rows.map((r) => ({ ...MisService.asRow(r), key: r.assigneeEmployeeId })),
      employees.map((e) => ({ id: e.id, label: e.name })),
      { now: new Date(), periodStart, periodEnd },
    ).map((r) => ({ id: r.id, label: r.label, ...r.counts }));
  }

  /**
   * Level 4: the underlying tasks. Every figure above is drillable to these.
   *
   * `stage` narrows to one column of the table above. The statuses it expands
   * to are the same list the counting used, so the list length always equals
   * the number that was clicked.
   */
  async tasksFor(
    actor: AuthenticatedUser,
    scope: { departmentId?: string; employeeId?: string; stage?: MisStageKey },
    periodStart: Date,
    periodEnd: Date,
  ) {
    const permitted = await this.permittedDepartmentIds(actor);
    if (permitted !== null && scope.departmentId && !permitted.includes(scope.departmentId)) {
      throw new ForbiddenException("You do not have access to that department");
    }

    const stage = scope.stage ? MIS_STAGES.find((s) => s.key === scope.stage) : undefined;

    return prisma.task.findMany({
      where: this.baseWhere(actor, {
        departmentId: scope.departmentId,
        assigneeEmployeeId: scope.employeeId,
        ...(stage ? { status: { in: [...stage.statuses] } } : {}),
        OR: [
          { status: { notIn: [TaskStatus.CLOSED, TaskStatus.CANCELLED] } },
          { completedAt: { gte: periodStart, lte: periodEnd } },
        ],
      }),
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        completedAt: true,
        isMissed: true,
        assignee: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ dueDate: "asc" }],
      take: 500,
    });
  }

  /**
   * The table above, as a file.
   *
   * Built from the same methods the screen calls rather than a second query of
   * its own: an export that can disagree with what is on screen is worse than
   * no export, because the disagreement is only found later and by somebody
   * who was not in the room.
   */
  async csvRows(
    actor: AuthenticatedUser,
    scope: { departmentId?: string },
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ filename: string; csv: string }> {
    const rows = scope.departmentId
      ? await this.byEmployee(actor, scope.departmentId, periodStart, periodEnd)
      : await this.byDepartment(actor, periodStart, periodEnd);

    const headers = [
      "#",
      scope.departmentId ? "Person" : "Department",
      ...MIS_STAGES.map((s) => s.label),
      "Total",
      "Overdue",
      "Critical",
      "Never started",
      "Completed in period",
      "On time",
      "On time %",
    ];

    const body = rows.map((r, i) => [
      i + 1,
      r.label,
      ...MIS_STAGES.map((s) => r.stages[s.key]),
      r.total,
      r.overdue,
      r.critical,
      r.neverStarted,
      r.completedInPeriod,
      r.onTimeInPeriod,
      r.onTimePercent,
    ]);

    const period = `${periodStart.toISOString().slice(0, 7)}`;
    const what = scope.departmentId ? "people" : "departments";
    return { filename: `workpulse-mis-${what}-${period}.csv`, csv: toCsv(headers, body) };
  }

  /** One person's underlying tasks, as a file. */
  async csvTasks(
    actor: AuthenticatedUser,
    scope: { departmentId?: string; employeeId?: string; stage?: MisStageKey },
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ filename: string; csv: string }> {
    const tasks = await this.tasksFor(actor, scope, periodStart, periodEnd);

    const headers = [
      "#",
      "Reference",
      "Title",
      "Assignee",
      "Department",
      "Status",
      "Priority",
      "Due",
      "Completed",
      "Never started",
    ];

    const body = tasks.map((t, i) => [
      i + 1,
      t.reference,
      t.title,
      t.assignee?.name ?? null,
      t.department?.name ?? null,
      t.status,
      t.priority,
      t.dueDate.toISOString().slice(0, 10),
      t.completedAt ? t.completedAt.toISOString().slice(0, 10) : null,
      t.isMissed ? "yes" : "",
    ]);

    const period = periodStart.toISOString().slice(0, 7);
    return { filename: `workpulse-mis-tasks-${period}.csv`, csv: toCsv(headers, body) };
  }
}
