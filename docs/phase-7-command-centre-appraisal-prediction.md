# Phase 7 — CEO Command Centre, Appraisal Evidence, SLA-Breach Prediction

**Status:** Built. Covers TM-FR-058, TM-FR-059, TM-FR-060, the Appendix F "first
AI capability" decision, and the Addendum 02 shadow-quarter mechanism.

**Not covered, deliberately:** the weighted composite score is **not in force**
and does not reach any surface a manager, HR or an employee can read. See §4.

---

## 1. CEO Command Centre feed (TM-FR-058)

> *System shall expose a structured API/event feed of enterprise status for the
> future CEO Command Centre. The feed excludes Confidential task content by
> default.* — BRS Appendix A

### What was built

An **event stream**, not a dashboard query. The Command Centre is a separate
consumer on its own cadence: it must be able to ask "what changed since I last
looked" without re-deriving the enterprise from scratch, and without workPulse
knowing anything about how it renders.

| Surface | Consumer |
|---|---|
| `GET /command-centre/events?since=<cursor>&limit=<n>` | External Command Centre, via `INTEGRATION_SERVICE` |
| `GET /command-centre/pulse?periodStart=&periodEnd=` | Same |
| `commandCentre.*` tRPC procedures | workPulse's own `/command-centre` screen |

REST rather than tRPC for the integration surface on purpose. tRPC's value is
end-to-end types for *our* web client; this endpoint exists for a consumer built
by someone else, on a stack we do not control, possibly years from now.

### The six conditions that reach a CEO

The governing principle is that **this feed must stay quiet**. A CEO feed that
fires on every overdue task is read once and then ignored, which is worse than
not having one — it converts a real escalation into noise the reader has been
trained to skip.

| Event | Threshold | Why this threshold |
|---|---|---|
| `SLA_BREACH` | Critical and Urgent only | A breached Low-priority task is a real fact and a line-manager matter |
| `ESCALATION_TOP_LEVEL` | Only when the chain is exhausted | Intermediate levels are the chain *working*; the top level is it having failed |
| `CRITICAL_OVERDUE` | Critical, 24h+ past due | Below this, the escalation chain has not finished trying |
| `BLOCKED_BEYOND_THRESHOLD` | 72h+ blocked | Names the **blocking owner**, not the assignee — the one case where the task-holder usually cannot act |
| `RECURRING_COMPLIANCE_MISSED` | Any, always URGENT | For a BFSI entity approaching listing, a missed filing is not a productivity metric |
| `PROJECT_HEALTH_DEGRADED` | On the transition only | A project AT_RISK for a month is a known problem being managed; one that became AT_RISK this morning is news |

All thresholds are exported constants so SIHL can calibrate them against real
volume rather than argue about them in the abstract.

### Two properties enforced in code

1. **Confidentiality is applied at generation, not at read.** Every query in
   `CommandCentreService.detect()` carries `isConfidential: false`. A consumer
   holding an integration token has no parameter that widens it, because the
   excluded rows were never written.

2. **The cursor cannot skip.** `sequence` is a 64-bit `BigInt` serialised as a
   **string** on the way out. As a JSON number it would silently lose precision
   past 2^53, and a cursor that quietly skips events is the one failure mode a
   feed must not have.

Events resolve as well as raise. A feed that could only accumulate would be
unreadable by week three.

---

## 2. HR appraisal evidence (TM-FR-059, TM-FR-060)

> *Given an appraisal cycle opens, when HR views WMP evidence, then no single
> numeric 'score' field exists.* — BRS Appendix A, TM-FR-060 acceptance criterion

That criterion is taken **literally**:

- `AppraisalEvidence` has five component columns and no sixth combining them.
- `AppraisalService.find()` returns an explicit `compositeScore: null` plus a
  written explanation, so absence cannot be mistaken for an oversight.
- An e2e test asserts no numeric key named `score`, `composite` or `overall`
  appears anywhere in the payload.

### Why a snapshot rather than a live query

