# BRS Addendum 02 — Universal Performance Scoring Model

**Shah Investors Home Limited — Work Management Platform (workPulse)**

| | |
|---|---|
| **Extends** | SIHL WMP BRS v1.0 §15.17–15.18, and Addendum 01 |
| **Version** | 0.1 — Draft for HR, Compliance and CEO review |
| **Date** | 7 September 2026 |
| **New requirement IDs** | TM-FR-113 to TM-FR-124 |
| **Status** | Draft — the scoring surface must not ship before §8 sign-off |

---

## 1. The problem this has to solve

A single score that means the same thing for a Compliance Officer filing twelve returns a year and a Support Executive closing three hundred tickets a month.

Every naive approach fails this test:

| Approach | Why it fails |
|---|---|
| Tasks completed | A support agent outscores a compliance officer 25:1 for doing less consequential work. |
| Completion % | Rises when you create trivial tasks. Punishes whoever holds the hard, blocked work. |
| On-time % | Counts a one-day slip and a thirty-day slip identically, and blames people for others' delays. |
| Peer ranking | Meaningless across functions, corrosive within them, and indefensible in an employment dispute. |

The model below is universal because **every component is a ratio measured against that individual's own governed obligations** — their desk card — never against a peer's volume. A compliance officer and a support executive can both score 82, and it means the same thing about each of them.

---

## 2. The unit: Weighted Task Units (WTU)

Everything is denominated in WTU. One WTU is **one priority-neutral half-hour of committed work**.

```
WTU(task) = priorityWeight × (estimatedMinutes ÷ 30)
```

| Priority | Weight |
|---|---|
| Critical | 3.0 |
| Urgent | 2.4 |
| High | 1.8 |
| Medium | 1.2 |
| Low | 1.0 |

**Why this construction, and not a complexity rating.** An earlier draft weighted by a Low/Medium/High complexity field. That field is subjective and set at creation, which makes it a gaming surface. `estimatedMinutes` is already a governed field: Addendum 01 §4 rule 3 puts it under the Department Head, changeable only with an audited reason. The formula therefore inherits an existing control instead of inventing a new one.

**Splitting-neutrality is structural.** Because effort sums linearly, splitting one 120-minute task into four 30-minute tasks yields identical WTU. There is no arithmetic advantage to task-splitting — the anti-gaming heuristic (TM-FR-064) exists to catch the *reporting* distortion, not an arithmetic exploit.

**Priority inflation is controlled at source.** Priority is set by the assigner, not the performer. Where a manager's assignments skew abnormally toward Critical, §6.2 normalises that manager's distribution rather than letting their team inflate.

---

## 3. The five components

Each returns a value in [0, 1]. The composite is their weighted sum × 100.

### 3.1 Execution — weight 30%

> Of the work you committed to this period, how much did you deliver?

```
Execution = Σ WTU(closed, not flagged) ÷ Σ WTU(due in period)
```

The denominator is the **desk card**: obligations assigned to this person for this period, plus any ad hoc or project work assigned to them. This is the component that makes the model universal — you are measured against your own committed load, whatever its shape.

Skipping your own recurring obligations to chase easier work lowers this directly, because the skipped items remain in the denominator.

### 3.2 Timeliness — weight 25%

> Of what you delivered, how much was on time — excluding delays outside your control?

```
Timeliness = Σ WTU(closed within SLA, on paused-adjusted clock) ÷ Σ WTU(SLA-tracked, closed)
```

The SLA clock pauses while a task is Blocked or On Hold (BRS §15.11, TM-FR-040). Time a person spent waiting on a predecessor, an approval, or another department **never counts against them**. This is not a courtesy; without it the score punishes whoever sits downstream of a bottleneck, which is precisely backwards.

### 3.3 Quality — weight 20%

> Did the work hold up once it left your hands?

```
Quality = 1 − [ Σ WTU(reopened) + Σ WTU(rejected at verification) + Σ WTU(evidence-flagged) ]
              ÷ Σ WTU(closed)
```

Floored at 0. A task reopened twice counts once — repeated reopening of the same item is a signal about the review process, surfaced separately (§6.3), not a compounding penalty on the individual.

### 3.4 Governance — weight 15%

> Did you meet the control obligations attached to your role?

