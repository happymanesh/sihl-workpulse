import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { TaskFlagStatus, WorkPulseRole, prisma } from "@workpulse/db";
import type { AuthenticatedUser } from "../auth/identity.service";
import { AuditService } from "../audit/audit.service";
import { AnalyticsService } from "../analytics/analytics.service";

/**
 * TM-FR-060: Operational Task Analytics exposed to HR as EVIDENCE, not a score.
 *
 * The acceptance criterion is literal - "Given an appraisal cycle opens, when HR
 * views WMP evidence, then no single numeric 'score' field exists" - and this
 * service is where that has to hold in practice rather than in principle. It
 * returns the five components and the raw counts behind them. There is no
 * composite anywhere in the payload, and `AppraisalEvidence` has no column that
 * could hold one.
 *
 * BRS 4.6 describes the chain as deliberately asymmetric: data flows upward
 * freely for visibility, but into appraisal only through a governed,
 * human-reviewed step. Three things implement that asymmetry:
 *
 *   - Evidence is a SNAPSHOT. An appraisal conversation must reference a fixed
 *     artifact; a figure that moves between HR reading it and the employee being
 *     shown it is not evidence, it is an argument.
 *   - Generating it is audited. Pulling a named person's performance record is
 *     itself an act worth a trail.
 *   - Disclosure to the subject is RECORDED. TM-FR-059 says analytics are never
 *     hidden from the employee they describe; `disclosedToSubjectAt` is how that
 *     stops being a promise and becomes a fact somebody can check.
 */
@Injectable()
export class AppraisalService {
  constructor(
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  private assertHrOrAudit(actor: AuthenticatedUser): void {
    // Deliberately narrow. A line manager reads evidence through the report
    // card, which is symmetric with what the subject sees; generating the
    // formal HR artifact is a different act with a different audience.
    const allowed = [
      WorkPulseRole.AUDIT,
      WorkPulseRole.EXECUTIVE,
      WorkPulseRole.EXECUTIVE_RESTRICTED,
      WorkPulseRole.SYSTEM_ADMIN,
    ];
    if (!allowed.some((r) => actor.roles.includes(r))) {
      throw new ForbiddenException("Only HR, Audit or an executive may generate appraisal evidence");
    }
  }

  /**
   * Builds the evidence snapshot for one employee and cycle.
   *
   * Idempotent per (employee, cycle): re-generating updates the existing row
   * rather than creating a second version, so there is exactly one artifact per
   * cycle and no ambiguity about which one the conversation used.
   */
  async generate(
    actor: AuthenticatedUser,
    input: { employeeId: string; cycleLabel: string; periodStart: Date; periodEnd: Date },
  ) {
    this.assertHrOrAudit(actor);

    const employee = await prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { id: true, name: true },
    });
    if (!employee) throw new NotFoundException("Employee not found");

    // Recompute rather than read a stale row. Evidence that HR will act on must
    // reflect the flags as they stand today, including any dismissed since the
    // last nightly pass.
    const period = await this.analytics.computeFor(
      input.employeeId,
      input.periodStart,
      input.periodEnd,
    );

    const openFlagCount = await prisma.taskFlag.count({
      where: { subjectEmployeeId: input.employeeId, status: TaskFlagStatus.OPEN },
    });

    const data = {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      execution: period.execution,
      timeliness: period.timeliness,
      quality: period.quality,
      governance: period.governance,
      contribution: period.contribution,
      hasSufficientVolume: period.hasSufficientVolume,
      wtuDue: period.wtuDue,
      wtuClosed: period.wtuClosed,
      wtuOnTime: period.wtuOnTime,
      wtuReopened: period.wtuReopened,
      openFlagCount,
      excludedTaskCount: period.excludedFlaggedTasks,
      generatedByUserId: actor.id,
      generatedAt: new Date(),
    };

