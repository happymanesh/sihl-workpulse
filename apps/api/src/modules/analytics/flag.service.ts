import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ActorType, TaskFlagStatus, TaskFlagType, WorkPulseRole, prisma } from "@workpulse/db";
import type { AuthenticatedUser } from "../auth/identity.service";
import { AuditService } from "../audit/audit.service";
import type { FlagCandidate } from "./antigaming-core";

const REVIEW_ROLES = [
  WorkPulseRole.DEPARTMENT_HEAD,
  WorkPulseRole.AUDIT,
  WorkPulseRole.EXECUTIVE,
  WorkPulseRole.EXECUTIVE_RESTRICTED,
] as const;

/**
 * The human half of the anti-gaming controls (TM-FR-062 to 065).
 *
 * The heuristics in antigaming-core only ever produce a FLAG. This service is
 * where a person decides what it meant. Two rules hold:
 *
 *   - A flag is never a penalty. While OPEN it removes the work from analytics
 *     entirely rather than counting against anyone.
 *   - Every review is audited with a reason. "The system flagged you" must
 *     always resolve to a named individual who upheld or dismissed it.
 */
@Injectable()
export class FlagService {
  constructor(private readonly audit: AuditService) {}

  private assertMayReview(actor: AuthenticatedUser): void {
    // SYSTEM_ADMIN is absent on purpose: running the system is not standing to
    // adjudicate someone's conduct.
    if (!REVIEW_ROLES.some((r) => actor.roles.includes(r))) {
      throw new ForbiddenException("Only a Department Head, Audit or an Executive may review flags");
    }
  }

  /** Persists heuristic output, skipping anything already open for the same subject. */
  async raise(
    candidates: FlagCandidate[],
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const c of candidates) {
      // Re-running the job must not bury a reviewer under duplicates of a
      // finding they have already been shown.
      const existing = await prisma.taskFlag.findFirst({
        where: {
          flagType: c.flagType,
          taskId: c.taskId,
          subjectEmployeeId: c.subjectEmployeeId,
          status: TaskFlagStatus.OPEN,
          windowStart,
          windowEnd,
        },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      const flag = await prisma.taskFlag.create({
        data: {
          flagType: c.flagType,
          taskId: c.taskId,
          subjectEmployeeId: c.subjectEmployeeId,
          detail: c.detail,
          windowStart,
          windowEnd,
        },
      });
      created += 1;

      await this.audit.record({
        entityType: "TaskFlag",
        entityId: flag.id,
        action: "RAISE",
        actorType: ActorType.SYSTEM,
        after: { flagType: c.flagType, subjectEmployeeId: c.subjectEmployeeId, detail: c.detail },
        reason: "Automated anti-gaming heuristic",
      });
    }

    return { created, skipped };
  }

  async list(
    actor: AuthenticatedUser,
    filter: { status?: TaskFlagStatus; subjectEmployeeId?: string; flagType?: TaskFlagType } = {},
  ) {
    // An employee may always list flags about themselves - that is what makes
    // them contestable. Anyone else needs review standing.
    const isOwnOnly =
      filter.subjectEmployeeId !== undefined && filter.subjectEmployeeId === actor.employeeId;
    if (!isOwnOnly) this.assertMayReview(actor);

    return prisma.taskFlag.findMany({
      where: {
        status: filter.status,
        subjectEmployeeId: filter.subjectEmployeeId,
        flagType: filter.flagType,
      },
      include: {
        subjectEmployee: { select: { id: true, name: true } },
        task: { select: { id: true, reference: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  /**
   * Uphold or dismiss a flag.
   *
   * A reason is mandatory in both directions. Dismissing without one would make
   * the control unauditable, and upholding without one would leave the employee
   * with a finding they cannot answer.
   */
  async review(
    actor: AuthenticatedUser,
    flagId: string,
    decision: "ACCEPT" | "DISMISS",
    note: string,
  ) {
    this.assertMayReview(actor);

    if (!note.trim()) {
      throw new BadRequestException("A review note is required, whichever way the flag is decided");
    }

    const before = await prisma.taskFlag.findUnique({ where: { id: flagId } });
    if (!before) throw new NotFoundException("Flag not found");
    if (before.status !== TaskFlagStatus.OPEN) {
      throw new BadRequestException("That flag has already been reviewed");
    }

    const status =
      decision === "ACCEPT" ? TaskFlagStatus.REVIEWED_ACCEPTED : TaskFlagStatus.REVIEWED_DISMISSED;

    const after = await prisma.taskFlag.update({
      where: { id: flagId },
      data: {
        status,
        reviewedByUserId: actor.id,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });

    await this.audit.record({
      entityType: "TaskFlag",
      entityId: flagId,
      action: decision === "ACCEPT" ? "UPHOLD" : "DISMISS",
      actorId: actor.id,
      before: { status: before.status },
      after: { status: after.status },
      reason: note,
    });

    // Dismissal restores the work to the employee's analytics on the next
    // computation. Being wrongly suspected costs them nothing.
    return after;
  }
}
