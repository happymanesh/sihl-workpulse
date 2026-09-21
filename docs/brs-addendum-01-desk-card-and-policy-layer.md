# BRS Addendum 01 — Desk Card, Workflow, Process, Policy and Operations Manual Layer

**Shah Investors Home Limited — Work Management Platform (workPulse)**

| | |
|---|---|
| **Document title** | BRS Addendum 01 — Desk Card & Policy Layer |
| **Extends** | SIHL WMP Business Requirement Specification v1.0 (18 Aug 2026) |
| **Version** | 1.0 — Approved |
| **Date** | 3 September 2026 (approved 7 September 2026) |
| **Prepared by** | Product & AI Office (SIHL) |
| **Status** | **Approved.** Cleared for build. Appendix F-2 defaults stand as decided unless superseded in writing. |
| **New requirement IDs** | TM-FR-072 to TM-FR-112 |
| **Classification** | Internal — Management Distribution |

### Revision history

| Version | Date | Author | Summary of change |
|---|---|---|---|
| 0.1 | 3 Sep 2026 | Product & AI Office | Initial draft. Introduces the Desk Card → Workflow → Process → Policy → Operations Manual layer following competitive review of the 9to5 platform. |
| 1.0 | 7 Sep 2026 | Product & AI Office | Approved in full. All Appendix F-2 recommended defaults (F2-01 to F2-07) accepted as decided. Build order in CLAUDE.md updated accordingly. |

---

## 1. Purpose

The BRS v1.0 specifies workPulse as a task and work-orchestration platform: work is created, assigned, executed, escalated, measured and reported. It answers **what is due, who owns it, and did it happen.**

It does not answer three questions that a BFSI entity approaching a listing is expected to answer on demand:

1. **What is this employee actually responsible for, as a standing obligation?** — independent of whatever happens to be in their task queue this week.
2. **How is each of those obligations meant to be performed?** — the documented procedure, not just a checklist of whether it was done.
3. **Which internal control does each obligation serve, and which policy authorises it?** — the line from an individual clerical act up to a board-approved policy.

This addendum specifies the layer that answers those three questions and the artefact that evidences them: the **Desk Card**, the **Workflow (SOP)**, the **Process**, the **Policy**, and the generated **Operations Manual**.

### 1.1 Why this is being added now

A competitive review of the 9to5 platform (features deck, 23pp, reviewed 3 Sep 2026) established that this chain — not task management — is that product's organising idea, and that it is aimed directly at the broking back office. Its screenshots show the model applied to SIHL-shaped work: NSDL payouts, demat reconciliation, pledge and unpledge processing, auction settlement, MTF confirmations, early pay-in.

The finding is not that we should copy a competitor. It is that the competitor identified a genuine gap in our specification, and that gap is precisely the internal-controls evidence trail SIHL needs ahead of listing. The BRS's own risk register already flags that operational execution data must be defensible; this layer is what makes it defensible in the other direction, by showing that the work was *defined and authorised* before it was measured.

### 1.2 What this addendum is not

- It is **not** a replacement for the Task object. The Task remains the atomic unit of execution (BRS §4.4). The Desk Card is a *source* of Tasks and a *description* of standing obligations, not a parallel execution model.
- It is **not** an appraisal or KRA system. Frappe HR's Goal and Appraisal doctypes remain the owners of appraisal objectives (BRS §4.4, §7.2). §3.4 below defines the boundary explicitly, because this is the single most likely place for scope to leak.
- It is **not** a document management system. Policies and manuals are modelled to the depth needed to link controls to execution and to generate a manual — not to replace a records-management platform.

---

## 2. Relationship to the BRS

This addendum **extends** the BRS. Where the two conflict, this document governs only for the objects it introduces; the BRS governs everywhere else.

| BRS section | Effect of this addendum |
|---|---|
| §4.4 Object classification | **Extended** — adds Desk Card, Desk Card Activity, Workflow, Process, Policy, Operations Manual to the classification table (§3.1 below). |
| §13 Task Taxonomy | **Amended** — Desk Card Activity becomes a recognised origin of Tasks alongside the four existing entry patterns (§8.1). |
| §13.A Recurring Tasks | **Amended** — Recurring Task Template becomes a property of a Desk Card Activity rather than a free-standing object. See §3.3; this is the most important integration point in this document. |
| §14.1 Completed / Verified / Closed | **Clarified, not changed** — Maker-Checker is specified as Verification under an enforced segregation-of-duties constraint, not a new lifecycle state (§7). |
| §15 Functional Requirements | **Extended** — adds modules 15.22 through 15.27. |
| §16 Data Model | **Extended** — §9.1. |
| §17 Master Data | **Extended** — §9.2. |
| §18 Security | **Extended** — §9.3, adding policy/manual visibility and the Process Owner role. |
| §19 Audit Trail | **Extended** — §9.4, adding workflow version pinning and desk card holder history. |
| §24 Roadmap | **Amended** — §10 proposes where this layer sits in the build sequence. |
| Appendix A | **Extended** — Appendix A-2 (§11), TM-FR-072 to TM-FR-112. |
| Appendix E Frappe classification | **Void** — SIHL has since decided to build workPulse off the Frappe platform. Every "Reuse/Configure" row in Appendix E is custom development in the current architecture. Requirement rows in this addendum therefore replace the *Frappe Capability* and *Custom Development* columns with a single **Build note** column. |
| Appendix F | **Extended** — Appendix F-2 (§12), seven new decisions required. |

---

## 3. Design analysis and critical assessment

Consistent with BRS §4, this section records where the source model was challenged rather than accepted.

### 3.1 Object classification additions

