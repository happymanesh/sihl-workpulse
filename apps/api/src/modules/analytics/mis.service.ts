import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, TaskStatus, WorkPulseRole, prisma } from "@workpulse/db";
import type { AuthenticatedUser } from "../auth/identity.service";
import { excludeConfidentialFromAggregate } from "./visibility-core";

export interface MisCounts {
  total: number;
  open: number;
  overdue: number;
  critical: number;
  blocked: number;
  missed: number;
  completedInPeriod: number;
  onTimeInPeriod: number;
  onTimePercent: number | null;
}

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

  private async countsFor(
    actor: AuthenticatedUser,
    scope: Prisma.TaskWhereInput,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<MisCounts> {
    const now = new Date();
    const settled: TaskStatus[] = [TaskStatus.CLOSED, TaskStatus.CANCELLED];
    const done: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.CLOSED];

    const where = (extra: Prisma.TaskWhereInput) => this.baseWhere(actor, { ...scope, ...extra });

    const [total, open, overdue, critical, blocked, missed, completed] = await Promise.all([
      prisma.task.count({ where: where({}) }),
      prisma.task.count({ where: where({ status: { notIn: settled } }) }),
      prisma.task.count({
        where: where({
          dueDate: { lt: now },
          status: { notIn: [...settled, TaskStatus.VERIFIED] },
        }),
      }),
      prisma.task.count({ where: where({ priority: "CRITICAL", status: { notIn: settled } }) }),
      prisma.task.count({ where: where({ status: TaskStatus.BLOCKED }) }),
      prisma.task.count({ where: where({ isMissed: true }) }),
      // Fetched rather than counted: "completed on or before the due date" is a
      // comparison between two columns, which Prisma cannot express as a filter.
      // One query serves both the completed count and the on-time count.
      prisma.task.findMany({
        where: where({ status: { in: done }, completedAt: { gte: periodStart, lte: periodEnd } }),
        select: { completedAt: true, dueDate: true },
      }),
    ]);

    const onTime = completed.filter((t) => t.completedAt && t.completedAt <= t.dueDate).length;

    return {
      total,
      open,
      overdue,
      critical,
      blocked,
      missed,
      completedInPeriod: completed.length,
      onTimeInPeriod: onTime,
      onTimePercent: completed.length === 0 ? null : Math.round((onTime / completed.length) * 100),
    };
  }

  /** Level 1: the enterprise figure, scoped to what this caller may see. */
  async enterprise(actor: AuthenticatedUser, periodStart: Date, periodEnd: Date) {
    const permitted = await this.permittedDepartmentIds(actor);
    const scope: Prisma.TaskWhereInput = permitted ? { departmentId: { in: permitted } } : {};

    const counts = await this.countsFor(actor, scope, periodStart, periodEnd);
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

    return Promise.all(
      departments.map(async (d) => ({
        id: d.id,
        label: d.name,
        ...(await this.countsFor(actor, { departmentId: d.id }, periodStart, periodEnd)),
      })),
    );
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

    return Promise.all(
      employees.map(async (e) => ({
        id: e.id,
        label: e.name,
        ...(await this.countsFor(actor, { assigneeEmployeeId: e.id }, periodStart, periodEnd)),
      })),
    );
  }

  /** Level 4: the underlying tasks. Every figure above is drillable to these. */
  async tasksFor(
    actor: AuthenticatedUser,
    scope: { departmentId?: string; employeeId?: string },
    periodStart: Date,
    periodEnd: Date,
  ) {
    const permitted = await this.permittedDepartmentIds(actor);
    if (permitted !== null && scope.departmentId && !permitted.includes(scope.departmentId)) {
      throw new ForbiddenException("You do not have access to that department");
    }

    return prisma.task.findMany({
      where: this.baseWhere(actor, {
        departmentId: scope.departmentId,
        assigneeEmployeeId: scope.employeeId,
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
        isMissed: true,
        assignee: { select: { name: true } },
      },
      orderBy: [{ dueDate: "asc" }],
      take: 500,
    });
  }
}
