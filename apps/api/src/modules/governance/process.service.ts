import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, PolicyStatus, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";

/**
 * Administration of Processes and Policies - the middle of the governance
 * chain (Addendum 01): Desk Card -> Activity -> Process -> Policy.
 *
 * This existed only as read-only coverage until now, which made the chain
 * unenforceable in practice: approving an activity requires it to serve a named
 * Process, and nothing in the product could create one. The first activity
 * anybody added could never be approved.
 *
 * Retire rather than delete, everywhere. A Process that activities have pointed
 * at is part of why work exists; deleting it would orphan the obligations and
 * leave an auditor unable to answer "under what control was this done".
 */
@Injectable()
export class ProcessService {
  constructor(private readonly audit: AuditService) {}

  private assertCanGovern(actor: AuthenticatedUser, what: string): void {
    const allowed =
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD);
    if (!allowed) {
      throw new ForbiddenException(`${what} is limited to department heads and system administrators`);
    }
  }

  // -------------------------------------------------------------------------
  // Policies
  // -------------------------------------------------------------------------

  async listPolicies() {
    return prisma.policy.findMany({
      include: {
        owner: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        _count: { select: { processes: true } },
      },
      orderBy: [{ status: "asc" }, { code: "asc" }],
    });
  }

  async createPolicy(
    actor: AuthenticatedUser,
    input: {
      code: string;
      name: string;
      category?: string;
      ownerEmployeeId: string;
      approverEmployeeId: string;
      reviewFrequencyMonths?: number;
      reviewLeadTimeDays?: number;
    },
  ) {
    this.assertCanGovern(actor, "Creating a policy");

    // Segregation of duties: the person who owns a policy should not be the one
    // who approves it. Cheap to enforce here, expensive to explain later.
    if (input.ownerEmployeeId === input.approverEmployeeId) {
      throw new BadRequestException(
        "A policy's owner and approver must be different people. Approving your own policy is not a control.",
      );
    }

    const policy = await prisma.policy.create({
      data: {
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        category: input.category?.trim(),
        ownerEmployeeId: input.ownerEmployeeId,
        approverEmployeeId: input.approverEmployeeId,
        reviewFrequencyMonths: input.reviewFrequencyMonths ?? 12,
        reviewLeadTimeDays: input.reviewLeadTimeDays ?? 20,
        status: PolicyStatus.DRAFT,
      },
    });

    await this.audit.record({
      entityType: "Policy",
      entityId: policy.id,
      action: "created",
      actorId: actor.id,
      after: { code: policy.code, name: policy.name, ownerEmployeeId: policy.ownerEmployeeId },
    });

    return policy;
  }

  async setPolicyStatus(actor: AuthenticatedUser, policyId: string, status: PolicyStatus, reason?: string) {
    this.assertCanGovern(actor, "Changing a policy's status");

    const before = await prisma.policy.findUnique({ where: { id: policyId } });
    if (!before) throw new NotFoundException("Policy not found");

    if (status === PolicyStatus.WITHDRAWN && !reason?.trim()) {
      throw new BadRequestException("Withdrawing a policy requires a reason");
    }

    const nextReviewDate =
      status === PolicyStatus.APPROVED
        ? new Date(Date.now() + before.reviewFrequencyMonths * 30 * 24 * 60 * 60 * 1000)
        : before.nextReviewDate;

    const after = await prisma.policy.update({
      where: { id: policyId },
      data: { status, nextReviewDate },
    });

    await this.audit.record({
      entityType: "Policy",
      entityId: policyId,
      action: `status_${status.toLowerCase()}`,
      actorId: actor.id,
      before: { status: before.status },
      after: { status: after.status, nextReviewDate: after.nextReviewDate },
      reason,
    });

    return after;
  }

  // -------------------------------------------------------------------------
  // Processes
  // -------------------------------------------------------------------------

  async listProcesses() {
    return prisma.process.findMany({
      include: {
        owner: { select: { id: true, name: true } },
        policy: { select: { id: true, code: true, name: true, status: true } },
        _count: { select: { activities: true } },
      },
      orderBy: [{ status: "asc" }, { code: "asc" }],
    });
  }

  async createProcess(
    actor: AuthenticatedUser,
    input: {
      code: string;
      name: string;
      controlObjective?: string;
      ownerEmployeeId: string;
      policyId?: string;
      reviewFrequencyMonths?: number;
    },
  ) {
    this.assertCanGovern(actor, "Creating a process");

    const owner = await prisma.employee.findUnique({
      where: { id: input.ownerEmployeeId },
      select: { isActive: true },
    });
    if (!owner?.isActive) {
      throw new BadRequestException("A process owner must be an active employee");
    }

    const process = await prisma.process.create({
      data: {
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        controlObjective: input.controlObjective?.trim(),
        ownerEmployeeId: input.ownerEmployeeId,
        policyId: input.policyId,
        reviewFrequencyMonths: input.reviewFrequencyMonths ?? 12,
        status: ApprovalStatus.DRAFT,
      },
    });

    await this.audit.record({
      entityType: "Process",
      entityId: process.id,
      action: "created",
      actorId: actor.id,
      after: {
        code: process.code,
        name: process.name,
        ownerEmployeeId: process.ownerEmployeeId,
        policyId: process.policyId,
      },
    });

    return process;
  }

  async setProcessStatus(actor: AuthenticatedUser, processId: string, status: ApprovalStatus, reason?: string) {
    this.assertCanGovern(actor, "Changing a process's status");

    const before = await prisma.process.findUnique({
      where: { id: processId },
      include: { _count: { select: { activities: true } } },
    });
    if (!before) throw new NotFoundException("Process not found");

    if (status === ApprovalStatus.RETIRED) {
      if (!reason?.trim()) throw new BadRequestException("Retiring a process requires a reason");

      // An activity whose process is retired still generates work, but nobody
      // could say under what control. Refuse rather than leave it dangling.
      const live = await prisma.deskCardActivity.count({
        where: { processId, isActive: true, status: ApprovalStatus.APPROVED },
      });
      if (live > 0) {
        throw new BadRequestException(
          `${live} approved activity(ies) still serve this process. Move or retire them first — ` +
            "work that serves no named control is exactly what this chain exists to prevent.",
        );
      }
    }

    const after = await prisma.process.update({ where: { id: processId }, data: { status } });

    await this.audit.record({
      entityType: "Process",
      entityId: processId,
      action: `status_${status.toLowerCase()}`,
      actorId: actor.id,
      before: { status: before.status },
      after: { status: after.status },
      reason,
    });

    return after;
  }

  /** Point a process at the policy it serves, or detach it. */
  async setProcessPolicy(actor: AuthenticatedUser, processId: string, policyId: string | null, reason?: string) {
    this.assertCanGovern(actor, "Changing a process's policy");

    const before = await prisma.process.findUnique({ where: { id: processId } });
    if (!before) throw new NotFoundException("Process not found");

    if (policyId) {
      const policy = await prisma.policy.findUnique({ where: { id: policyId }, select: { id: true } });
      if (!policy) throw new NotFoundException("Policy not found");
    }

    const after = await prisma.process.update({ where: { id: processId }, data: { policyId } });

    await this.audit.record({
      entityType: "Process",
      entityId: processId,
      action: policyId ? "policy_linked" : "policy_detached",
      actorId: actor.id,
      before: { policyId: before.policyId },
      after: { policyId: after.policyId },
      reason,
    });

    return after;
  }

  /**
   * Attach a desk card activity to the process it serves.
   *
   * This is the link approval depends on, and there was no way to set it.
   */
  async setActivityProcess(
    actor: AuthenticatedUser,
    activityId: string,
    processId: string | null,
    reason?: string,
  ) {
    this.assertCanGovern(actor, "Linking an activity to a process");

    const before = await prisma.deskCardActivity.findUnique({
      where: { id: activityId },
      select: { id: true, title: true, processId: true, status: true },
    });
    if (!before) throw new NotFoundException("Activity not found");

    if (processId) {
      const process = await prisma.process.findUnique({
        where: { id: processId },
        select: { id: true, status: true, code: true },
      });
      if (!process) throw new NotFoundException("Process not found");
      if (process.status === ApprovalStatus.RETIRED) {
        throw new BadRequestException(`Process ${process.code} is retired and cannot take new activities`);
      }
    } else if (before.status === ApprovalStatus.APPROVED) {
      // Detaching from an approved activity would leave live work serving no
      // control - the state the approval rule exists to prevent.
      throw new BadRequestException(
        "An approved activity must serve a process. Retire the activity first, or move it to another process.",
      );
    }

    const after = await prisma.deskCardActivity.update({
      where: { id: activityId },
      data: { processId },
    });

    await this.audit.record({
      entityType: "DeskCardActivity",
      entityId: activityId,
      action: processId ? "process_linked" : "process_detached",
      actorId: actor.id,
      before: { processId: before.processId },
      after: { processId: after.processId },
      reason: reason ?? `${before.title}`,
    });

    return after;
  }
}