| Real-world item | Modelled as | Rationale |
|---|---|---|
| The standing set of obligations attached to a role (e.g. "Compliance Officer — daily obligations") | **Desk Card** | Held by one employee at a time, but outlives any individual holder. This is what makes one-click handover on transfer or exit possible without destroying history. |
| A single standing obligation on that card (e.g. "Reconcile demat auto-entries, daily, 10 min") | **Desk Card Activity** | The unit that is costed, scheduled, controlled and audited. Generates Tasks; is not itself a Task. |
| The documented procedure for performing an activity | **Workflow** (versioned), containing ordered **Workflow Steps** | Answers "how". Versioned because evidence is meaningless without knowing which procedure was in force. |
| A control grouping of activities (e.g. "Client payout process") | **Process** | The internal-control lens. Its primary value is *coverage*: proving no activity in a control is unowned or undocumented. |
| A board- or management-approved statement of standards | **Policy** | Authorises processes. Carries an owner, an approver, a version, an effective date and a review cycle. |
| The consolidated procedural document for an area | **Operations Manual** | **Generated, never authored.** A derived artefact so it cannot drift from the live model. |
| A four-eyes control on a specific execution | **Maker-Checker** — an attribute of an activity, not a new object | See §7. Adding a third sign-off concept alongside Verification and Approval would be unnecessary complexity of exactly the kind BRS §4.2 rejects. |

### 3.2 Where the source model was rejected or constrained

Four aspects of the reviewed competitor model are deliberately **not** adopted as-is.

**(a) Not everything becomes a desk card activity.** In the reviewed product, the desk card and the task tray are effectively the same surface, which leaves ad hoc work, project work and system-generated work without a natural home. workPulse retains all four BRS entry patterns (§12 of the BRS). A Task may originate from a Desk Card Activity, or from any existing source, and carries an optional `deskCardActivityId` — absent for ad hoc and project work. **A Task without a desk card activity is normal and must never be treated as an exception.**

**(b) Estimated time is set by the department head, not the holder.** Minute-level effort estimates on activities are the input to real capacity measurement, which is their virtue. They are also a direct gaming vector: an employee who sets their own estimates can inflate them to appear fully loaded. Estimates are therefore set at desk card approval by the Department Head, changes are audited with a reason, and the holder may *propose* a revision but not apply one. This extends BRS §15.18 to a new surface rather than opening a hole in it.

**(c) A generated operations manual must carry its own quality signal.** The failure mode of auto-generated documentation is a well-formatted manual describing procedures nobody follows. Every generated manual therefore reports its own coverage and staleness on the cover page — the proportion of in-scope activities that have an approved, in-date workflow — so a reader can see immediately whether the document is authoritative or aspirational.

**(d) Policy-to-process mapping decays unless the decay is visible.** Mapping is easy to establish and easy to abandon. Orphan and coverage reporting (TM-FR-090, TM-FR-096) is therefore specified as first-class functionality in the same slice as the mapping itself, not as later reporting work.

### 3.3 Reconciling Desk Card Activity with Recurring Task Template

The BRS already specifies a Recurring Task Template (§13.A, TM-FR-001 to TM-FR-004) that generates independent Task instances on a holiday-aware schedule. A Desk Card Activity that recurs needs exactly this behaviour.

**These must not be two mechanisms.** Building a second generator would duplicate the holiday logic, the missed-instance detection and the pause/resume semantics, and would contradict the platform's standing constraint that there is one background-job system and one recurrence engine.

Resolution:

- A **Recurring Task Template becomes a property of a Desk Card Activity** rather than a free-standing object. An Activity with a recurrence pattern owns exactly one template; the template has no independent existence.
- Recurring Task Templates created before this addendum ships (none exist at the time of writing, as Phase 1 is unbuilt) would need backfilling onto a Desk Card Activity. Since the layer is being specified before the recurrence engine is built, **this addendum should be approved before Phase 1 begins** to avoid building the engine twice.
- All existing template business rules (BRS §15.1) carry over unchanged: cannot delete while open instances exist, edits affect only future instances, missed instances flagged and escalated.

This is the single most consequential integration point in this document. It is also the strongest argument for sequencing the addendum's approval ahead of Phase 1 build rather than after it.

### 3.4 Boundary: Desk Card versus KRA and Appraisal Goal

The reviewed product describes the desk card as "a desk card or key responsibility area (KRA)". Adopting that equivalence would pull workPulse directly into appraisal, which BRS §7.2 places out of scope and §4.6 deliberately firewalls.

The boundary this addendum sets:

- A **Desk Card describes operational obligations** — what a role must do, how often, to what standard. It is an operations artefact owned by the Department Head.
- A **Goal (Frappe HR) describes an appraisal objective** — what an individual is being assessed against for a period. It remains owned by HR in Frappe HR.
- Desk card execution data flows into Operational Task Analytics exactly as any other task execution does, and reaches appraisal only through the governed, human-reviewed step in BRS §4.6. **The desk card itself is never an input to an appraisal rating.**
- The word "KRA" is not used in the workPulse interface or data model, to prevent the boundary eroding through vocabulary.

### 3.5 Risks introduced by this layer

| Risk | Impact | Mitigation |
|---|---|---|
| Authoring burden — hundreds of activities and workflows must be written before the platform has value | Adoption stalls; desk cards remain empty shells | Workflow authoring is optional at activity level and mandatory only for Critical and Compliance-sourced activities (§4.2, TM-FR-081). Coverage reporting makes gaps visible without blocking. |
| Documentation decay — workflows describe procedures that have since changed | The operations manual becomes misleading; worse than having none | Mandatory review cycle per workflow, staleness surfaced on the manual cover page and in process coverage reporting (§3.2c). |
| Desk card becomes a de facto job description used in employment decisions | Employment-law exposure; boundary in §3.4 erodes | Desk cards carry an explicit non-appraisal notice; changes are audited; §3.4 boundary restated in the interface. |
| Effort-estimate gaming | Distorted capacity data, unfair comparison | Estimates set and changed only by Department Head, with audit and reason (§3.2b). |
| Policy layer duplicates an existing SIHL records-management or compliance system | Fragmentation — the exact risk BRS §29 identifies | Open decision F2-07. Confirm with Compliance whether an authoritative policy register already exists before building one. |

