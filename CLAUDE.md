# CLAUDE.md - context for working on SIHL workPulse

You are continuing a build that started in a planning conversation elsewhere.
This file is the handoff. Read it fully before making changes.

## What this is

**workPulse** is SIHL's Enterprise Work Management Platform - task, project
and team execution, RACI/DACI governance, SLA/escalation, MIS with
drill-down, an eventual CEO Command Centre feed, and employee performance
evidence (KRA + Beyond-KRA scoring) feeding HR appraisal.

**Reference material - read these before building any module:**
- `docs/reference/SIHL_WMP_Business_Requirement_Specification.docx` - the
  full BRS. Section numbers referenced throughout this codebase (e.g.
  "Section 14", "TM-FR-029") point here. Appendix A is the literal
  functional-requirements backlog; Appendix F is open decisions.
- `docs/reference/SIHL_WMP_UI_Wireframes.pdf` - 8 low-fidelity screens
  (My tasks, task detail, Kanban, team workload, enterprise dashboard,
  project view, recurring task setup, exit checklist), each annotated
  back to BRS requirement IDs.
- `docs/brs-addendum-01-desk-card-and-policy-layer.md` - **APPROVED, and it
  changes the shape of the product.** Adds Desk Card -> Workflow -> Process
  -> Policy -> Operations Manual (TM-FR-072 to TM-FR-112) and makes the
  Desk Card, not the Task, the spine. Critically, it **supersedes the BRS's
  free-standing Recurring Task Template**: recurrence is a property of a
  Desk Card Activity, and there is exactly one recurrence engine. Read §3.3
  before touching recurrence.
- `docs/brs-addendum-02-performance-scoring-model.md` - the universal
  scoring model (TM-FR-113 to TM-FR-124). Draft, pending HR sign-off. Do
  not build any scoring surface against it yet.

**Appendix E of the BRS is void.** It classifies most capabilities as
"Reuse/Configure" against Frappe. SIHL has since decided to build off
Frappe, so every one of those rows is custom development here. Treat
Appendix A rows as functional requirements and ignore their Frappe columns.

## Critical architectural decision: this is NOT built on Frappe

SIHL's other systems (Vision/CRM, SIHL-One) run on Frappe. workPulse is a
deliberate departure from that, built fresh with this stack. The one thing
that does NOT change: **Frappe HR remains the sole source of truth for
Employee/Department data.** workPulse reads a cache of it
(`apps/api/src/jobs/frappe-hr-sync.ts`), it never becomes a second place
employee data can drift from. Do not add employee/department write paths
to this app outside that sync job.

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router, TS) | Server components fit the read-heavy MIS/dashboard screens well |
| Backend | NestJS (TS) | Modules map 1:1 onto BRS sections (Task, Project, SLA, RACI/DACI...); DI makes the audit/RBAC cross-cutting concerns easy to enforce consistently |
| API contract | REST now; tRPC is the intended end-state between web and api once the module surface stabilizes past Phase 0 - don't add GraphQL |
| DB | PostgreSQL + Prisma | Relational fit for dependencies/hierarchies/RACI; Prisma migrations are the single source of truth for schema history |
| Jobs | Redis + BullMQ | Recurring task generation, SLA evaluation, escalation, notification digests - same pattern as the sync job, don't invent a second job system |
| Auth | **Synapse** (`C:\Projects\Synapse`) | **Decided 7 Sep 2026: Keycloak is dropped.** workPulse is registered in Synapse's `AppMaster` and appears in its Apps navbar. Synapse owns identity - its `synapse_session` HS256 JWT cookie, its `UserDetails`, its `RoleMaster`/`UserRoleMap`. workPulse never authenticates anyone itself and never stores a password. See `docs/synapse-integration.md`. |
| Storage | S3-compatible (MinIO locally) | Attachments |

## Traps that cost real debugging time

