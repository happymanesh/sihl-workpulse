import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { ActorType, Prisma, WorkPulseRole, prisma } from "@workpulse/db";
import type { AuthenticatedUser } from "../auth/identity.service";
import { AuditService } from "../audit/audit.service";
import { AnalyticsService } from "./analytics.service";
import {
  SHADOW_DRAFT_WEIGHTS,
  shadowComposite,
  shadowDistribution,
  shadowVerdict,
  type ShadowWeights,
} from "./shadow-scoring-core";

/**
 * The Addendum 02 shadow quarter.
 *
 * This is the single most access-restricted surface in workPulse, and
 * deliberately so. It computes a weighted performance score that **is not in
 * force**, for the sole purpose of answering whether that score would say
 * anything true before anybody's appraisal depends on it.
 *
 * Access is AUDIT only. Not the subject, not their manager, not HR, not
 * SYSTEM_ADMIN:
 *
 *   - The subject and their manager are excluded because a number nobody is
 *     permitted to act on should not be circulating in appraisal season. Telling
 *     someone their shadow score and then insisting it does not count is not a
 *     control, it is a formality nobody will respect.
 *   - HR are excluded until Appendix F (F3-01..06) is signed off, because at
 *     that point the weights they would be reading are still a draft this office
 *     proposed, not a policy HR agreed.
 *   - SYSTEM_ADMIN is excluded for the same reason it cannot read confidential
 *     tasks: running the system is not standing to read people's performance.
 *
 * Audit retains access because a control the compliance function cannot inspect
 * is not a control.
 */
@Injectable()
export class ShadowScoreService {
  private readonly logger = new Logger(ShadowScoreService.name);

  constructor(
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  private assertMayRead(actor: AuthenticatedUser): void {
    if (!actor.roles.includes(WorkPulseRole.AUDIT)) {
      throw new ForbiddenException(
        "Shadow scores are readable by the Audit role only. The weighted score is not in force; " +
          "see BRS Addendum 02 §7 and Appendix F (F3-01 to F3-06).",
      );
    }
  }

  /**
   * Computes shadow scores for a period.
   *
   * Employees below the volume floor are computed and stored, but marked
   * `hasSufficientVolume: false` upstream on `AnalyticsPeriod` and excluded from
   * the distribution - the shadow quarter must not conclude that the model
   * discriminates well on the strength of people it could not assess.
   */
  async computePeriod(
    periodStart: Date,
    periodEnd: Date,
    weights: ShadowWeights = SHADOW_DRAFT_WEIGHTS,
  ) {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    let computed = 0;
    const errors: string[] = [];

    for (const e of employees) {
      try {
        const period = await this.analytics.computeFor(e.id, periodStart, periodEnd);

        const composite = shadowComposite(
          {
            execution: period.execution ?? 0,
            timeliness: period.timeliness ?? 0,
            quality: period.quality ?? 0,
            governance: period.governance ?? 0,
            contribution: period.contribution ?? 0,
          },
          weights,
        );

        await prisma.shadowScore.upsert({
          where: {
            employeeId_periodStart_periodEnd: { employeeId: e.id, periodStart, periodEnd },
          },
          create: {
            employeeId: e.id,
            periodStart,
            periodEnd,
            weightsJson: weights as unknown as Prisma.InputJsonValue,
            composite,
            // Never true. Publishing the score is a schema and router change
            // with a review, not a flag flip.
            isInForce: false,
          },
          update: {
            weightsJson: weights as unknown as Prisma.InputJsonValue,
            composite,
            computedAt: new Date(),
          },
        });
        computed += 1;
      } catch (err) {
        errors.push(`${e.id}: ${(err as Error).message}`);
      }
    }

    await this.audit.record({
      entityType: "ShadowScore",
      entityId: `${periodStart.toISOString()}..${periodEnd.toISOString()}`,
      action: "COMPUTE_SHADOW_PERIOD",
      actorType: ActorType.SYSTEM,
      after: { employees: employees.length, computed, weights },
      reason: "Addendum 02 shadow quarter - score not in force",
    });

    return { employees: employees.length, computed, errors };
  }

  /**
   * The shadow quarter's conclusion.
   *
   * Returns the distribution and a stated verdict rather than a chart, so the
   * review produces an answer somebody has to disagree with in writing - not a
   * picture that can be read to suit a decision already taken.
   */
  async report(actor: AuthenticatedUser, periodStart: Date, periodEnd: Date) {
    this.assertMayRead(actor);

    const [scores, periods] = await Promise.all([
      prisma.shadowScore.findMany({
        where: { periodStart, periodEnd },
        select: { employeeId: true, composite: true, weightsJson: true, isInForce: true },
      }),
      prisma.analyticsPeriod.findMany({
        where: { periodStart, periodEnd },
        select: { employeeId: true, hasSufficientVolume: true },
      }),
    ]);

    const volumeById = new Map(periods.map((p) => [p.employeeId, p.hasSufficientVolume]));
    const distribution = shadowDistribution(
      scores.map((s) => ({
        employeeId: s.employeeId,
        composite: s.composite,
        hasSufficientVolume: volumeById.get(s.employeeId) ?? false,
      })),
    );

    await this.audit.record({
      entityType: "ShadowScore",
      entityId: `${periodStart.toISOString()}..${periodEnd.toISOString()}`,
      action: "READ_SHADOW_REPORT",
      actorId: actor.id,
      reason: "Audit read the shadow quarter distribution",
    });

    return {
      distribution,
      verdict: shadowVerdict(distribution),
      weights: scores[0]?.weightsJson ?? SHADOW_DRAFT_WEIGHTS,
      // Restated on every read. A caller must not be able to forget it.
      isInForce: false,
      notInForceReason:
        "Addendum 02 §7 requires a full shadow quarter and HR sign-off (Appendix F, F3-01 to F3-06) " +
        "before any weighted score is published. No composite figure reaches appraisal evidence, " +
        "the report card, or MIS.",
    };
  }

  /**
   * Per-employee shadow scores, for Audit's inspection of the distribution.
   *
   * Returns ids and figures, never names. Audit's question during a shadow
   * quarter is "does this model separate people sensibly", not "who scored
   * badly" - and the second question is not one this data is permitted to
   * answer yet.
   */
  async anonymisedScores(actor: AuthenticatedUser, periodStart: Date, periodEnd: Date) {
    this.assertMayRead(actor);

    const scores = await prisma.shadowScore.findMany({
      where: { periodStart, periodEnd },
      select: { employeeId: true, composite: true },
      orderBy: { composite: "asc" },
    });

    return scores.map((s, index) => ({
      // A stable pseudonym within the report, so a reviewer can refer to a row
      // without the row naming a person.
      subject: `S-${String(index + 1).padStart(3, "0")}`,
      composite: s.composite,
    }));
  }
}