---

## 4. Module 15.22 — Desk Card (Digital Role Portfolio)

### Narrative

A Desk Card is the standing set of operational obligations attached to a role. It is held by exactly one Employee at a time and survives changes of holder. Each row on the card is a Desk Card Activity: a discrete, repeatable obligation with a frequency, an estimated effort in minutes, a priority, an owning Process, and — where required — an approved Workflow describing how it is performed.

A Desk Card passes through Draft → Pending Review → Approved. Only an Approved card generates work. The holder acknowledges the card, which is recorded; acknowledgement is not approval and does not gate generation.

### Key business rules

1. A Desk Card has exactly one holder at any time. Holder changes are appended to holder history and never overwrite the previous holder (consistent with BRS §15.7).
2. A Desk Card Activity may only generate Tasks while both the parent card and the activity are Approved and Active, and the card has a holder.
3. Estimated effort is set and amended only by the Department Head or System Admin, with a mandatory reason on amendment. The holder may raise a revision request, which is a notification, not a write.
4. Deactivating an activity does not delete its generated Task history, and does not cancel already-generated open Tasks.
5. A Desk Card cannot be deleted. Cards for roles that no longer exist are Retired, which stops generation and preserves history.
6. Every activity must reference exactly one Process (§6). An activity without a Process cannot be Approved.
7. Transferring a Desk Card to a new holder transfers future generation only. Open Tasks already generated are handled by the existing reassignment and exit-checklist rules (BRS §15.7, TM-FR-025 to TM-FR-027) and are not silently moved.

### Representative user story

> As a Department Head, I want each role in my department to have an approved desk card listing every standing obligation with its frequency and expected effort, so that when a person moves or leaves I can hand over a defined role rather than reconstruct it from their inbox.

### Sample acceptance criteria

- **Given** a Desk Card in Draft with three activities, **when** the Department Head approves it, **then** the card becomes Approved, the holder is notified to acknowledge, and recurring activities begin generating Task instances from their next scheduled date.
- **Given** an Approved Desk Card, **when** the holder attempts to change an activity's estimated effort, **then** the action is refused and the holder is offered a revision request to the Department Head instead.
- **Given** a Desk Card with an existing holder, **when** the card is transferred to a new holder, **then** the outgoing holder appears in holder history with the transfer date, actor and reason, and future generated Tasks are assigned to the incoming holder.

**Detailed requirement rows:** Appendix A-2, TM-FR-072 to TM-FR-079.

---

## 5. Module 15.23 — Workflow and Standard Operating Procedure

### Narrative

A Workflow is the documented procedure for performing a Desk Card Activity: an ordered set of Steps, each with a title, rich instructional content, optional embedded screenshots or attachments, and an optional expected duration. A Workflow renders both as a step list and as a flowchart. Workflows are versioned and approved; only an Approved version is presented to a performer.

Where a Task is generated from an Activity that has an Approved Workflow, the Task **pins the workflow version in force at generation time**. The performer sees the procedure they were actually expected to follow, and an auditor reviewing the Task two years later sees the same thing, regardless of how many times the procedure has since been revised.

### Key business rules

1. A Workflow belongs to exactly one Desk Card Activity. Shared procedure is handled by reference between workflows, not by attaching one workflow to many activities — this keeps version pinning unambiguous.
2. Workflows are versioned. Editing an Approved workflow creates a new Draft version; the Approved version remains in force until the new version is approved.
3. A Task generated from an activity with an Approved workflow records `workflowVersionId` at generation. That reference is immutable for the life of the Task.
4. Superseded workflow versions are never deleted; they are retained per SIHL's records-retention policy for a listed entity (BRS §22).
5. A Workflow carries a review frequency. A workflow past its review date is flagged **Stale**, remains in force, and surfaces in process coverage reporting and on generated manuals.
6. Workflow approval is subject to maker-checker: the approver must be a different person from the last editor (§7).
7. Activities of Task Type Critical or Compliance-sourced cannot be Approved without an Approved Workflow. All other activities may be approved without one, and are reported as uncovered rather than blocked.

### Representative user story

> As a Compliance Officer, I want the exact procedure I was expected to follow to be attached to the task I performed, frozen at the version in force that day, so that a later audit reviews my work against the standard that actually applied.

### Sample acceptance criteria

- **Given** an Activity with Approved workflow version 3, **when** a Task instance is generated, **then** the Task records version 3 and continues to display version 3 even after version 4 is approved.
- **Given** an Approved workflow, **when** a user edits it, **then** a new Draft version is created and the Approved version remains the one presented to performers until the Draft is approved.
- **Given** a workflow whose review date has passed, **when** any operations manual containing it is generated, **then** the manual flags it as stale on the cover page and at the step group.

**Detailed requirement rows:** Appendix A-2, TM-FR-080 to TM-FR-086.

---

## 6. Module 15.24 — Process

### Narrative

A Process is a control grouping of Desk Card Activities that together achieve a control objective — for example "Client payout", "Demat reconciliation", "Regulatory filing". A Process has an owner, a stated control objective, a parent Policy, and a review frequency.

The purpose of the Process layer is **coverage assurance**: the ability to state, for any control, that every constituent activity is assigned to a live holder, has an approved and in-date procedure, and is being executed. The primary output is therefore not a hierarchy view but an exception report.