- **`packages/db` must be built before the API runs.** Its `main` points at
  `dist/index.js`, not `src/index.ts`. Node cannot require a `.ts` at runtime -
  it silently yields `undefined` named exports, which surfaces much later as
  `Cannot read properties of undefined (reading '$queryRaw')`. `npm run dev`
  and `npm run build` both run `build:db` first; if you run `apps/api`
  directly, build it yourself.
- **`prisma generate` fails with EPERM while the dev server is running.** On
  Windows the API process holds `query_engine-windows.dll.node` open. Stop
  `npm run dev` before `npm run build` or `db:generate`.
- **Prisma and Nest only find `.env` at the repo root when told to.** Root
  `package.json` passes `--schema` so the CLI resolves it; the API imports
  `src/load-env.ts` first, which walks up to find it. Do not add a second
  `.env` inside a workspace.
- **Never write a POSIX default like `${PORT:-3000}` in an npm script.** npm
  runs scripts through `cmd.exe` on Windows and passes it through literally.
- **One Postgres server hosts five SIHL projects.** `npm run db:migrate`,
  `db:migrate:deploy`, `db:push` and `db:seed` all run
  `packages/db/scripts/assert-target-db.js` first, which refuses unless
  `DATABASE_URL` names the `workpulse` database. Do not bypass it - pointing a
  migration at `sihl_one` or `sihl_synapse` would drop another product's tables.

### Windows: `npm run dev` and the Prisma engine DLL

`npm run dev` runs `build:db` first, which runs `prisma generate`. On Windows
that fails with `EPERM ... rename query_engine-windows.dll.node` whenever any
node process still has the engine mapped - a previous API process, or a Jest
worker that has not exited. The file can be RENAMED but not deleted while
mapped, which is the tell.

Use `npm run dev:apps` to start the API and web without regenerating. Run
`npm run build:db` deliberately, after a schema change, with nothing else
running. If it still fails, rename the DLL aside and re-run - generate will
write a fresh copy:

```bash
mv node_modules/.prisma/client/query_engine-windows.dll.node{,.old}
```

Also: a stale API on port 4000 from an earlier run will serve the OLD tRPC
router, so new procedures come back as `No procedure found on path ...` even
though the source is correct. Check the port owner before debugging the router.

## Conventions

- **TypeScript everywhere, strict mode.** No `any` without a comment explaining why (the two guard files that use it for request augmentation are the accepted exceptions - see `roles.guard.ts`, `keycloak-auth.guard.ts`).
- **Every schema change is a Prisma migration.** Never hand-edit the DB. Run `npm run db:migrate -w packages/db` and commit the generated migration folder.
- **Every mutating action gets an AuditService.record() call.** Section 19 of the BRS: who changed what, from what, to what, when, why. Look at `apps/api/src/modules/audit/audit.service.ts` for the pattern: capture `before`, perform the mutation, capture `after`, record with a `reason` for anything the BRS's business rules mark as requiring one (reassignment, reopening, cancellation, priority escalation to Critical/Management).
- **RBAC via `@Roles(...)` on every controller method that isn't `@Public()`.** No bare controllers. Confidential-task visibility rules (Section 18) will need row-level checks beyond what `@Roles()` alone can express - build that as a service-layer check, not a guard, once the Task module exists.
- **Business rules from the BRS are not optional nice-to-haves - they're the spec.** E.g. "a task cannot close without completion information", "exactly one Accountable per RACI-enabled task", "SLA clock pauses while Blocked". Implement the rule, write a test for it, don't just build the happy path.

## Build order (do not skip ahead)

Follow the BRS's own phasing (Section 24), broken into buildable slices.
Each Appendix A row (`TM-FR-xxx`) is a ready-made ticket - use them directly
rather than re-deriving requirements from the narrative sections.

This supersedes BRS Section 24, which predates both the departure from
Frappe and Addendum 01.

1. **Phase 0 (this checkout)** - foundations. Done: monorepo, audit log,
   health checks, CI, Frappe HR sync (mock mode), Next 16 + React 19,
   ESLint 9 flat config, design token system, app shell, tRPC wired through
   Nest DI. **Not done:** the identity integration below, then the first
   Prisma migration.
