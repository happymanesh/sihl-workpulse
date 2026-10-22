import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";

export interface CreateTaskTypeInput {
  code: string;
  name: string;
  requiresVerification: boolean;
  requiresEvidence: boolean;
  requiresMakerChecker: boolean;
  autoCloseAfterHours?: number | null;
}

export interface UpdateTaskTypeInput {
  id: string;
  name?: string;
  requiresVerification?: boolean;
  requiresEvidence?: boolean;
  requiresMakerChecker?: boolean;
  autoCloseAfterHours?: number | null;
  reason?: string;
}

/**
 * Task types: the only master that decides whether work is checked.
 *
 * These three flags are not preferences. requiresVerification decides whether a
 * task may close without somebody else confirming it, requiresMakerChecker
 * whether that somebody may be the person who did it, and requiresEvidence
 * whether closing with nothing attached is flagged. They are read live, at the
 * moment a task moves - not copied onto the task when it is raised - so
 * clearing one takes effect on work that is already open and half-done.
 *
 * That is why turning a control OFF asks for a reason and turning it ON does
 * not. Tightening needs no excuse; loosening is the thing an auditor asks
 * about, and the reason is what answers them.
 */
@Injectable()
export class TaskTypeService {
  constructor(private readonly audit: AuditService) {}

  private assertCanGovern(actor: AuthenticatedUser): void {
    const allowed =
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD);
    if (!allowed) {
      throw new ForbiddenException(
        "Changing task types may only be done by a Department Head or System Admin",
      );
    }
  }

  /** Every type, with how much is riding on each. Admin screen only. */
  async list(actor: AuthenticatedUser) {
    this.assertCanGovern(actor);
    return prisma.taskType.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { tasks: true, activities: true } },
      },
    });
  }

  async create(actor: AuthenticatedUser, input: CreateTaskTypeInput) {
    this.assertCanGovern(actor);

    const code = input.code.trim().toUpperCase();
    const existing = await prisma.taskType.findUnique({ where: { code } });
    if (existing) {
      throw new BadRequestException(`A task type with code ${code} already exists`);
    }

    const created = await prisma.taskType.create({
      data: {
        code,
        name: input.name.trim(),
        requiresVerification: input.requiresVerification,
        requiresEvidence: input.requiresEvidence,
        requiresMakerChecker: input.requiresMakerChecker,
        autoCloseAfterHours: input.autoCloseAfterHours ?? null,
      },
    });

    await this.audit.record({
      entityType: "TaskType",
      entityId: created.id,
      action: "created",
      actorId: actor.id,
      after: {
        code: created.code,
        name: created.name,
        requiresVerification: created.requiresVerification,
        requiresEvidence: created.requiresEvidence,
        requiresMakerChecker: created.requiresMakerChecker,
      },
    });

    return created;
  }

  async update(actor: AuthenticatedUser, input: UpdateTaskTypeInput) {
    this.assertCanGovern(actor);

    const before = await prisma.taskType.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundException("That task type does not exist");

    // Which controls are being switched off by this change.
    const weakened: string[] = [];
    if (before.requiresVerification && input.requiresVerification === false) {
      weakened.push("verification");
    }
    if (before.requiresMakerChecker && input.requiresMakerChecker === false) {
      weakened.push("maker-checker");
    }
    if (before.requiresEvidence && input.requiresEvidence === false) {
      weakened.push("evidence");
    }

    if (weakened.length > 0 && !input.reason?.trim()) {
      throw new BadRequestException(
        `Turning off ${weakened.join(" and ")} on a task type requires a reason — it changes how ` +
          "work already in progress may be closed, and the reason is what an auditor reads.",
      );
    }

    const after = await prisma.taskType.update({
      where: { id: before.id },
      data: {
        name: input.name?.trim() ?? before.name,
        requiresVerification: input.requiresVerification ?? before.requiresVerification,
        requiresEvidence: input.requiresEvidence ?? before.requiresEvidence,
        requiresMakerChecker: input.requiresMakerChecker ?? before.requiresMakerChecker,
        autoCloseAfterHours:
          input.autoCloseAfterHours === undefined
            ? before.autoCloseAfterHours
            : input.autoCloseAfterHours,
      },
    });

    await this.audit.record({
      entityType: "TaskType",
      entityId: before.id,
      action: weakened.length > 0 ? `control_removed_${weakened.join("_")}` : "updated",
      actorId: actor.id,
      before: {
        name: before.name,
        requiresVerification: before.requiresVerification,
        requiresEvidence: before.requiresEvidence,
        requiresMakerChecker: before.requiresMakerChecker,
        autoCloseAfterHours: before.autoCloseAfterHours,
      },
      after: {
        name: after.name,
        requiresVerification: after.requiresVerification,
        requiresEvidence: after.requiresEvidence,
        requiresMakerChecker: after.requiresMakerChecker,
        autoCloseAfterHours: after.autoCloseAfterHours,
      },
      reason: input.reason,
    });

    return after;
  }

  /**
   * Retire a type, or bring one back. Never deleted: tasks raised under it keep
   * pointing at it, and an audit trail that loses the definition work was done
   * under is not much of an audit trail.
   */
  async setActive(actor: AuthenticatedUser, id: string, isActive: boolean, reason?: string) {
    this.assertCanGovern(actor);

    const before = await prisma.taskType.findUnique({ where: { id } });
    if (!before) throw new NotFoundException("That task type does not exist");
    if (before.isActive === isActive) {
      throw new BadRequestException(`That task type is already ${isActive ? "active" : "retired"}`);
    }

    if (!isActive) {
      // An approved activity still generating work under this type would start
      // failing silently, so refuse and name what is in the way.
      const inUse = await prisma.deskCardActivity.count({
        where: { taskTypeId: id, isActive: true, status: ApprovalStatus.APPROVED },
      });
      if (inUse > 0) {
        throw new BadRequestException(
          `${inUse} approved ${inUse === 1 ? "activity is" : "activities are"} still using this type. ` +
            "Move them to another type first, or pause them.",
        );
      }
      if (!reason?.trim()) {
        throw new BadRequestException("Retiring a task type requires a reason");
      }
    }

    const after = await prisma.taskType.update({ where: { id }, data: { isActive } });

    await this.audit.record({
      entityType: "TaskType",
      entityId: id,
      action: isActive ? "restored" : "retired",
      actorId: actor.id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
      reason,
    });

    return after;
  }
}
