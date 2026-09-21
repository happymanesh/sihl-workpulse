import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, Prisma, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";

export interface StepInput {
  title: string;
  contentJson?: Prisma.InputJsonValue;
  attachmentUrls?: string[];
  expectedMinutes?: number;
}

@Injectable()
export class WorkflowService {
  constructor(private readonly audit: AuditService) {}

  private canGovern(actor: AuthenticatedUser): boolean {
    return (
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD)
    );
  }

  private assertGovern(actor: AuthenticatedUser, what: string): void {
    if (!this.canGovern(actor)) {
      throw new ForbiddenException(`${what} requires a Department Head or System Admin`);
    }
  }

  async forActivity(activityId: string) {
    return prisma.workflow.findUnique({
      where: { deskCardActivityId: activityId },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          include: { steps: { orderBy: { position: "asc" } } },
        },
      },
    });
  }

  /**
   * The version a performer should follow right now: the highest-numbered
   * Approved one. Draft versions are invisible to performers by design - work
   * in progress on a procedure must not change what people are doing.
   */
  async currentApprovedVersion(activityId: string) {
    const workflow = await prisma.workflow.findUnique({
      where: { deskCardActivityId: activityId },
      select: { id: true },
    });
    if (!workflow) return null;

    return prisma.workflowVersion.findFirst({
      where: { workflowId: workflow.id, status: ApprovalStatus.APPROVED },
      orderBy: { versionNumber: "desc" },
      include: { steps: { orderBy: { position: "asc" } } },
    });
  }

  /**
   * Creates the workflow on first use, then adds a Draft version.
   *
   * TM-FR-082: editing an Approved version never mutates it - it creates the
   * next Draft. The Approved version stays in force until the Draft is itself
   * approved, so a half-written revision cannot leak to performers.
   */
  async createDraftVersion(actor: AuthenticatedUser, activityId: string, steps: StepInput[]) {
    this.assertGovern(actor, "Authoring a workflow");
    if (steps.length === 0) throw new BadRequestException("A workflow needs at least one step");

    const activity = await prisma.deskCardActivity.findUnique({
      where: { id: activityId },
      select: { id: true, title: true },
    });
    if (!activity) throw new NotFoundException("Activity not found");

    const version = await prisma.$transaction(async (tx) => {
      const workflow = await tx.workflow.upsert({
        where: { deskCardActivityId: activityId },
        create: { deskCardActivityId: activityId },
        update: {},
        select: { id: true, reviewFrequencyMonths: true },
      });

      const existingDraft = await tx.workflowVersion.findFirst({
        where: { workflowId: workflow.id, status: ApprovalStatus.DRAFT },
        select: { id: true },
      });
      if (existingDraft) {
        throw new BadRequestException(
          "This workflow already has a draft version. Edit or approve it before starting another.",
        );
      }

      const latest = await tx.workflowVersion.findFirst({
        where: { workflowId: workflow.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });

      return tx.workflowVersion.create({
        data: {
          workflowId: workflow.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          status: ApprovalStatus.DRAFT,
          lastEditedByUserId: actor.id,
          steps: {
            create: steps.map((s, i) => ({
              position: i,
              title: s.title.trim(),
              contentJson: s.contentJson,
              attachmentUrls: s.attachmentUrls ?? [],
              expectedMinutes: s.expectedMinutes,
            })),
          },
        },
        include: { steps: { orderBy: { position: "asc" } } },
      });
    });

    await this.audit.record({
      entityType: "WorkflowVersion",
      entityId: version.id,
      action: "draft_created",
      actorId: actor.id,
      after: { activityId, versionNumber: version.versionNumber, steps: version.steps.length },
    });

    return version;
  }

  async replaceDraftSteps(actor: AuthenticatedUser, versionId: string, steps: StepInput[]) {
    this.assertGovern(actor, "Editing a workflow");

    const version = await prisma.workflowVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Workflow version not found");
    if (version.status !== ApprovalStatus.DRAFT) {
      throw new BadRequestException(
        "Approved versions are immutable. Create a new draft rather than editing this one.",
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.workflowStep.deleteMany({ where: { workflowVersionId: versionId } });
      await tx.workflowStep.createMany({
        data: steps.map((s, i) => ({
          workflowVersionId: versionId,
          position: i,
          title: s.title.trim(),
          contentJson: s.contentJson ?? Prisma.JsonNull,
          attachmentUrls: s.attachmentUrls ?? [],
          expectedMinutes: s.expectedMinutes,
        })),
      });
      return tx.workflowVersion.update({
        where: { id: versionId },
        data: { lastEditedByUserId: actor.id },
        include: { steps: { orderBy: { position: "asc" } } },
      });
    });

    await this.audit.record({
      entityType: "WorkflowVersion",
      entityId: versionId,
      action: "draft_edited",
      actorId: actor.id,
      after: { steps: updated.steps.length },
    });

    return updated;
  }

  /**
   * Approves a Draft version and supersedes the previous Approved one.
   *
   * Maker-checker (Addendum 01 Section 9): the approver must not be the person
   * who last edited it. Four eyes on a procedure matters more than on most
   * things, because everyone downstream follows it without question.
   */
  async approveVersion(actor: AuthenticatedUser, versionId: string) {
    this.assertGovern(actor, "Approving a workflow");

    const version = await prisma.workflowVersion.findUnique({
      where: { id: versionId },
      include: { workflow: { select: { id: true, reviewFrequencyMonths: true } }, steps: true },
    });
    if (!version) throw new NotFoundException("Workflow version not found");
    if (version.status !== ApprovalStatus.DRAFT) {
      throw new BadRequestException(`This version is already ${version.status}`);
    }
    if (version.steps.length === 0) {
      throw new BadRequestException("A workflow cannot be approved with no steps");
    }
    if (version.lastEditedByUserId && version.lastEditedByUserId === actor.id) {
      throw new ForbiddenException(
        "You cannot approve a workflow you authored. Approval requires a different person.",
      );
    }

    const now = new Date();
    const reviewDueAt = new Date(now);
    reviewDueAt.setMonth(reviewDueAt.getMonth() + version.workflow.reviewFrequencyMonths);

    const approved = await prisma.$transaction(async (tx) => {
      // Supersede whatever was in force. Never deleted - superseded versions
      // are retained indefinitely, and tasks pinned to them keep resolving.
      await tx.workflowVersion.updateMany({
        where: {
          workflowId: version.workflow.id,
          status: ApprovalStatus.APPROVED,
          id: { not: versionId },
        },
        data: { status: ApprovalStatus.RETIRED, supersededAt: now },
      });

      return tx.workflowVersion.update({
        where: { id: versionId },
        data: {
          status: ApprovalStatus.APPROVED,
          approvedByUserId: actor.id,
          approvedAt: now,
          reviewDueAt,
        },
      });
    });

    await this.audit.record({
      entityType: "WorkflowVersion",
      entityId: versionId,
      action: "approved",
      actorId: actor.id,
      before: { status: ApprovalStatus.DRAFT },
      after: { status: ApprovalStatus.APPROVED, versionNumber: approved.versionNumber },
    });

    return approved;
  }

  /**
   * TM-FR-084. Stale means "nobody has confirmed this is still correct", not
   * "invalid" - the version stays in force, because withdrawing it would leave
   * performers with no procedure at all.
   */
  static isStale(version: { reviewDueAt: Date | null }, asOf: Date = new Date()): boolean {
    return Boolean(version.reviewDueAt && version.reviewDueAt < asOf);
  }
}