2. **Phase 1** - **Desk Card and Activity first**, then the Task lifecycle,
   then recurrence generated from Activities. Build the lifecycle as an
   explicit state machine, not a free-text status field - the Completed vs.
   Verified vs. Closed distinction and the
   Draft/Rejected/Reopened/Cancelled/On-Hold/Deferred side-states are
   load-bearing, not decoration. Build the wireframed screens (My tasks,
   Task detail, Kanban) against real data as each module lands, not all UI
   at the end.
3. **Phase 2** - calendar and capacity, driven by the Activity's
   `estimatedMinutes`. Time-blocking is the daily interaction, not a
   reporting afterthought.
4. **Phase 3** - Workflow/SOP authoring with version pinning, Process,
   Policy, coverage reporting, Operations Manual generation, Maker-Checker.
   See Addendum 01 §11 for the MVP subset (27 of its 41 requirements).
5. **Phase 4** - Projects, Teams, dependencies, Gantt, project-level RACI,
   DACI decision records.
6. **Phase 5** - SLA engine with pausable clock, multi-level escalation,
   source-system intake (Support Desk first), leave-aware delegation, exit
   checklist.
7. **Phase 6 (built)** - MIS drill-down, Operational Task Analytics,
   confidential tasks, Audit role, fairness/anti-gaming controls, monthly
   report card. **Ship the fairness controls and the dispute mechanism in the
   same slice as any scoring surface, never after.** Three invariants are
   enforced in code and covered by e2e tests - break any of them and the
   product becomes a liability rather than a control:
   - Confidential work is excluded from every aggregate for every role
     **except AUDIT**, and the exclusion is disclosed on the payload
     (`confidentialExcluded`) rather than silently shrinking the total.
     SYSTEM_ADMIN is deliberately NOT granted this access.
   - A flag is never a penalty. While OPEN (or upheld) the work leaves both
     numerator and denominator; dismissing it puts the work straight back on
     the next recompute. This is why `AnalyticsPeriod` is recomputed nightly
     rather than accumulated.
   - Report-card visibility is symmetric. `AnalyticsService.reportCard()` is
     the single code path for subject, manager, HR and Audit alike - there is
     no manager-only view of a figure the subject cannot see.
8. **Phase 7 (built)** - CEO Command Centre feed (TM-FR-058), HR appraisal
   evidence (TM-FR-059/060), SLA-breach prediction, and the Addendum 02 shadow
   quarter. Four invariants, each covered by tests:
   - **The feed excludes confidential work at GENERATION, not at read.**
     `CommandCentreService.detect()` filters `isConfidential: false` on every
     query. A consumer holding an integration token has no parameter that
     widens it, because the rows were never written. The feed is cursor-paged
     on a BigInt `sequence` serialised as a **string** - a cursor that lost
     precision past 2^53 would skip events silently.
   - **HR evidence carries no score.** TM-FR-060's acceptance criterion is
     literal: "when HR views WMP evidence, then no single numeric 'score' field
     exists". `AppraisalEvidence` has five component columns and no sixth
     combining them; `AppraisalService.find()` returns an explicit
     `compositeScore: null` so absence cannot be mistaken for an oversight.
     Evidence is a fixed snapshot, generation is audited, and the subject
     reading their own is recorded in `disclosedToSubjectAt`.
   - **Predictions are scored against reality.** `SlaPrediction.actuallyBreached`
     is backfilled when a task settles, and the at-risk screen reports the
     model's skill against the base rate *above* its own predictions. If skill
     is <= 0 the UI says so in plain words. A prediction nobody scores is
     decoration.
   - **The shadow score is contained.** See below.

   `analytics-core.ts` still computes the five components and **exports no
   composite-score function**, and `AnalyticsPeriod` has no composite column.
   A unit test asserts both.

## The shadow quarter (read before touching scoring)