An appraisal conversation must reference a **fixed artifact**. A figure that
moves between HR reading it and the employee being shown it is not evidence, it
is an argument. Generating a snapshot is idempotent per `(employee, cycle)`, so
there is exactly one artifact per cycle and no ambiguity about which one the
conversation used.

### The asymmetry BRS §4.6 asks for

> *Data flows upward freely for visibility, but only flows into the formal
> appraisal process through a governed, human-reviewed step.*

Three things implement it:

- **Generation is restricted** to HR, Audit or an executive. A line manager is
  deliberately refused — they read the same figures through the report card,
  which is symmetric with what the subject sees.
- **Generation is audited**, naming who pulled whose record.
- **Disclosure is recorded.** TM-FR-059 says analytics are never hidden from the
  employee they describe; `disclosedToSubjectAt` is set the moment the subject
  reads their own, which is how that stops being a promise and becomes a fact
  somebody can check. The `/appraisal` screen shows HR how many subjects have
  not yet seen their evidence.

Work excluded by an open flag is **disclosed on the snapshot**
(`openFlagCount`, `excludedTaskCount`) rather than silently shrinking the
denominator.

---

## 3. SLA-breach prediction

Appendix F asks which AI capability to prioritise and answers: *"SLA-breach
prediction — clearest operational payoff, lowest governance risk."*

### What this is, precisely

An **explainable additive model**, not a fitted one. The naming says so
throughout: `risk`, never `confidence` or `probability`. Three reasons this is
the right starting point rather than a placeholder for a "real" model:

1. **There is no training data yet.** A model fitted on an empty history would
   be a confident-looking random number.
2. **A supervisor cannot act on "0.82".** They can act on *"not started, 70% of
   the window gone, and this task type breaches a third of the time"*. Every
   factor carries its own contribution, and the UI shows the top four.
3. **It is measurable.** `SlaPrediction.actuallyBreached` is backfilled when a
   task settles.

### Honesty about accuracy

Accuracy is reported as **skill against the base rate**, not raw accuracy. If 5%
of tasks breach, then "nothing will ever breach" is 95% accurate and completely
useless. The `/at-risk` screen shows the model's own track record **above** its
predictions, and when skill ≤ 0 it says so in plain words:

> *On this record the model is not adding information beyond how often work
> breaches anyway. Weigh it accordingly, and raise it — a model that earns
> nothing should be recalibrated or retired, not quietly tolerated.*

### What is not assessed

Settled work, paused work (`ON_HOLD`, `DEFERRED` — a paused clock cannot breach
while paused), and anything with no SLA attached. Predicting breach for
something already closed is noise a supervisor has to learn to ignore, which is
how a useful signal becomes a dismissed one.

---

## 4. The Addendum 02 shadow quarter

**The weighted composite score now exists in code. It is not in force and does
not reach any surface a manager, HR or an employee can read.**

This is not a reversal of the Phase 6 rule that `analytics-core.ts` has no
composite function. That rule still holds and is still tested. The shadow
quarter's entire purpose is to answer *"would this score have said anything
true?"* before anyone's appraisal depends on it — and that question cannot be
answered without computing the number.

### Four structural constraints, none of them a comment

1. Every export in `shadow-scoring-core.ts` is prefixed `shadow`, so a call site
   cannot be mistaken for production scoring when reading a diff.
2. The only persistence target is `ShadowScore`, never joined into
   `AppraisalEvidence`. TM-FR-060 stays true while a shadow quarter runs, and an
   e2e test asserts it.
3. Reads are **AUDIT only**.
4. `ShadowScore.isInForce` has no `true` branch anywhere in the codebase.
   Publishing the score is a schema and router change with a review, not a flag
   flip.

### Why not the subject, their manager, HR, or SYSTEM_ADMIN

| Excluded | Reason |
|---|---|
| The subject | A number nobody is permitted to act on should not be circulating in appraisal season. Telling someone their shadow score and then insisting it does not count is not a control, it is a formality nobody will respect. |
| Their manager | Same, and worse — they are the person who would act on it. |
| HR | Until Appendix F (F3-01..06) is signed off, the weights are this office's **draft**, not HR's policy. Showing HR a distribution computed under weights they have not agreed invites the sign-off to be retrofitted to the result. |
| SYSTEM_ADMIN | Running the system is not standing to read people's performance — the same reason it cannot read confidential tasks. |