### Key business rules

1. A Process has exactly one Process Owner, who is an Employee. Owner changes are audited and notify both parties.
2. A Process must map to exactly one Policy to be Approved. A Process with no Policy is reported as unauthorised (§9.3 note on terminology: this means *not linked to an authorising policy*, not *forbidden*).
3. A Process cannot be deleted while activities reference it; it is Retired instead.
4. **Process coverage** is computed continuously and exposes, per process: activities with no holder, activities with no approved workflow, activities with a stale workflow, activities inactive but not retired, and activities overdue beyond their SLA in the current period.
5. A Process whose coverage falls below a configurable threshold raises a notification to the Process Owner and the Department Head. It does not block execution.

### Representative user story

> As a Compliance Officer preparing for an internal audit, I want a single view per process showing every activity in it and whether each is owned, documented and current, so that I can find the gap before the auditor does.

### Sample acceptance criteria

- **Given** a Process with eight activities of which one has no approved workflow, **when** the coverage report is opened, **then** the process shows 7 of 8 covered and names the uncovered activity.
- **Given** an activity is the last one referencing a Process, **when** a user attempts to delete that Process, **then** deletion is refused and Retire is offered.

**Detailed requirement rows:** Appendix A-2, TM-FR-087 to TM-FR-091.

---

## 7. Module 15.25 — Policy

### Narrative

A Policy is an approved statement of the standards under which a set of Processes operate. It carries an owner, an approving authority, a version, an effective date, a review frequency, and its document body or a reference to it. Policies authorise Processes; Processes group Activities; Activities generate Tasks. That chain is what allows a specific clerical act performed on a specific day to be traced upward to the policy that required it.

Policy review is scheduled, not remembered. A Policy approaching its review date generates a review Task for the Policy Owner, which — once the calendar layer lands (BRS Addendum roadmap, §10) — blocks time in the reviewer's calendar.

### Key business rules

1. A Policy has exactly one Owner and one named Approver. The Approver's explicit sign-off is the only action that moves a Policy version to Approved — consistent with the DACI rule in BRS §15.10.
2. Policies are versioned with an effective date. A new version does not take effect before its effective date, and the prior version remains in force until then.
3. Policy review generates a Task on the Owner at the configured lead time before the review date. A Policy past its review date without a completed review is flagged **Overdue for review** and reported to Compliance.
4. A Policy cannot be deleted. It is Superseded (by a named successor version) or Withdrawn (with a mandatory reason and Approver sign-off).
5. Withdrawing a Policy that still has Processes mapped to it requires those Processes to be remapped or explicitly waived first, with the waiver logged.
6. Policy documents are stored as attachments or references; workPulse does not become the authoring tool for policy text unless decision F2-07 says otherwise.

### Representative user story

> As the Compliance Head, I want each policy to review itself on a schedule and to tell me which operational processes depend on it, so that a policy change propagates to the procedures it governs instead of sitting unread.

### Sample acceptance criteria

- **Given** a Policy with an annual review cycle and a 20-working-day lead time, **when** the scheduler runs 20 working days before the review date, **then** a review Task is generated and assigned to the Policy Owner.
- **Given** a Policy version awaiting approval, **when** any user other than the named Approver attempts to mark it Approved, **then** the action is refused and logged.
- **Given** a Policy with three mapped Processes, **when** withdrawal is attempted, **then** the system lists the three Processes and blocks withdrawal until each is remapped or waived.

**Detailed requirement rows:** Appendix A-2, TM-FR-092 to TM-FR-098.

---

## 8. Module 15.26 — Operations Manual

### Narrative

An Operations Manual is a **generated** document consolidating, for a defined scope — a department, a process, or a policy and everything beneath it — the governing policies, the constituent processes, the desk card activities within them, and the approved workflows for those activities. It is produced on demand or on a schedule, rendered to PDF, versioned, and retained.

It is never authored or hand-edited. Its authority comes from being a faithful projection of the live model at a point in time, and it states its own coverage and staleness so a reader can judge how far to trust it.

### Key business rules

1. Manual content is derived exclusively from the live model. There is no manual-only content and no post-generation editing.
2. Every generated manual records: generation timestamp, generating user, scope definition, and the version identifiers of every Policy and Workflow included.
3. The cover page states coverage — the proportion of in-scope activities with an approved workflow — and staleness — the count of included workflows past their review date.
4. Generated manuals are immutable and retained. Regenerating produces a new version; it does not replace the prior one.
5. Manual generation respects the reader's permissions: a manual generated by a user excludes any process or activity that user cannot otherwise see, and states that it was scope-limited.

### Representative user story

> As a Department Head asked by an auditor for the operating procedures of my department, I want to generate a current manual in one action and be able to state exactly when it was produced and how complete it is.

### Sample acceptance criteria

- **Given** a department with 40 in-scope activities of which 34 have approved workflows, **when** a manual is generated, **then** the cover page states 85% coverage and the six uncovered activities are listed.
- **Given** a manual generated on 1 October, **when** a workflow it contains is revised on 5 October, **then** the 1 October manual is unchanged and a regeneration is required to reflect the revision.

**Detailed requirement rows:** Appendix A-2, TM-FR-099 to TM-FR-103.

---

## 9. Module 15.27 — Maker-Checker and Segregation of Duties

### Narrative

Maker-checker is a four-eyes control: the person who performs an action is not the person who confirms it. It is the vocabulary SIHL's auditors, Compliance function and board audit committee already use, and the platform should use it too.

