import { Injectable, NotFoundException } from "@nestjs/common";
import { ApprovalStatus, ManualScope, Prisma, prisma } from "@workpulse/db";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../auth/identity.service";

/**
 * Operations Manual generation (TM-FR-099 to 101).
 *
 * The manual is DERIVED, never authored. Its authority comes entirely from
 * being a faithful projection of the live model at a point in time, which is
 * why there is no edit path and why every included policy and workflow version
 * id is recorded in the snapshot.
 *
 * Every manual states its own coverage and staleness. A well-formatted document
 * describing procedures nobody follows is worse than having none at all, so the
 * reader is told up front how far to trust it.
 */
@Injectable()
export class ManualService {
  constructor(private readonly audit: AuditService) {}

  async generate(actor: AuthenticatedUser, scopeType: ManualScope, scopeId: string) {
    const asOf = new Date();
    const { label, processes } = await this.resolveScope(scopeType, scopeId);

    let activitiesInScope = 0;
    let activitiesCovered = 0;
    let staleWorkflows = 0;

    const sections = processes.map((process) => {
      const activities = process.activities.map((a) => {
        const version = a.workflow?.versions[0] ?? null;
        const stale = Boolean(version?.reviewDueAt && version.reviewDueAt < asOf);
        const documented = Boolean(version);

        activitiesInScope++;
        if (documented && !stale && a.deskCard.holderEmployeeId) activitiesCovered++;
        if (stale) staleWorkflows++;

        return {
          activityId: a.id,
          title: a.title,
          deskCard: a.deskCard.name,
          holder: a.deskCard.holder?.name ?? null,
          priority: a.priority,
          estimatedMinutes: a.estimatedMinutes,
          frequency: a.frequency,
          taskType: a.taskType.name,
          workflow: version
            ? {
                versionId: version.id,
                versionNumber: version.versionNumber,
                approvedAt: version.approvedAt,
                isStale: stale,
                steps: version.steps.map((s) => ({
                  position: s.position,
                  title: s.title,
                  expectedMinutes: s.expectedMinutes,
                })),
              }
            : null,
        };
      });

      return {
        processId: process.id,
        code: process.code,
        name: process.name,
        controlObjective: process.controlObjective,
        owner: process.owner.name,
        policy: process.policy
          ? {
              policyId: process.policy.id,
              code: process.policy.code,
              name: process.policy.name,
              // The version in force NOW, which is what governs the procedures
              // below it. Future-dated versions are deliberately excluded.
              versionId: process.policy.versions[0]?.id ?? null,
              versionNumber: process.policy.versions[0]?.versionNumber ?? null,
              effectiveFrom: process.policy.versions[0]?.effectiveFrom ?? null,
            }
          : null,
        activities,
      };
    });

    const coveragePercent =
      activitiesInScope === 0 ? 0 : Math.round((activitiesCovered / activitiesInScope) * 100);

    const manual = await prisma.operationsManual.create({
      data: {
        scopeType,
        scopeId,
        scopeLabel: label,
        generatedByUserId: actor.id,
        generatedAt: asOf,
        activitiesInScope,
        activitiesCovered,
        staleWorkflows,
        coveragePercent,
        // Permission-limited generation lands in Phase 6 alongside confidential
        // tasks; until then nothing is withheld, and the flag says so honestly
        // rather than implying a filter that does not exist.
        wasScopeLimited: false,
        contentJson: { generatedAt: asOf.toISOString(), scope: label, sections } as Prisma.InputJsonValue,
      },
    });

    await this.audit.record({
      entityType: "OperationsManual",
      entityId: manual.id,
      action: "generated",
      actorId: actor.id,
      after: { scopeType, scopeId, scopeLabel: label, coveragePercent, activitiesInScope },
    });

    return manual;
  }

  async list(scopeType?: ManualScope, scopeId?: string) {
    return prisma.operationsManual.findMany({
      where: { scopeType, scopeId },
      orderBy: { generatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        scopeType: true,
        scopeLabel: true,
        generatedAt: true,
        coveragePercent: true,
        activitiesInScope: true,
        activitiesCovered: true,
        staleWorkflows: true,
      },
    });
  }

  async byId(id: string) {
    const manual = await prisma.operationsManual.findUnique({ where: { id } });
    if (!manual) throw new NotFoundException("Manual not found");
    return manual;
  }

  /** Shared include shape, so list and generation cannot diverge on what a manual contains. */
  private processInclude() {
    return {
      owner: { select: { name: true } },
      policy: {
        include: {
          versions: {
            where: { status: "APPROVED" as const, effectiveFrom: { lte: new Date() } },
            orderBy: { effectiveFrom: "desc" as const },
            take: 1,
          },
        },
      },
      activities: {
        orderBy: { title: "asc" as const },
        include: {
          taskType: { select: { name: true } },
          deskCard: { select: { name: true, holderEmployeeId: true, holder: { select: { name: true } } } },
          workflow: {
            include: {
              versions: {
                where: { status: ApprovalStatus.APPROVED },
                orderBy: { versionNumber: "desc" as const },
                take: 1,
                include: { steps: { orderBy: { position: "asc" as const } } },
              },
            },
          },
        },
      },
    };
  }

  private async resolveScope(scopeType: ManualScope, scopeId: string) {
    if (scopeType === ManualScope.PROCESS) {
      const process = await prisma.process.findUnique({
        where: { id: scopeId },
        include: this.processInclude(),
      });
      if (!process) throw new NotFoundException("Process not found");
      return { label: process.name, processes: [process] };
    }

    if (scopeType === ManualScope.POLICY) {
      const policy = await prisma.policy.findUnique({ where: { id: scopeId }, select: { name: true } });
      if (!policy) throw new NotFoundException("Policy not found");
      const processes = await prisma.process.findMany({
        where: { policyId: scopeId },
        include: this.processInclude(),
        orderBy: { name: "asc" },
      });
      return { label: policy.name, processes };
    }

    const department = await prisma.department.findUnique({ where: { id: scopeId }, select: { name: true } });
    if (!department) throw new NotFoundException("Department not found");
    const processes = await prisma.process.findMany({
      where: { activities: { some: { deskCard: { departmentId: scopeId } } } },
      include: this.processInclude(),
      orderBy: { name: "asc" },
    });
    return { label: department.name, processes };
  }
}
