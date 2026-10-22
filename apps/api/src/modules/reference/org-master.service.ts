import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkPulseRole, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";

export type OrgMasterKind = "designation" | "branch";

/**
 * Designations and branches: lists HR sends as free text, governed here.
 *
 * Three jobs, and only three. Rename, so the list reads the way the firm
 * speaks. Merge, because a normaliser catches "EXECUTIVE" and "Executive" but
 * not "Sr. Executive" and "Senior Executive". Retire, for a title nobody holds
 * any more.
 *
 * Nothing is deleted: an employee record that pointed at a row should still
 * resolve years later, and a merged row's employees are moved rather than
 * orphaned.
 */
@Injectable()
export class OrgMasterService {
  constructor(private readonly audit: AuditService) {}

  private assertCanGovern(actor: AuthenticatedUser): void {
    const allowed =
      actor.roles.includes(WorkPulseRole.SYSTEM_ADMIN) ||
      actor.roles.includes(WorkPulseRole.DEPARTMENT_HEAD);
    if (!allowed) {
      throw new ForbiddenException(
        "Designations and branches may only be changed by a Department Head or System Admin",
      );
    }
  }

  async list(actor: AuthenticatedUser, kind: OrgMasterKind) {
    this.assertCanGovern(actor);
    const args = {
      orderBy: [{ reviewed: "asc" as const }, { name: "asc" as const }],
      include: { _count: { select: { employees: true } } },
    };
    return kind === "designation"
      ? prisma.designation.findMany(args)
      : prisma.branch.findMany(args);
  }

  private async find(kind: OrgMasterKind, id: string) {
    const row =
      kind === "designation"
        ? await prisma.designation.findUnique({ where: { id } })
        : await prisma.branch.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`That ${kind} does not exist`);
    return row;
  }

  /**
   * Rename and mark reviewed. The normalised form moves with the name, so the
   * next sync folds the same incoming spelling onto this row rather than
   * creating the old one again.
   */
  async rename(actor: AuthenticatedUser, kind: OrgMasterKind, id: string, name: string) {
    this.assertCanGovern(actor);
    const before = await this.find(kind, id);

    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 2) throw new BadRequestException("A name needs at least two characters");

    const normalised = clean.toLowerCase();
    const clash =
      kind === "designation"
        ? await prisma.designation.findUnique({ where: { normalised } })
        : await prisma.branch.findUnique({ where: { normalised } });
    if (clash && clash.id !== id) {
      throw new BadRequestException(
        `“${clash.name}” already uses that name. Merge this one into it instead of renaming.`,
      );
    }

    const data = { name: clean, normalised, reviewed: true };
    const after =
      kind === "designation"
        ? await prisma.designation.update({ where: { id }, data })
        : await prisma.branch.update({ where: { id }, data });

    await this.audit.record({
      entityType: kind === "designation" ? "Designation" : "Branch",
      entityId: id,
      action: "renamed",
      actorId: actor.id,
      before: { name: before.name, reviewed: before.reviewed },
      after: { name: after.name, reviewed: after.reviewed },
    });

    return after;
  }

  /** Accept the spelling as it stands. */
  async markReviewed(actor: AuthenticatedUser, kind: OrgMasterKind, id: string) {
    this.assertCanGovern(actor);
    await this.find(kind, id);

    const after =
      kind === "designation"
        ? await prisma.designation.update({ where: { id }, data: { reviewed: true } })
        : await prisma.branch.update({ where: { id }, data: { reviewed: true } });

    await this.audit.record({
      entityType: kind === "designation" ? "Designation" : "Branch",
      entityId: id,
      action: "reviewed",
      actorId: actor.id,
      after: { name: after.name, reviewed: true },
    });

    return after;
  }

  /**
   * Fold one row into another: every employee is moved, then the empty row is
   * retired rather than deleted.
   *
   * The source keeps its normalised form, so the next sync still recognises
   * the old spelling — and because the row is retired and empty, that spelling
   * lands somewhere harmless instead of silently re-creating the duplicate.
   */
  async merge(actor: AuthenticatedUser, kind: OrgMasterKind, fromId: string, intoId: string) {
    this.assertCanGovern(actor);
    if (fromId === intoId) throw new BadRequestException("Those are the same row");

    const from = await this.find(kind, fromId);
    const into = await this.find(kind, intoId);

    const moved = await prisma.$transaction(async (tx) => {
      const result =
        kind === "designation"
          ? await tx.employee.updateMany({
              where: { designationId: fromId },
              data: { designationId: intoId },
            })
          : await tx.employee.updateMany({
              where: { branchId: fromId },
              data: { branchId: intoId },
            });

      if (kind === "designation") {
        await tx.designation.update({ where: { id: fromId }, data: { isActive: false, reviewed: true } });
      } else {
        await tx.branch.update({ where: { id: fromId }, data: { isActive: false, reviewed: true } });
      }
      return result.count;
    });

    await this.audit.record({
      entityType: kind === "designation" ? "Designation" : "Branch",
      entityId: fromId,
      action: "merged",
      actorId: actor.id,
      before: { name: from.name, isActive: true },
      after: { mergedInto: into.name, employeesMoved: moved, isActive: false },
      reason: `Merged into “${into.name}”`,
    });

    return { movedEmployees: moved, into: into.name };
  }

  /** Retire a row nobody holds, or bring one back. */
  async setActive(actor: AuthenticatedUser, kind: OrgMasterKind, id: string, isActive: boolean) {
    this.assertCanGovern(actor);
    const before = await this.find(kind, id);
    if (before.isActive === isActive) {
      throw new BadRequestException(`That ${kind} is already ${isActive ? "active" : "retired"}`);
    }

    if (!isActive) {
      const held =
        kind === "designation"
          ? await prisma.employee.count({ where: { designationId: id, isActive: true } })
          : await prisma.employee.count({ where: { branchId: id, isActive: true } });
      if (held > 0) {
        throw new BadRequestException(
          `${held} active ${held === 1 ? "person holds" : "people hold"} this ${kind}. ` +
            "Merge it into another instead, which moves them.",
        );
      }
    }

    const after =
      kind === "designation"
        ? await prisma.designation.update({ where: { id }, data: { isActive, reviewed: true } })
        : await prisma.branch.update({ where: { id }, data: { isActive, reviewed: true } });

    await this.audit.record({
      entityType: kind === "designation" ? "Designation" : "Branch",
      entityId: id,
      action: isActive ? "restored" : "retired",
      actorId: actor.id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    });

    return after;
  }
}