**Maker-checker is not a new lifecycle state.** BRS §14.1 already provides Verification — a reviewer confirming that completed work meets the requirement — and BRS §15.14 provides Approval as a separate governance sign-off. Maker-checker is specified here as **Verification carried out under an enforced segregation-of-duties constraint**, plus the vocabulary to describe it. Introducing a third sign-off concept would be exactly the unnecessary complexity BRS §4.2 rejects.

What this addendum adds is therefore narrow and precise: the constraint, its configuration, and its enforcement.

### Key business rules

1. An Activity or Task Type may be marked **Maker-Checker required**. Where it is, the Task requires Verification and the constraint below applies.
2. The checker must not be the maker. A user may never verify their own work, under any role, including System Admin. This rule has no override.
3. The checker must hold the Checker capability for that Activity, configured on the Desk Card Activity as a named employee, a role, or a position in the holder's management chain.
4. Where no eligible checker is available, the Task routes to the Department Head's queue for check rather than auto-verifying or silently waiting.
5. Every maker-checker event records maker, checker, timestamp and outcome as an audit entry, and rejection requires a reason.
6. Whether a checker may be the maker's direct manager is a configuration decision, not a hard rule — see F2-05. The same-person prohibition in rule 2 is absolute regardless.

### Representative user story

> As the Compliance Head, I want critical back-office activities to require a second pair of eyes from someone other than the person who did the work, so that our internal control statement is enforced by the system rather than by convention.

### Sample acceptance criteria

- **Given** a Task on a maker-checker activity completed by employee A, **when** employee A attempts to verify it, **then** the action is refused and the refusal is audited.
- **Given** a maker-checker task with no eligible checker available, **when** it reaches Pending Review, **then** it is routed to the Department Head's check queue and is not auto-closed.

**Detailed requirement rows:** Appendix A-2, TM-FR-104 to TM-FR-108.

---

## 10. Amendments to existing BRS sections

### 10.1 §16 Data Model — new entities

| Entity | Key relationships | Notes |
|---|---|---|
| Desk Card | 1 Department; 0..1 current holder Employee; 1..n holder history entries; 0..n Desk Card Activities | New. Survives holder change; never deleted, only Retired. |
| Desk Card Activity | 1 Desk Card; 1 Process; 0..1 Workflow; 0..1 Recurrence configuration; generates 0..n Tasks | New. Replaces free-standing Recurring Task Template (§3.3). |
| Workflow | 1 Desk Card Activity; 1..n Workflow Versions | New. |
| Workflow Version | 1 Workflow; 1..n Workflow Steps; referenced by 0..n Tasks | New. Immutable once Approved. |
| Workflow Step | 1 Workflow Version; ordered; 0..n attachments | New. Rich content stored as structured JSON, not HTML, so steps stay queryable and diffable. |
| Process | 1 Policy; 1 Process Owner Employee; 0..n Desk Card Activities | New. |
| Policy | 1 Owner Employee; 1 Approver Employee; 1..n Policy Versions; 0..n Processes | New. |
| Policy Version | 1 Policy; effective date; approval record | New. |
| Operations Manual | Generated; references Policy Versions and Workflow Versions by id | New. Immutable once generated. |

Amendment to the existing **Task** entity: add optional `deskCardActivityId` and optional `workflowVersionId`. Both nullable — a Task with neither is normal (§3.2a).

### 10.2 §17 Master Data — additions

| Master | Source of truth |
|---|---|
| Desk Card, Desk Card Activity | New in workPulse |
| Workflow, Workflow Version, Workflow Step | New in workPulse |
| Process, Process Category | New in workPulse |
| Policy, Policy Category | New in workPulse — **subject to F2-07**, if an authoritative SIHL policy register already exists, workPulse references it rather than duplicating |
| Checker Rule | New in workPulse |

### 10.3 §18 Security — additions

- **Process Owner** is added as a workPulse role. It confers read and edit rights over the owned Process and read rights over the desk card activities within it, independent of department. It does not confer task-level visibility beyond what the holder's own role permits.
- **Policy visibility** defaults to organisation-wide read for Approved policies, since a policy nobody can read cannot govern behaviour. Draft and Withdrawn versions are visible to the Owner, the Approver, Compliance and the Audit role only.
- **Confidential activities.** A Desk Card Activity may be marked Confidential under the same rules as a Confidential Task (BRS §18.1). A Confidential activity is excluded from generated manuals for all readers except the Audit role, and its exclusion is stated on the manual rather than hidden.
- The **Audit role** reads all desk cards, workflows, processes, policies and manuals without exception, consistent with BRS §18.1.

### 10.4 §19 Audit Trail — additions

Audited events added: desk card created, approved, retired, holder transferred, acknowledged; activity created, approved, deactivated, estimated-effort changed (reason mandatory), process reassigned; workflow version created, approved, superseded; process owner changed; policy version approved, superseded, withdrawn (reason mandatory), process mapping changed or waived; manual generated; maker-checker performed, rejected (reason mandatory), or refused for same-person violation.

The workflow version pinned to a Task (§5, rule 3) is itself audit evidence and is immutable for the life of the Task.

### 10.5 §24 Roadmap — proposed amendment

The BRS phasing predates both the departure from Frappe and this addendum. §3.3 establishes that Desk Card Activity subsumes Recurring Task Template, which means **this layer cannot cleanly follow the recurrence engine — it must accompany or precede it.**

Proposed sequence, replacing BRS §24 for the affected modules:

| Slice | Content | Rationale |
|---|---|---|
| **1** | Desk Card, Desk Card Activity, Task lifecycle, recurrence generation from activities | The recurrence engine is built once, in its final shape. |
| **2** | Calendar and capacity, driven by activity estimated minutes | Estimates defined in slice 1 become useful here. |
| **3** | Workflow and SOP authoring, version pinning, flowchart view | Requires activities to exist; produces the evidence trail. |
| **4** | Process, Policy, coverage reporting, review scheduling, Operations Manual generation, Maker-Checker | The control and assurance layer. Maker-checker lands here because it depends on activity-level checker configuration. |