    const evidence = await prisma.appraisalEvidence.upsert({
      where: { employeeId_cycleLabel: { employeeId: input.employeeId, cycleLabel: input.cycleLabel } },
      create: { employeeId: input.employeeId, cycleLabel: input.cycleLabel, ...data },
      update: data,
    });

    await this.audit.record({
      entityType: "AppraisalEvidence",
      entityId: evidence.id,
      action: "GENERATE",
      actorId: actor.id,
      after: {
        employeeId: input.employeeId,
        cycleLabel: input.cycleLabel,
        hasSufficientVolume: period.hasSufficientVolume,
        openFlagCount,
      },
      reason: `Appraisal evidence generated for cycle ${input.cycleLabel}`,
    });

    return evidence;
  }

  /**
   * Reads one snapshot.
   *
   * The subject may always read their own. That is not a courtesy - TM-FR-059
   * makes it a requirement, and an employee who cannot see the evidence being
   * discussed about them cannot contest it.
   */
  async find(actor: AuthenticatedUser, employeeId: string, cycleLabel: string) {
    const isSubject = actor.employeeId === employeeId;
    if (!isSubject) this.assertHrOrAudit(actor);

    const evidence = await prisma.appraisalEvidence.findUnique({
      where: { employeeId_cycleLabel: { employeeId, cycleLabel } },
      include: { employee: { select: { id: true, name: true, designation: true } } },
    });
    if (!evidence) throw new NotFoundException("No evidence for that employee and cycle");

    // Reading your own evidence IS disclosure. Recorded on first read rather
    // than requiring HR to remember a separate step.
    if (isSubject && !evidence.disclosedToSubjectAt) {
      await this.markDisclosed(evidence.id, actor.id);
    }

    return {
      ...evidence,
      // Stated on the payload so a consumer cannot mistake absence for an
      // oversight. TM-FR-060's acceptance criterion, made explicit.
      compositeScore: null as null,
      compositeScoreExplanation:
        "WMP supplies evidence, not a score. No weighted performance figure is computed or exposed; the components are read alongside the work behind them.",
      insufficientData: !evidence.hasSufficientVolume,
    };
  }

  private async markDisclosed(evidenceId: string, actorId: string) {
    await prisma.appraisalEvidence.update({
      where: { id: evidenceId },
      data: { disclosedToSubjectAt: new Date() },
    });
    await this.audit.record({
      entityType: "AppraisalEvidence",
      entityId: evidenceId,
      action: "DISCLOSE_TO_SUBJECT",
      actorId,
      reason: "Subject viewed their own appraisal evidence",
    });
  }

  /** Every snapshot in a cycle, for HR's own view of where a cycle stands. */
  async listCycle(actor: AuthenticatedUser, cycleLabel: string) {
    this.assertHrOrAudit(actor);

    return prisma.appraisalEvidence.findMany({
      where: { cycleLabel },
      include: { employee: { select: { id: true, name: true, designation: true } } },
      orderBy: { employee: { name: "asc" } },
    });
  }

  /**
   * Generates evidence for a whole department in one cycle.
   *
   * Refuses an empty department rather than silently producing nothing, because
   * "the run completed" and "the run produced no evidence" must not look the
   * same to whoever is preparing an appraisal round.
   */
  async generateForDepartment(
    actor: AuthenticatedUser,
    input: { departmentId: string; cycleLabel: string; periodStart: Date; periodEnd: Date },
  ) {
    this.assertHrOrAudit(actor);

    const employees = await prisma.employee.findMany({
      where: { departmentId: input.departmentId, isActive: true },
      select: { id: true },
    });
    if (employees.length === 0) {
      throw new BadRequestException("That department has no active employees");
    }

    let generated = 0;
    let insufficient = 0;
    for (const e of employees) {
      const evidence = await this.generate(actor, { ...input, employeeId: e.id });
      generated += 1;
      if (!evidence.hasSufficientVolume) insufficient += 1;
    }

    // Reported, not hidden: HR needs to know how much of a cycle's evidence is
    // "not enough data" before they build a process around it.
    return { employees: employees.length, generated, insufficient };
  }
}
