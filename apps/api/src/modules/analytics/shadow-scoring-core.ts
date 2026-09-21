import type { Components } from "./analytics-core";

/**
 * Addendum 02's weighted composite, for the SHADOW QUARTER only.
 *
 * This module exists in tension with a rule stated elsewhere in this codebase -
 * that `analytics-core.ts` deliberately has no composite function, because the
 * easiest way to ship a score early is to leave one lying around. That rule
 * still holds, and this is not a loophole in it. The shadow quarter's entire
 * purpose is to answer "would this score have said anything true?" before
 * anyone's appraisal depends on it, and that question cannot be answered
 * without computing the number.
 *
 * Four structural constraints keep it contained, and none of them is a comment:
 *
 *   1. Every export is prefixed `shadow`. A call site cannot be mistaken for
 *      production scoring when reading a diff.
 *   2. The only persistence target is `ShadowScore`, which is never joined into
 *      `AppraisalEvidence`. TM-FR-060's acceptance criterion - "no single
 *      numeric 'score' field exists" when HR views evidence - stays true.
 *   3. Reads are restricted to AUDIT and a named HR reviewer in the service.
 *      Neither the subject's manager nor the subject sees a shadow score,
 *      because a number nobody is allowed to act on should not be circulating
 *      in appraisal season.
 *   4. `ShadowScore.isInForce` has no true branch anywhere. Turning the score on
 *      is a schema and router change with a review, not a flag flip.
 *
 * Addendum 02 §7 also requires the shadow quarter to run for a full quarter and
 * be signed off by HR (Appendix F, F3-01..06) before any of this is published.
 * The weights below are the ADDENDUM DRAFT's, not agreed values.
 */

export interface ShadowWeights {
  execution: number;
  timeliness: number;
  quality: number;
  governance: number;
  contribution: number;
}

/**
 * Addendum 02 §3 draft weights. **Not signed off by HR.**
 *
 * Held as data rather than constants in the formula so a shadow quarter run
 * under one set of weights cannot be silently confused with a run under
 * another - `ShadowScore.weightsJson` records what was actually used.
 */
export const SHADOW_DRAFT_WEIGHTS: ShadowWeights = {
  execution: 0.3,
  timeliness: 0.25,
  quality: 0.2,
  governance: 0.15,
  contribution: 0.1,
};

export function shadowWeightsAreValid(w: ShadowWeights): boolean {
  const total = w.execution + w.timeliness + w.quality + w.governance + w.contribution;
  // Floating-point tolerance, not a licence for weights that nearly add up.
  return Math.abs(total - 1) < 1e-9 && Object.values(w).every((v) => v >= 0);
}

/**
 * The weighted composite, 0..1.
 *
 * Throws on weights that do not sum to 1. A composite computed from weights
 * that silently summed to 0.95 would be quietly wrong for everybody, and the
 * shadow quarter would conclude the wrong thing about a model that was never
 * actually tested.
 */
export function shadowComposite(
  components: Components,
  weights: ShadowWeights = SHADOW_DRAFT_WEIGHTS,
): number {
  if (!shadowWeightsAreValid(weights)) {
    throw new Error("Shadow weights must be non-negative and sum to exactly 1");
  }

  return (
    components.execution * weights.execution +
    components.timeliness * weights.timeliness +
    components.quality * weights.quality +
    components.governance * weights.governance +
    components.contribution * weights.contribution
  );
}

// ---------------------------------------------------------------------------
// What the shadow quarter is actually for
// ---------------------------------------------------------------------------

export interface ShadowObservation {
  employeeId: string;
  composite: number;
  hasSufficientVolume: boolean;
}

export interface ShadowDistribution {
  /** Only employees who cleared the volume floor. */
  assessed: number;
  /** Below the floor - reported, never scored. */
  insufficient: number;
  min: number | null;
  median: number | null;
  max: number | null;
  /** Gap between the 90th and 10th percentile. */
  spread: number | null;
  /** How many sit within 5 points of the median. */
  clusteredAtMedian: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/**
 * The distribution a shadow quarter is run to look at.
 *
 * The failure this is designed to catch is not "the score is low". It is "the
 * score does not discriminate" - if 90% of people land within a couple of points
 * of each other, the model has measured nothing and must not be published,
 * however defensible its arithmetic looks. `clusteredAtMedian` is the number to
 * read first.
 */
export function shadowDistribution(observations: ShadowObservation[]): ShadowDistribution {
  const assessed = observations.filter((o) => o.hasSufficientVolume);
  const insufficient = observations.length - assessed.length;

  if (assessed.length === 0) {
    return {
      assessed: 0,
      insufficient,
      min: null,
      median: null,
      max: null,
      spread: null,
      clusteredAtMedian: 0,
    };
  }

  const sorted = assessed.map((o) => o.composite).sort((a, b) => a - b);
  const median = percentile(sorted, 50);

  return {
    assessed: assessed.length,
    insufficient,
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
    spread: percentile(sorted, 90) - percentile(sorted, 10),
    clusteredAtMedian: sorted.filter((v) => Math.abs(v - median) <= 0.05).length,
  };
}

/** Below this spread, the model is not separating anyone from anyone. */
export const MINIMUM_USEFUL_SPREAD = 0.1;

/** Above this share sitting at the median, the model is not discriminating. */
export const MAXIMUM_CLUSTER_SHARE = 0.7;

export interface ShadowVerdict {
  discriminates: boolean;
  reasons: string[];
}

/**
 * Whether a shadow quarter's result would justify publishing the score.
 *
 * Advisory only - HR signs off, not this function. It exists so the shadow
 * quarter produces a stated conclusion rather than a chart somebody interprets
 * to suit the decision they had already made.
 */
export function shadowVerdict(d: ShadowDistribution): ShadowVerdict {
  const reasons: string[] = [];

  if (d.assessed < 20) {
    reasons.push(`Only ${d.assessed} employees cleared the volume floor; too few to conclude anything`);
  }
  if (d.spread !== null && d.spread < MINIMUM_USEFUL_SPREAD) {
    reasons.push(
      `The 10th-to-90th percentile spread is ${(d.spread * 100).toFixed(1)} points; the score barely separates anyone`,
    );
  }
  if (d.assessed > 0 && d.clusteredAtMedian / d.assessed > MAXIMUM_CLUSTER_SHARE) {
    reasons.push(
      `${Math.round((d.clusteredAtMedian / d.assessed) * 100)}% of employees sit within 5 points of the median`,
    );
  }

  return { discriminates: reasons.length === 0, reasons };
}