Maker-checker (§9) is the one item that could be pulled earlier into slice 1 if Compliance wants the control in place before the wider layer lands. It has no dependency on Process or Policy.

---

## 11. Phasing within this addendum

**This addendum specifies more than the four weeks estimated in the accompanying build plan.** Forty-one requirements is closer to six or seven weeks of build at the pace the rest of the plan assumes. Rather than revise the estimate upward and defer the whole layer, the requirements below are split so that a defensible subset can ship in the original window.

**Addendum-MVP** — the subset that makes the layer real and demonstrable:

> TM-FR-072 to TM-FR-079 (desk card in full), TM-FR-080 to TM-FR-084 (workflow authoring, versioning, pinning), TM-FR-087 to TM-FR-089 (process and basic coverage), TM-FR-092 to TM-FR-095 (policy, versioning, approval, review scheduling), TM-FR-099 to TM-FR-101 (manual generation with coverage statement), TM-FR-104 to TM-FR-106 (maker-checker core).

That is 27 requirements and covers every concept end to end. The remaining 14 — flowchart rendering, advanced coverage analytics, policy waiver workflow, scheduled manual generation, checker-rule sophistication, and the related amendments in §12 — are deferrable without leaving a conceptual hole.

**Recommendation:** approve the full addendum as specification, build the Addendum-MVP subset in the Phase 3 window, and schedule the balance against real usage feedback rather than up front.

---

## 12. Appendix A-2 — Functional requirements

Format follows BRS Appendix A, with the *Frappe Capability* and *Custom Development* columns replaced by a single **Build note** (see §2, Appendix E void).

### A.22 Desk Card

| ID | Requirement | Role | Business rule | Priority | Acceptance criteria | Build note |
|---|---|---|---|---|---|---|
| TM-FR-072 | System shall allow a Desk Card to be created for a role within a department. | Dept Head / Admin | A card has one holder at a time and cannot be deleted, only Retired. | High | Given a new card is saved, then it is created in Draft with no generation active. | New aggregate root |
| TM-FR-073 | System shall allow activities to be added to a Desk Card with frequency, estimated effort, priority, task type and owning process. | Dept Head | An activity without a Process cannot be Approved. | High | Given an activity with no process, when approval is attempted, then it is blocked naming the missing process. | Core model |
| TM-FR-074 | System shall route a Desk Card through Draft → Pending Review → Approved. | Dept Head | Only an Approved card with a holder generates Tasks. | High | Given a Draft card, when the scheduler runs, then no instances are generated. | State machine |
| TM-FR-075 | System shall generate Task instances from recurring Desk Card Activities on a holiday-aware schedule. | System | Uses the single platform recurrence engine; no second generator. | High | Given a daily activity, when the scheduler runs on a working day, then one Task is created linked to the activity. | Supersedes TM-FR-001 source object |
| TM-FR-076 | System shall restrict amendment of estimated effort to Department Head or System Admin, with a mandatory reason. | Dept Head | The holder may request a revision but not apply one. | High | Given a holder edits estimated effort, then the action is refused and a revision request is offered. | Anti-gaming, extends §15.18 |
| TM-FR-077 | System shall transfer a Desk Card to a new holder in one action, preserving holder history. | Dept Head / HR | Transfer affects future generation only; open Tasks follow §15.7 rules. | High | Given a transfer, then the outgoing holder, date, actor and reason appear in history and cannot be edited. | Handover feature |
| TM-FR-078 | System shall record the holder's acknowledgement of their Desk Card. | Employee | Acknowledgement is recorded but does not gate generation. | Medium | Given a card is approved, then the holder is notified and their acknowledgement is timestamped when given. | — |
| TM-FR-079 | System shall allow an activity to be deactivated without affecting historical or already-generated Tasks. | Dept Head | Deactivation stops future generation only. | Medium | Given an activity is deactivated with two open Tasks, then both remain open and no new instances generate. | — |

### A.23 Workflow and SOP

| ID | Requirement | Role | Business rule | Priority | Acceptance criteria | Build note |
|---|---|---|---|---|---|---|
| TM-FR-080 | System shall allow an ordered, step-by-step Workflow to be authored against a Desk Card Activity, with rich content and embedded attachments per step. | Dept Head / Process Owner | A Workflow belongs to exactly one Activity. | High | Given a workflow with five steps, when opened by a performer, then steps display in order with their content and attachments. | Structured JSON content |
| TM-FR-081 | System shall require an Approved Workflow before approving an Activity of Critical or Compliance-sourced task type. | System | Other activity types may be approved uncovered and are reported, not blocked. | High | Given a Critical activity with no approved workflow, when approval is attempted, then it is blocked. | Adoption-aware gate |
| TM-FR-082 | System shall version Workflows, with editing an Approved version creating a new Draft. | Process Owner | The Approved version stays in force until the new version is approved. | High | Given an approved v3 is edited, then v4 is created as Draft and performers continue to see v3. | Versioning |
| TM-FR-083 | System shall pin the Workflow version in force at generation onto every generated Task, immutably. | System | The pinned reference cannot change for the life of the Task. | High | Given a Task pinned to v3, when v4 is approved, then the Task still displays v3. | Evidence integrity — critical |
| TM-FR-084 | System shall flag a Workflow past its review date as Stale without withdrawing it from use. | System | Stale workflows remain in force and surface in coverage reporting and manuals. | High | Given a workflow past review date, when coverage is computed, then it counts as stale but still approved. | — |
| TM-FR-085 | System shall render a Workflow as a graphical flowchart consistent with its step list. | All roles | Flowchart and step list read from the same data; no separate store. | Medium | Given a step is reordered in the list, when the flowchart is opened, then the change is reflected. | Deferrable past Addendum-MVP |
| TM-FR-086 | System shall retain superseded Workflow versions indefinitely per records-retention policy. | System | No role, including System Admin, may delete a superseded version. | Medium | Given a superseded version, when deletion is attempted, then it is refused. | Retention |