```
Governance = Σ (met control obligations) ÷ Σ (control obligations owed)
```

Control obligations, each counted once and equally weighted:

- Maker-checker checks performed within SLA when you were the named checker
- Approvals actioned within SLA when you were the named Approver or RACI Accountable
- Required workflow steps marked complete on tasks whose Task Type demands it
- Required evidence attached where the Task Type requires it
- Policy and workflow reviews completed by their review date, where you are the Owner

This is the component Addendum 01 makes possible, and it is what distinguishes a work-management score from a control-environment score. For a BFSI entity approaching listing, this is the component the audit committee will care about most.

### 3.5 Contribution beyond desk card — weight 10%

> Did you take on work beyond your defined role?

```
Contribution = min( Σ WTU(closed, not on own desk card) ÷ Σ WTU(desk card due), 1.0 )
```

Capped at 1.0 so it can reward stepping up without letting someone abandon their own obligations to farm discretionary work. This is the "Beyond-KRA" half of the BRS's framing, expressed as a bounded bonus rather than an open-ended one.

### 3.6 Composite

```
Score = 100 × ( 0.30·Execution + 0.25·Timeliness + 0.20·Quality
              + 0.15·Governance + 0.10·Contribution )
```

Weights are configurable per Task Type profile but **not per individual** — a manager cannot re-weight one person's score. Changing the weights is an audited System Admin action that applies from the next period forward, never retrospectively.

---

## 4. Guards that are not optional

These are conditions of the model, not enhancements. If any is dropped, the score stops being defensible and must not ship.

### 4.1 Minimum volume floor

If `Σ WTU(due) < 20` for the period, the system returns **Insufficient data** — not a low score. A person on extended leave, newly joined, or holding a small number of very large items is not scored as though they underperformed.

### 4.2 Bands, not decimals

The score is published as a band with its component breakdown:

| Band | Range |
|---|---|
| Exceeds | 90–100 |
| Meets | 75–89 |
| Developing | 60–74 |
| Below expectation | < 60 |
| Insufficient data | volume floor not met |

A raw number to one decimal invites ranking and false precision. **The band and the five components are the output; the composite number is never displayed alone.**

### 4.3 Symmetric visibility

The employee sees exactly what their manager and HR see — same components, same underlying task list, same flags, at the same time. There is no manager-only view of a person's own score. This is BRS §15.17's existing rule and it is absolute.

### 4.4 Every figure drills to its tasks

Any component can be expanded to the exact tasks that produced it. A score that cannot be interrogated cannot be disputed, and a score that cannot be disputed should not exist.

### 4.5 Dispute mechanism

An employee may dispute any component within 14 days. A disputed score is **marked as disputed everywhere it appears**, including in any HR feed, until resolved. Resolution is by the manager's manager, recorded with a reason. Disputes and their outcomes are audited.

### 4.6 Advisory only

The score is an input to a manager's judgement, never an automatic determinant of rating, increment, or any compensation formula. No API exposes it in a form that permits automated downstream consumption by a compensation system.

### 4.7 Flagged work is excluded, not penalised

Tasks flagged by the anti-gaming controls (TM-FR-062) are excluded from both numerator and denominator until a manager reviews them. A flag is a prompt for human attention, never an automatic deduction.

---

## 5. Why this is universally applicable

Worked comparison across three genuinely different roles in the same period:

| | Compliance Officer | Support Executive | Project Manager |
|---|---|---|---|
| Tasks due | 14 | 260 | 9 |
| Avg. estimated minutes | 90 | 8 | 300 |
| Typical priority | High / Critical | Medium | High |
| **WTU due** | ~63 | ~104 | ~162 |
| Raw task count would say | lowest performer | highest performer | lowest performer |
| **This model says** | measured against their own 63 WTU | measured against their own 104 WTU | measured against their own 162 WTU |

Each is assessed against their own governed obligations. None competes with the others. The score answers one question, identically for all three:

> **Of what you were committed to, at the weight it carried, how much did you deliver — on time, to standard, within your controls, plus what you took on beyond it?**

**Cross-department ranking remains explicitly unsupported.** BRS Appendix C already warns that Department Productivity is not comparable across departments with different task granularity. The same applies here: the score supports within-role trend over time and a manager conversation. It does not support a leaderboard, and the system will not render one.

