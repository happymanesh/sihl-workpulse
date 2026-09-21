import { Injectable } from "@nestjs/common";
import { ApprovalStatus, prisma } from "@workpulse/db";

export interface ActivityCoverage {
  activityId: string;
  title: string;
  deskCardName: string;
  hasHolder: boolean;
  hasApprovedWorkflow: boolean;
  isWorkflowStale: boolean;
  isActive: boolean;
  /** True when nothing is wrong with it. */
  isCovered: boolean;
}

export interface ProcessCoverage {
  processId: string;
  code: string;
  name: string;
  ownerName: string;
  policyName: string | null;
  total: number;
  covered: number;
  percent: number;
  exceptions: {
    noHolder: ActivityCoverage[];
    noWorkflow: ActivityCoverage[];
    staleWorkflow: ActivityCoverage[];
    inactive: ActivityCoverage[];
  };
}

/**
 * Process coverage (TM-FR-089) - the assurance output of the whole Phase 3
 * chain.
 *
 * Deliberately an exception report rather than a hierarchy view. "Show me the
 * tree" is not a question anyone needs answered; "which of my controls has a
 * gap" is, and it is the one an auditor will ask.
 *
 * Coverage is REPORTED, never enforced. Falling below a threshold notifies; it
 * does not stop work. A control environment that halts operations when its
 * documentation lapses would simply be switched off.
 */
@Injectable()
export class CoverageService {
  async forProcess(processId: string, asOf: Date = new Date()): Promise<ProcessCoverage | null> {
    const process = await prisma.process.findUnique({
      where: { id: processId },
      include: {
        owner: { select: { name: true } },
        policy: { select: { name: true } },
        activities: {
          include: {
            deskCard: { select: { name: true, holderEmployeeId: true } },
            workflow: {
              include: {
                versions: {
                  where: { status: ApprovalStatus.APPROVED },
                  orderBy: { versionNumber: "desc" },
                  take: 1,
                  select: { id: true, reviewDueAt: true },
                },
              },
            },
          },
        },
      },
    });
    if (!process) return null;

    const rows: ActivityCoverage[] = process.activities.map((a) => {
      const approved = a.workflow?.versions[0] ?? null;
      const hasHolder = Boolean(a.deskCard.holderEmployeeId);
      const hasApprovedWorkflow = Boolean(approved);
      const isWorkflowStale = Boolean(approved?.reviewDueAt && approved.reviewDueAt < asOf);

      return {
        activityId: a.id,
        title: a.title,
        deskCardName: a.deskCard.name,
        hasHolder,
        hasApprovedWorkflow,
        isWorkflowStale,
        isActive: a.isActive,
        isCovered: hasHolder && hasApprovedWorkflow && !isWorkflowStale && a.isActive,
      };
    });

    const covered = rows.filter((r) => r.isCovered).length;

    return {
      processId: process.id,
      code: process.code,
      name: process.name,
      ownerName: process.owner.name,
      policyName: process.policy?.name ?? null,
      total: rows.length,
      covered,
      percent: rows.length === 0 ? 0 : Math.round((covered / rows.length) * 100),
      exceptions: {
        noHolder: rows.filter((r) => !r.hasHolder),
        noWorkflow: rows.filter((r) => r.hasHolder && !r.hasApprovedWorkflow),
        staleWorkflow: rows.filter((r) => r.isWorkflowStale),
        inactive: rows.filter((r) => !r.isActive),
      },
    };
  }

  async allProcesses(asOf: Date = new Date()): Promise<ProcessCoverage[]> {
    const ids = await prisma.process.findMany({
      where: { status: { not: ApprovalStatus.RETIRED } },
      select: { id: true },
      orderBy: { name: "asc" },
    });
    const results = await Promise.all(ids.map((p) => this.forProcess(p.id, asOf)));
    return results.filter((r): r is ProcessCoverage => r !== null);
  }

  /**
   * TM-FR-090: orphans.
   *
   * Mapping is easy to establish and easy to abandon. Surfacing the decay is
   * what stops the whole chain quietly becoming decorative - so this ships
   * alongside the mapping, not as later reporting work.
   */
  async orphans() {
    const [activitiesWithoutProcess, processesWithoutPolicy, policiesWithoutProcess] = await Promise.all([
      prisma.deskCardActivity.findMany({
        where: { processId: null, isActive: true },
        select: { id: true, title: true, deskCard: { select: { name: true } } },
      }),
      prisma.process.findMany({
        where: { policyId: null, status: { not: ApprovalStatus.RETIRED } },
        select: { id: true, code: true, name: true },
      }),
      prisma.policy.findMany({
        where: { processes: { none: {} }, status: { not: "WITHDRAWN" } },
        select: { id: true, code: true, name: true },
      }),
    ]);

    return { activitiesWithoutProcess, processesWithoutPolicy, policiesWithoutProcess };
  }
}