Audit retains access because a control the compliance function cannot inspect is
not a control.

### What the shadow quarter is actually looking for

**Not "is the score low".** The failure this is designed to catch is *"the score
does not discriminate"* — if 90% of people land within a couple of points of
each other, the model has measured nothing and must not be published, however
defensible its arithmetic looks.

`shadowVerdict()` states a conclusion rather than producing a chart, so the
review ends in something somebody has to disagree with in writing:

- Fewer than 20 employees above the volume floor → too few to conclude anything
- 10th-to-90th percentile spread below 10 points → barely separates anyone
- More than 70% within 5 points of the median → not discriminating

Advisory only. HR signs off, not this function.

### `/shadow-quarter` is not in the sidebar

And the page renders **nothing** — not even its headings — until the caller is
known to be permitted. Advertising a route every other role would be refused
would tell the business that a weighted performance score exists and is being
computed on them, which is precisely the impression a shadow quarter is run to
avoid creating.

---

## 5. Open items carried out of Phase 7

### 5.1 TM-FR-061 vs Addendum 02 — Complexity is captured but not weighted

TM-FR-061 asks for analytics weighted by **Priority and Complexity**. Addendum
02 §2 defines a Weighted Task Unit as `priorityWeight × (estimatedMinutes ÷ 30)`
— effort, not complexity.

These are not the same thing. A two-hour reconciliation and a two-hour
regulatory interpretation take the same time and are not the same work.

**What was done:** `Task.complexity` (LOW/MEDIUM/HIGH, nullable, treated as
MEDIUM when absent) was added and is captured at task creation. It is **not** a
term in the WTU formula.

**What is needed:** an amendment to Addendum 02 §2 deciding whether complexity
becomes a third multiplier, and at what weights. Changing the scoring formula
unilaterally after sign-off would be wrong. Capturing the attribute now means
the history exists when the amendment lands.

### 5.2 Access — resolved, with decisions left to SIHL

**Investigated and addressed.** Synapse's `role_master` holds exactly five
roles: `ADMIN`, `SUPPORT_LEAD`, `PRODUCT_OPS`, `SUPPORT_DESK`, `CLIENT_SELF`.
The four that should map already do. The six remaining workPulse roles have no
Synapse counterpart at all, so they could never have been fixed by adding
mapping rows — there is nothing to map from.

**What was built:**

- `RoleGrantService` — the write path for `User.localRoles`, which the schema
  always anticipated for "grants Synapse has no concept of, notably AUDIT".
- `RoleMapService` — mapping administration that refuses a Synapse role code
  that does not exist, and refuses `CLIENT_SELF` at any privilege level.
- `/access` — a coverage report naming every role nobody can currently reach.

**Guardrails:** no self-granting of AUDIT or EXECUTIVE_RESTRICTED (an admin who
could hand themselves AUDIT would make the Phase 6 and 7 separation theatre);
a written reason required for the four sensitive roles; INTEGRATION_SERVICE
refused on anyone with an employee record; everything audited with actor and
reason.

**Still to decide, per role** — create it in Synapse and map it (durable, right
for the three that track the org chart), or grant it directly (right for AUDIT,
which BRS Section 18 puts outside the line hierarchy).

### 5.3 Decisions still needed from SIHL

| Ref | Decision | Owner |
|---|---|---|
| F3-01..06 | Addendum 02 weights and whether the composite is ever published | HR |
| — | Complexity in the WTU formula (§5.1) | HR / Product & AI Office |
| — | Synapse role mappings for the six unmapped roles (§5.2) | CTO |
| — | Command Centre event thresholds, after observing real volume | CEO / CXO |
| — | Whether HR consume evidence via this API or via Frappe HR Goal/Appraisal | HR / CTO |