### A.24 Process

| ID | Requirement | Role | Business rule | Priority | Acceptance criteria | Build note |
|---|---|---|---|---|---|---|
| TM-FR-087 | System shall allow a Process to be created with an owner, control objective, parent Policy and review frequency. | Compliance / Admin | A Process must map to exactly one Policy to be Approved. | High | Given a Process with no Policy, when approval is attempted, then it is blocked. | — |
| TM-FR-088 | System shall link every Desk Card Activity to exactly one Process. | Dept Head | Enforced at activity approval. | High | Given an activity is approved, then its Process is set and displayed on the process view. | — |
| TM-FR-089 | System shall compute and display process coverage: activities unowned, undocumented, stale, or inactive. | Process Owner / Compliance | Coverage is reported, never enforced as a block. | High | Given 8 activities of which 1 lacks an approved workflow, then coverage reads 7 of 8 and names the exception. | Core assurance output |
| TM-FR-090 | System shall report orphaned objects: activities with no process, processes with no policy, policies with no process. | Compliance | Orphan reporting ships in the same slice as the mapping it checks. | Medium | Given a process with no policy, when the orphan report runs, then it is listed. | Anti-decay control |
| TM-FR-091 | System shall notify the Process Owner and Department Head when coverage falls below a configured threshold. | System | Notification only; no execution block. | Medium | Given coverage drops below 80%, when the job runs, then both parties are notified once per period. | Deferrable |

### A.25 Policy

| ID | Requirement | Role | Business rule | Priority | Acceptance criteria | Build note |
|---|---|---|---|---|---|---|
| TM-FR-092 | System shall allow a Policy to be created with owner, named approver, version, effective date and review frequency. | Compliance | One owner and one named approver per policy. | High | Given required fields, when saved, then the policy is created in Draft. | — |
| TM-FR-093 | System shall require the named Approver's explicit sign-off to move a Policy version to Approved. | Approver | No other user, including System Admin, may approve. | High | Given a non-approver attempts approval, then the action is refused and logged. | Mirrors DACI rule §15.10 |
| TM-FR-094 | System shall version Policies with effective dating, keeping the prior version in force until the new effective date. | System | A future-dated version does not take effect early. | High | Given v2 effective 1 Nov, when viewed on 25 Oct, then v1 is shown as in force. | Effective dating |
| TM-FR-095 | System shall generate a review Task for the Policy Owner at a configured lead time before the review date. | System | Uses the platform recurrence engine. | High | Given a 20-working-day lead time, when the scheduler runs at T-20, then a review Task is created. | — |
| TM-FR-096 | System shall flag policies past their review date as Overdue for review and report them to Compliance. | System | Overdue policies remain in force. | Medium | Given a policy past review date, when the compliance report runs, then it is listed as overdue. | — |
| TM-FR-097 | System shall block withdrawal of a Policy with mapped Processes until each is remapped or explicitly waived with a logged reason. | Compliance | Waivers are audited. | Medium | Given three mapped processes, when withdrawal is attempted, then all three are listed and withdrawal is blocked. | Deferrable |
| TM-FR-098 | System shall display, from any Policy, the Processes and Activities it governs, and from any Task, the Policy that ultimately authorises it. | All roles | Traversal respects document-level permissions at every hop. | Medium | Given a Task from a desk card activity, when the governance trail is opened, then Activity → Process → Policy is shown. | The chain made visible |

### A.26 Operations Manual

| ID | Requirement | Role | Business rule | Priority | Acceptance criteria | Build note |
|---|---|---|---|---|---|---|
| TM-FR-099 | System shall generate an Operations Manual for a defined scope from live policy, process, activity and workflow data. | Dept Head / Compliance | Content is derived only; no manual-only content, no post-generation editing. | High | Given a department scope, when generated, then the manual contains that department's policies, processes, activities and approved workflows. | PDF render |
| TM-FR-100 | System shall state coverage and staleness on the manual cover page. | System | A manual must carry its own quality signal. | High | Given 34 of 40 activities documented, then the cover states 85% coverage and lists the six exceptions. | Anti-drift control |
| TM-FR-101 | System shall record generation timestamp, generating user, scope, and all included version identifiers on every manual. | System | Generated manuals are immutable; regeneration creates a new version. | High | Given a manual generated 1 Oct, when a workflow changes 5 Oct, then the 1 Oct manual is unchanged. | Immutability |
| TM-FR-102 | System shall exclude content the generating user cannot otherwise see, and state that the manual was scope-limited. | System | Exclusion is disclosed, never silent. | Medium | Given a user without access to one process, when generated, then that process is omitted and the omission is noted. | Permission-aware |
| TM-FR-103 | System shall support scheduled periodic manual generation per scope. | Compliance | Scheduled generation uses the platform job system. | Low | Given a quarterly schedule, when the quarter closes, then a manual is generated and the owner notified. | Deferrable |

### A.27 Maker-Checker and Segregation of Duties