Addendum 02's weighted composite now EXISTS, in `shadow-scoring-core.ts`. That
is not a reversal of the rule that there is no composite in `analytics-core`:
the shadow quarter's purpose is to answer whether the score would say anything
true before anyone's appraisal depends on it, and that cannot be answered
without computing it. Four structural constraints keep it contained:

1. Every export is prefixed `shadow`, so a call site cannot be mistaken in a
   diff.
2. The only persistence target is `ShadowScore`, never joined into
   `AppraisalEvidence`.
3. Reads are **AUDIT only** - not the subject, not their manager, not HR, not
   SYSTEM_ADMIN. A number nobody may act on must not circulate in appraisal
   season, and HR are excluded until Appendix F (F3-01..06) is signed off
   because the weights are still this office's draft, not HR's policy.
4. `ShadowScore.isInForce` has no true branch anywhere. Publishing the score is
   a schema and router change with a review, not a flag flip.

`/shadow-quarter` is deliberately **absent from the sidebar**, and the page
renders nothing until the caller is known to be permitted - not even its
headings. Advertising a route every other role would be refused would tell the
business a weighted score exists and is being computed on them, which is the
impression a shadow quarter is run to avoid creating.

## Access: Synapse maps four roles, direct grants cover the rest

Synapse's `role_master` contains exactly **five** roles:

    ADMIN  SUPPORT_LEAD  PRODUCT_OPS  SUPPORT_DESK  CLIENT_SELF

`SynapseRoleMap` already maps the four that should map. Six workPulse roles have
no Synapse counterpart **at all**:

    DEPARTMENT_HEAD  PROJECT_MANAGER  EXECUTIVE
    EXECUTIVE_RESTRICTED  AUDIT  INTEGRATION_SERVICE

These cannot be fixed by adding mapping rows - there is nothing to map from.
Pointing one at an existing operational role (SUPPORT_LEAD -> EXECUTIVE, say)
would hand confidential-task visibility and shadow-score access to whoever runs
the support desk. That is not a mapping, it is an invention of authority.
`RoleMapService.upsert()` therefore **refuses a mapping to a Synapse role that
does not exist** - a row pointing at a phantom code grants nothing while looking
like coverage, which is worse than an obvious gap.

### Direct grants are the mechanism

`User.localRoles` was always the designed path for "grants Synapse has no
concept of - notably AUDIT". `RoleGrantService` is the write path it was
missing. Effective roles stay `mapped(Synapse roles) UNION localRoles`.

Guardrails, all tested:

- **No self-granting AUDIT or EXECUTIVE_RESTRICTED.** A SYSTEM_ADMIN who could
  hand themselves AUDIT would make the Phase 6 and 7 separation theatre - AUDIT
  exists precisely to watch the people who administer the system. Granting them
  to someone else stays possible, is audited, and is visible to Compliance
  through `access.holders`.
- **A written reason is required** for AUDIT, EXECUTIVE_RESTRICTED, EXECUTIVE
  and INTEGRATION_SERVICE.
- **INTEGRATION_SERVICE is refused on a person** - it is for service accounts
  consuming the Command Centre feed. On someone with an employee record it would
  be a standing credential nobody reviews.
- **CLIENT_SELF can never be mapped**, at any privilege level. It is held by
  external clients; mapping it - even to EMPLOYEE - would give customers
  workPulse accounts and desk cards. Leaving it merely ABSENT invited a future
  admin to "complete" the map, so it is refused in code.
- Grants and revocations are audited with actor and reason; mappings are
  deactivated, never deleted.

### `/access` reports what nobody can reach

`access.coverage` marks a role **unreachable** when no Synapse role maps to it
and nobody holds it directly - a shipped control nobody can exercise. The screen
leads with that count. It is the thing that turned a silent gap into a known
one, so do not remove it when the count reaches zero.

### What SIHL still has to decide

Six roles are unreachable **today**. Two ways to close each one, and they are
business decisions, not engineering ones:

1. Ask the CTO to create the role in Synapse, then map it here. Durable, and
   right for DEPARTMENT_HEAD, PROJECT_MANAGER and EXECUTIVE, which track the org
   chart.