---

## 6. Anti-gaming, by construction

| Vector | Control |
|---|---|
| Task splitting | WTU is splitting-neutral arithmetically; TM-FR-064 heuristic flags the reporting distortion |
| Priority inflation | Priority set by assigner; per-manager distribution normalised where skew is abnormal (§6.2) |
| Effort inflation | `estimatedMinutes` set by Department Head, changes audited with reason (Addendum 01) |
| Cherry-picking easy work | Desk-card denominator — skipped obligations stay in it |
| Reassigning away overdue work | Stays in the original owner's denominator for the period; TM-FR-063 pattern view to Department Head |
| Closing without doing | Evidence-completeness flag excludes it until reviewed; Quality penalty on confirmed cases |
| Gaming the reviewer | Maker-checker segregation of duties; self-verification impossible under any role |
| Manager suppressing a report's score | Score is symmetric and disputable; weights not adjustable per individual |

### 6.2 Priority-distribution normalisation

If a manager's assignments in a period exceed a configured Critical/Urgent proportion (default 25%), their team's priority weights are rescaled to the configured distribution for scoring purposes only — task priority itself is untouched, and the normalisation is disclosed on every affected score.

### 6.3 Reopen-rate context

An abnormally high reopen rate concentrated under one reviewer is surfaced to the Department Head as a review-process signal, not attributed to the performers.

---

## 7. Phasing — the score does not ship first

Consistent with BRS §24 and the plan agreed with SIHL:

| Stage | What runs | What is visible |
|---|---|---|
| **1. Shadow** (min. one full quarter) | All five components computed | Nothing. Data quality and flag rates reviewed by Product and HR only. |
| **2. Components only** | Same | Employee and manager see the five components and their drill-downs. **No composite, no band.** |
| **3. Full score** | Same | Band + components, disputes live, HR feed enabled. |

Stage 3 requires HR sign-off that Stage 2 ran without material dispute volume or data-quality failure. **The anti-gaming controls and the dispute mechanism ship in Stage 2, not Stage 3** — they must be proven before anything they protect goes live.

---

## 8. Requirements

| ID | Requirement | Priority |
|---|---|---|
| TM-FR-113 | Compute WTU per task as priorityWeight × (estimatedMinutes ÷ 30) | High |
| TM-FR-114 | Compute the five components per employee per period | High |
| TM-FR-115 | Exclude paused (Blocked/On Hold) time from all timeliness calculations | High |
| TM-FR-116 | Return "Insufficient data" below the configured WTU volume floor | High |
| TM-FR-117 | Publish score as a band plus components; never expose the composite alone | High |
| TM-FR-118 | Show the employee exactly what the manager and HR see, simultaneously | High |
| TM-FR-119 | Drill from any component to the exact contributing tasks | High |
| TM-FR-120 | Provide a dispute path; mark disputed scores as disputed wherever displayed | High |
| TM-FR-121 | Exclude anti-gaming-flagged tasks until manager review | High |
| TM-FR-122 | Normalise per-manager priority distribution beyond the configured threshold, and disclose it | Medium |
| TM-FR-123 | Make weights configurable per Task Type profile, audited, effective forward only | Medium |
| TM-FR-124 | Expose no API surface permitting automated compensation consumption | High |

## 9. Decisions required

| Ref | Question | Recommended default | From |
|---|---|---|---|
| F3-01 | Are the five component weights (30/25/20/15/10) accepted? | Yes; revisit after Stage 2 with real distribution data | HR / CEO |
| F3-02 | Volume floor threshold | 20 WTU per period | HR / Dept Heads |
| F3-03 | Band boundaries (90/75/60) | As tabled; calibrate after the shadow quarter | HR |
| F3-04 | Dispute window and escalation authority | 14 days; manager's manager resolves | HR |
| F3-05 | Priority-inflation threshold | 25% Critical+Urgent per manager per period | Dept Heads |
| F3-06 | Does HR receive the score, or components only? | Components in Stage 2; score from Stage 3 only | HR / CEO |

---

*Extends the SIHL WMP BRS v1.0 and Addendum 01. Requirement identifiers TM-FR-113 onward are introduced here.*
