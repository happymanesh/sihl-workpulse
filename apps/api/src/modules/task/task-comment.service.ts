import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { TaskCommentKind, TaskStatus, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";
import { canViewTask } from "../analytics/visibility-core";

/**
 * Notes on a task.
 *
 * Append-only, deliberately: no update and no delete exist on this service or
 * anywhere else. A note somebody relied on must not change underneath them, and
 * the narrative is part of what an auditor reads alongside the lifecycle. A
 * mistaken note is corrected by adding another, the way a ledger is.
 *
 * Who may read them follows the task itself - including the confidential-task
 * rules - so a comment cannot become a side channel around visibility.
 */
@Injectable()
export class TaskCommentService {
  constructor(private readonly audit: AuditService) {}

  private async loadTaskFor(actor: AuthenticatedUser, taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        reference: true,
        isConfidential: true,
        assigneeEmployeeId: true,
        reviewerEmployeeId: true,
        status: true,
      },
    });
    if (!task) throw new NotFoundException("Task not found");

    const verdict = canViewTask(
      { employeeId: actor.employeeId, roles: actor.roles, managedEmployeeIds: [] },
      {
        isConfidential: task.isConfidential,
        assigneeEmployeeId: task.assigneeEmployeeId,
        reviewerEmployeeId: task.reviewerEmployeeId,
      },
    );
    if (!verdict.canView) {
      throw new ForbiddenException("You cannot see this task, so you cannot read or add notes on it");
    }

    return task;
  }

  async list(actor: AuthenticatedUser, taskId: string) {
    await this.loadTaskFor(actor, taskId);
    return prisma.taskComment.findMany({
      where: { taskId },
      include: { author: { select: { id: true, name: true, designation: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Add a note.
   *
   * `kind` says why it exists rather than being decoration: ACCEPTANCE and
   * COMPLETION notes are what the anti-gaming evidence check looks for, so a
   * note left at the right moment is what stops a closure being flagged.
   */
  async add(
    actor: AuthenticatedUser,
    input: {
      taskId: string;
      body: string;
      kind?: TaskCommentKind;
      relatedStatus?: TaskStatus | null;
      wasDictated?: boolean;
      dictatedLanguage?: string | null;
    },
  ) {
    const task = await this.loadTaskFor(actor, input.taskId);

    if (!input.body.trim()) {
      throw new BadRequestException("A note needs something in it");
    }
    if (!actor.employeeId) {
      throw new BadRequestException(
        "Your workPulse account is not linked to an employee record, so a note cannot be attributed to anybody.",
      );
    }

    const comment = await prisma.taskComment.create({
      data: {
        taskId: input.taskId,
        authorEmployeeId: actor.employeeId,
        authorUserId: actor.id,
        body: input.body.trim(),
        kind: input.kind ?? TaskCommentKind.GENERAL,
        relatedStatus: input.relatedStatus ?? null,
        wasDictated: input.wasDictated ?? false,
        dictatedLanguage: input.dictatedLanguage ?? null,
      },
      include: { author: { select: { id: true, name: true, designation: true } } },
    });

    await this.audit.record({
      entityType: "Task",
      entityId: input.taskId,
      action: "comment_added",
      actorId: actor.id,
      after: {
        commentId: comment.id,
        kind: comment.kind,
        wasDictated: comment.wasDictated,
        // The body is in the comment row; repeating it here would duplicate
        // what the audit trail already points at.
        length: comment.body.length,
      },
      reason: `${task.reference}: ${comment.kind.toLowerCase()} note`,
    });

    return comment;
  }

  /** Whether a task carries evidence of the kind the closure check looks for. */
  async hasEvidence(taskId: string): Promise<boolean> {
    const count = await prisma.taskComment.count({
      where: { taskId, kind: { in: [TaskCommentKind.COMPLETION, TaskCommentKind.REVIEW] } },
    });
    return count > 0;
  }

  /** Audit may read notes on anything, including confidential work. */
  async listForAudit(actor: AuthenticatedUser, taskId: string) {
    if (!actor.roles.includes(WorkPulseRole.AUDIT)) {
      throw new ForbiddenException("Audit only");
    }
    return prisma.taskComment.findMany({
      where: { taskId },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }
}