| ID | Requirement | Role | Business rule | Priority | Acceptance criteria | Build note |
|---|---|---|---|---|---|---|
| TM-FR-104 | System shall allow an Activity or Task Type to be marked Maker-Checker required. | Dept Head / Compliance | Where set, the Task requires Verification under the SoD constraint. | High | Given a maker-checker activity, when a Task completes, then it enters Pending Review and cannot auto-close. | Config on activity |
| TM-FR-105 | System shall prevent any user from verifying work they performed, with no override for any role. | System | Absolute rule; applies to System Admin. | High | Given employee A completed the task, when A attempts to verify, then it is refused and the refusal is audited. | Hard constraint |
| TM-FR-106 | System shall record maker, checker, timestamp and outcome for every maker-checker event, with a mandatory reason on rejection. | System | Audit entries are append-only. | High | Given a check is rejected, then a reason is required and the entry appears on the task timeline. | Extends §19 |
| TM-FR-107 | System shall support checker eligibility defined as a named employee, a role, or a position in the holder's management chain. | Dept Head | Configured per activity. | Medium | Given checker rule = "Compliance Head", when a task needs checking, then only that holder may check. | Deferrable |
| TM-FR-108 | System shall route a maker-checker task with no eligible checker to the Department Head's check queue. | System | Never auto-verify and never silently wait. | Medium | Given no eligible checker, when the task reaches Pending Review, then it appears in the Dept Head's queue. | Deferrable |

### A.28 Related amendments

These arise from the same competitive review but sit outside the desk card and policy layer. Recorded here so they are not lost; each amends an existing BRS module.

| ID | Requirement | Role | Business rule | Priority | Acceptance criteria | Build note |
|---|---|---|---|---|---|---|
| TM-FR-109 | System shall require the immediate supervisor's approval where an assignment bypasses a level of the organisational hierarchy. | Manager | Bypass is permitted but never silent. | Medium | Given a manager assigns two levels down, when saved, then the intermediate manager's approval is requested and the assignment is pending until given. | Amends §15.6 |
| TM-FR-110 | System shall issue a per-employee monthly report card summarising completed, pending, overdue and on-time task performance. | Employee / Manager | Identical figures are shown to the employee and their manager; never hidden from the subject. | Medium | Given a month closes, then each employee receives a report card matching what their manager sees. | Amends §15.17 |
| TM-FR-111 | System shall issue a daily overdue digest to each employee with open overdue items. | Employee | Subject to the per-user digest preferences in §15.12. | Medium | Given three overdue tasks, when the daily job runs, then one digest listing all three is sent. | Amends §15.12 |
| TM-FR-112 | System shall present a performer with the pinned Workflow alongside the Task, as the working view rather than a linked document. | Employee | The procedure is shown where the work happens. | Medium | Given a Task with a pinned workflow, when opened, then the steps are displayed inline with completion tracking per step. | Amends §15.13 |

---

## 13. Appendix F-2 — Decisions required

Each carries a recommended default so the specification does not stall. A confirmed SIHL decision supersedes the default.

| Ref | Question | Why it matters | Recommended default | Decision from |
|---|---|---|---|---|
| **F2-01** | Does a Desk Card attach to a role that outlives its holder, or directly to an employee? | Determines whether handover is a one-action transfer or a rebuild. Also determines what happens on exit. | Card attaches to a named role with a current holder and full holder history. | CTO / HR |
| **F2-02** | Who approves a Desk Card, and does the holder's acknowledgement gate anything? | Sets where the authority for defining a role's obligations sits. | Department Head approves; holder acknowledgement is recorded but does not gate generation. | HR / Dept Heads |
| **F2-03** | Must every activity have an approved Workflow before it can generate tasks? | A hard gate guarantees documentation but will stall adoption across hundreds of activities. | Mandatory for Critical and Compliance-sourced activities only; others reported as uncovered, not blocked. | Compliance / Dept Heads |
| **F2-04** | What is the default policy review frequency, and who is the approving authority by policy category? | Determines review workload and whether the review cycle is credible. | Annual review default; approving authority by category, to be tabled by Compliance. | Compliance / Board |
| **F2-05** | May a checker be the maker's direct manager? | A strict independence rule is unworkable in small teams; a loose one weakens the control. | Yes, the direct manager may check. The same-person prohibition remains absolute. | Compliance |
| **F2-06** | Is a generated Operations Manual a controlled document requiring formal approval before circulation? | Determines whether generation is self-service or a governed release. | Self-service generation for internal use; formal approval required only for manuals circulated externally or to auditors. | Compliance |
| **F2-07** | Does SIHL already hold an authoritative policy register elsewhere? | Building a second policy master would be exactly the duplication BRS §29 identifies as the top data-quality risk. | Confirm before building. If one exists, workPulse references it and models only the process-to-policy mapping. | Compliance / CTO |

---

## 14. Sign-off

This addendum is **not approved** and no build should proceed against it until the following have signed.

| Role | Name | Purpose of sign-off | Date |
|---|---|---|---|
| Compliance Head | | Policy, process, maker-checker and manual requirements; F2-03 to F2-07 | |
| CTO | | Data model, recurrence-engine reconciliation (§3.3), roadmap amendment (§10.5); F2-01 | |
| HR Head | | Desk card / KRA boundary (§3.4); F2-01, F2-02 | |
| Product & AI Office | | Specification ownership | |

**Note on sequencing.** §3.3 establishes that Desk Card Activity subsumes the Recurring Task Template specified in BRS §13.A. Because the recurrence engine has not yet been built, approving this addendum **before Phase 1 begins** avoids building that engine twice. If sign-off is likely to extend beyond the start of Phase 1, the recurrence engine should be deferred within Phase 1 rather than built against the superseded model.

---

*Extends the SIHL WMP Business Requirement Specification v1.0 (18 August 2026) and its UI wireframe set. Requirement identifiers TM-FR-001 to TM-FR-071 refer to BRS Appendix A; TM-FR-072 onward are introduced here. Capability observations about the 9to5 platform derive from its published features deck only; absence from that deck is treated as not-shown rather than as evidence of absence.*