2. Grant it directly. Right for AUDIT (BRS Section 18 puts it outside the line
   hierarchy, and Appendix F wants joint CTO + Compliance sign-off),
   EXECUTIVE_RESTRICTED, and INTEGRATION_SERVICE.

Note that Phase 0 seeded mappings for `DEPT_HEAD`, `MANAGER` and `EXECUTIVE`
that are now `isActive: false` - those Synapse role codes were assumed and never
existed. The new guard would refuse to reactivate them.

## Handover: exits, internal transfers and role changes

`ExitChecklist` was renamed to `Handover` in Phase 7.1 and broadened. An
internal move has the same failure mode as an exit - work stays attached to
somebody who has stopped doing it - and happens far more often. A resignation at
least has a last working day forcing the issue; a move across the floor has
nothing.

`HandoverReason` is not cosmetic. It changes what moves:

| Item | EXIT | INTERNAL_TRANSFER | ROLE_CHANGE |
|---|---|---|---|
| Desk card | hand over, blocks | hand over, blocks | hand over, blocks |
| Task in the old department | hand over | hand over | retained |
| Task from the outgoing desk card | hand over | hand over | hand over |
| Any other task | hand over | **retained** | **retained** |
| RACI / DACI role | hand over | **retained** | **retained** |
| Process / policy owner | hand over, blocks | hand over, blocks | hand over, blocks |

The rules live in `handover-core.ts`, pure and tested without a database - a
rule that wrongly RETAINS a desk card leaves a seat nobody occupies, and one
that wrongly HANDS OVER a project role strips someone of work they are still
doing.

Three invariants:

- **Nothing RETAINED can block.** There is no second party to wait for, so a
  blocking retained item is a condition nobody could ever satisfy. `normalise()`
  enforces it centrally so a future rule cannot reintroduce the deadlock.
- **Nothing can be retained on an exit.** The person is leaving; it has to go to
  somebody. The service refuses it.
- **An internal transfer needs BOTH managers**, and not the same person twice.
  The releasing manager attests the work really moved; the receiving one attests
  they know what is arriving. One signature is how people get transferred with
  their old obligations still attached.

One OPEN handover per employee is enforced by a **partial unique index**
(`handovers_one_open_per_employee`), not by the service remembering. A person may
transfer several times and then eventually leave - each is its own row - but two
concurrent open handovers would let two managers hand the same work to two
different people.

Completing an INTERNAL_TRANSFER also sets `Employee.departmentId`. Frappe HR
stays the master and the nightly sync reasserts it; this only stops workPulse
showing the person in a department they have left until the next sync runs.

## Things to not do

- Don't duplicate Employee/Department as writable local data.
- Don't ship a weighted performance score without the dispute mechanism and
  anti-gaming controls landing first - this was a deliberate, discussed
  decision, not an oversight to "fix" by building the score sooner.
- Don't introduce a second background-job system alongside BullMQ.
- Don't build Frappe-style low-code admin screens for master data - plain
  CRUD UIs in `apps/web` are fine and preferred; this app deliberately
  traded Frappe's low-code speed for a stack Claude Code can reason about
  end to end.

## Decisions already taken (do not re-open without the user)

- **Not built on Frappe.** Appendix E is void; see above.
- **Addendum 01 approved 7 Sep 2026** - Desk Card is the spine, and it
  supersedes the free-standing Recurring Task Template.
- **Identity is Synapse**, not Keycloak - see the stack table.
- **Scoring** follows Addendum 02's model, and ships only after a shadow
  quarter. Never ship a score without its dispute mechanism.

## Open decisions still needed from SIHL (don't guess at these)

- Hosting/data-residency region (BRS assumed AWS ap-south-1; confirm with Compliance)
- Addendum 02 Appendix F-3: component weights, volume floor, band boundaries,
  dispute window, priority-inflation threshold, and whether HR receives the
  score or only its components
- Whether Task-level RACI ships in Phase 4 or later (BRS recommends
  Project-level first)
