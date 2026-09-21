import {
  MAXIMUM_CLUSTER_SHARE,
  MINIMUM_USEFUL_SPREAD,
  SHADOW_DRAFT_WEIGHTS,
  shadowComposite,
  shadowDistribution,
  shadowVerdict,
  shadowWeightsAreValid,
  type ShadowObservation,
} from "./shadow-scoring-core";

const perfect = {
  execution: 1,
  timeliness: 1,
  quality: 1,
  governance: 1,
  contribution: 1,
};

describe("shadow composite", () => {
  it("returns 1 when every component is perfect", () => {
    expect(shadowComposite(perfect)).toBeCloseTo(1, 10);
  });

  it("weights the components per Addendum 02's draft", () => {
    const executionOnly = { execution: 1, timeliness: 0, quality: 0, governance: 0, contribution: 0 };
    expect(shadowComposite(executionOnly)).toBeCloseTo(0.3, 10);
  });

  it("refuses weights that do not sum to 1", () => {
    // A composite from weights that silently summed to 0.95 would be quietly
    // wrong for everybody, and the shadow quarter would conclude the wrong
    // thing about a model that was never actually tested.
    expect(() =>
      shadowComposite(perfect, { execution: 0.3, timeliness: 0.25, quality: 0.2, governance: 0.15, contribution: 0.05 }),
    ).toThrow();
  });

  it("refuses negative weights", () => {
    expect(() =>
      shadowComposite(perfect, { execution: 1.1, timeliness: 0, quality: 0, governance: 0, contribution: -0.1 }),
    ).toThrow();
  });

  it("accepts the draft weights", () => {
    expect(shadowWeightsAreValid(SHADOW_DRAFT_WEIGHTS)).toBe(true);
  });
});

describe("the distribution a shadow quarter is run to look at", () => {
  const obs = (composite: number, hasSufficientVolume = true): ShadowObservation => ({
    employeeId: `e${composite}`,
    composite,
    hasSufficientVolume,
  });

  it("excludes employees below the volume floor from the statistics", () => {
    // The model must not be judged to discriminate well on the strength of
    // people it could not assess.
    const d = shadowDistribution([obs(0.5), obs(0.9), obs(0.1, false)]);
    expect(d.assessed).toBe(2);
    expect(d.insufficient).toBe(1);
    expect(d.min).toBe(0.5);
  });

  it("reports nulls rather than zeros when nothing could be assessed", () => {
    const d = shadowDistribution([obs(0.5, false)]);
    expect(d).toMatchObject({ assessed: 0, insufficient: 1, min: null, median: null, spread: null });
  });

  it("handles an empty period", () => {
    expect(shadowDistribution([]).assessed).toBe(0);
  });

  it("counts how many sit at the median", () => {
    const clustered = Array.from({ length: 10 }, (_, i) => obs(0.7 + i * 0.001));
    expect(shadowDistribution(clustered).clusteredAtMedian).toBe(10);
  });
});

describe("the shadow quarter's verdict", () => {
  const spread = (n: number, lo: number, hi: number): ShadowObservation[] =>
    Array.from({ length: n }, (_, i) => ({
      employeeId: `e${i}`,
      composite: lo + ((hi - lo) * i) / (n - 1),
      hasSufficientVolume: true,
    }));

  it("passes a model that separates people across a real range", () => {
    const v = shadowVerdict(shadowDistribution(spread(40, 0.3, 0.95)));
    expect(v.discriminates).toBe(true);
    expect(v.reasons).toHaveLength(0);
  });

  it("fails a model where everyone lands in the same place", () => {
    // The failure this is designed to catch is not "the score is low" but
    // "the score does not discriminate".
    const v = shadowVerdict(shadowDistribution(spread(40, 0.74, 0.76)));
    expect(v.discriminates).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/separates|median/i);
  });

  it("refuses to conclude anything from too few people", () => {
    const v = shadowVerdict(shadowDistribution(spread(5, 0.2, 0.9)));
    expect(v.discriminates).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/too few/i);
  });

  it("states a reason for every failure rather than just failing", () => {
    const v = shadowVerdict(shadowDistribution(spread(3, 0.75, 0.75)));
    expect(v.reasons.length).toBeGreaterThan(0);
    expect(v.reasons.every((r) => r.length > 10)).toBe(true);
  });

  it("has thresholds that are exported and therefore calibratable", () => {
    expect(MINIMUM_USEFUL_SPREAD).toBeGreaterThan(0);
    expect(MAXIMUM_CLUSTER_SHARE).toBeGreaterThan(0);
    expect(MAXIMUM_CLUSTER_SHARE).toBeLessThanOrEqual(1);
  });
});

describe("containment", () => {
  it("keeps analytics-core free of any composite function", () => {
    // The Phase 6 property still holds: the composite lives here, behind
    // AUDIT-only access, and not in the module every analytics path imports.
    const core = jest.requireActual("./analytics-core");
    expect(Object.keys(core)).not.toContain("computeScore");
    expect(Object.keys(core)).not.toContain("compositeScore");
    expect(Object.keys(core)).not.toContain("shadowComposite");
  });

  it("prefixes every export so a call site cannot be mistaken in a diff", () => {
    const mod = jest.requireActual("./shadow-scoring-core");
    const runtimeExports = Object.keys(mod).filter((k) => typeof mod[k] !== "undefined");
    expect(runtimeExports.every((k) => k.toLowerCase().startsWith("shadow") || k === "MINIMUM_USEFUL_SPREAD" || k === "MAXIMUM_CLUSTER_SHARE")).toBe(true);
  });
});
