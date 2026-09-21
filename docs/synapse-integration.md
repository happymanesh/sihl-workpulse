# Synapse integration — identity, app registration, and role mapping

**Decision, 7 September 2026:** Keycloak is dropped. **Synapse is workPulse's identity provider**, and workPulse appears as an entry in Synapse's Apps navbar. workPulse never authenticates anyone itself and never stores a password or a password hash.

---

## 1. What Synapse already provides

Established by reading `C:\Projects\Synapse` — these are facts about the current implementation, not assumptions.

| Capability | Where | Notes |
|---|---|---|
| App registry | `AppMaster` | `appCode` (PK), `appName`, `companyCode`, `icon`, `appLogoUrl`, `displayOrder`, `isActive`. This is the Apps navbar. |
| Per-app menus | `MenuMaster.appCode` | `menuType` is `ROUTE \| REPORT \| EXTERNAL`, with `externalUrl` for the last. A NULL `appCode` means the menu is global across all apps. |
| Permissions | `RoleMenuMap` → `RoleMaster` → `UserRoleMap` | Menu-level access by role, scoped by company and hierarchy. |
| Users | `UserDetails` | `uid`, `username` (unique), `fullName`, `email`, `companyCode`, `hierarchyCode`, `isActive`, `lastAppCode`. |
| Session | `src/lib/session.ts` | HS256 JWT via `jose`, `synapse_session` httpOnly cookie, 8h, signed with `SESSION_SECRET`. |
| Session payload | `SessionPayload` | `userUid`, `username`, `fullName`, `companyCode`, `hierarchyCode`, `hierarchyName`, `roles[]`. |
| Live revocation | `getSession()` | Re-checks `UserDetails.isActive` on **every** call, memoised per request. Deactivation takes effect immediately, not at token expiry. |
| App persistence | `UserDetails.lastAppCode` | Last opened app reopens on next login. |

The seam we need already exists. `AppMaster` + `MenuMaster.appCode` is precisely an app-suite registry.

---

## 2. The architectural question

"Part of Synapse" admits two readings, and they are very different builds.

### Option A — merge workPulse into the Synapse codebase

workPulse screens become routes in Synapse's Next.js app, using Synapse's Prisma client and `getSession()` directly.

- **For:** one session, one deployment, one user administration surface, zero integration code.
- **Against:** Synapse is a single Next.js app with **no background job runner**. workPulse needs BullMQ for recurrence generation, SLA evaluation, escalation, digests and analytics rollups. Synapse's database also carries `sample_sales`, an unmanaged table that forbids `prisma migrate dev` — every workPulse schema change would become hand-written SQL. And it discards the NestJS API tier, whose DI is what makes audit-on-every-mutation structurally enforceable. Blast radius: a workPulse defect takes Synapse down with it.

### Option B — separate app, federated identity (recommended)

workPulse stays its own deployable (Next 16 + NestJS + its own Postgres), registered in `AppMaster`, reached from the Apps navbar, trusting Synapse for identity.

- **For:** keeps the job runner, keeps migration freedom, keeps the audit enforcement, isolates failure. Users still experience one suite: one login, one navbar, one place roles are administered.
- **Against:** requires the session-sharing mechanism in §3 — perhaps 2–3 days of work.

**Recommendation: Option B.** It satisfies both of the stated requirements — workPulse appears in the Apps navbar, and Synapse owns the users — without absorbing an application with materially different runtime needs into a codebase that cannot currently meet them.

> **Open decision S-01.** If SIHL wants literal single-codebase consolidation, that is Option A and it is a different plan: it needs a job-runner strategy for Synapse and a migration strategy around `sample_sales` before any workPulse code moves.

---

## 3. Session sharing (Option B)

Synapse's cookie is `httpOnly`, `sameSite: lax`, `path: /`. Two mechanisms, in order of preference:

### 3.1 Shared parent domain — preferred

Deploy both under one registrable domain:

```
synapse.sihl.internal      → Synapse
workpulse.sihl.internal    → workPulse
```

Set the cookie `domain: .sihl.internal` in Synapse's `createSession()`, and workPulse reads and verifies `synapse_session` with the same `SESSION_SECRET`. No handoff, no redirect, no token exchange. Clicking the Apps entry is an ordinary link.

**Change required in Synapse:** add `domain` to the cookie options. One line, but it invalidates existing sessions on deploy — everyone re-logs in once.

### 3.2 Signed handoff — fallback if the domains cannot be aligned

Synapse mints a short-lived (60s), single-use handoff JWT; workPulse exchanges it for its own session cookie on the same secret. More moving parts and a replay surface to defend, so only if §3.1 is impossible.

### 3.3 Rules that hold either way

- workPulse **verifies** the JWT; it never decodes it unverified.
- workPulse re-checks `UserDetails.isActive` against Synapse on session establishment, mirroring `getSession()`. A JWT staying valid for 8 hours after deactivation is not acceptable for a BFSI control environment.
- `SESSION_SECRET` is shared between the two apps and rotated together.
- No workPulse route is reachable without a verified Synapse session. The existing fail-closed posture is unchanged — only the verifier changes.

---

## 4. Identity and role mapping

### 4.1 The join chain

```
Synapse UserDetails  →  workPulse User  →  Frappe HR Employee
   (authentication)      (authorisation)     (org master)
```

Synapse owns *who you are*. Frappe HR remains the sole master for *where you sit in the org* (BRS §4.2 — unchanged). workPulse holds only the join and its own role assignments.

The `User` model changes: `keycloakId` becomes `synapseUserUid` (Int, unique) plus `synapseUsername`. The link to `Employee` is resolved by **email**, since `UserDetails.email` and `Employee.email` are the only reliable common key. Where an email does not match, the user is flagged unlinked rather than silently given no desk card — a silent failure here looks identical to "no work assigned".

### 4.2 Role mapping

Synapse roles are dynamic rows in `RoleMaster`; workPulse roles are the fixed `WorkPulseRole` enum. These are mapped explicitly in a `SynapseRoleMap` table (`synapseRoleCode` → `WorkPulseRole`), administered in workPulse, **not** inferred from role names. Name-matching would silently break the moment someone renames a role in Synapse.

SIHL's actual roles, read from Synapse on 8 Sep 2026:

| Synapse role | Name | workPulse role |
|---|---|---|
| `ADMIN` | Super Admin | `SYSTEM_ADMIN` |
| `PRODUCT_OPS` | Product / Ops | `EMPLOYEE` |
| `SUPPORT_DESK` | Support Desk | `EMPLOYEE` |
| `SUPPORT_LEAD` | Support Lead | `MANAGER` |
| `CLIENT_SELF` | Client Self-Service | **none — deliberately unmapped** |

**A user whose Synapse roles map to nothing is denied access entirely.** There is no fallback role, and this is a security property, not an oversight: Synapse authenticates *external clients* as well as staff. `CLIENT_SELF` is held by real customers. An `EMPLOYEE` fallback — which an earlier draft of this document specified — would have silently issued a client a workPulse account and a desk card. Access to workPulse is an explicit grant in `SynapseRoleMap`, or a local role on a named user.

`AUDIT` is never mapped from a Synapse role. BRS Appendix F requires joint CTO + Compliance sign-off, so it is granted individually via `User.localRoles`.

### 4.3 Menu registration

One `AppMaster` row (`appCode: 'WORKPULSE'`), plus `MenuMaster` rows with `menuType: 'EXTERNAL'` and `externalUrl` pointing at the corresponding workPulse route. Access is then administered entirely through Synapse's existing `RoleMenuMap` screens — no second permissions UI.

**`EXTERNAL` is verified as implemented** (checked 8 Sep 2026), despite no rows currently using it — Synapse's live `menu_master` only contains `ROUTE` and `REPORT`. The handling exists in `components/app-shell/Sidebar.tsx` for both top-level and nested items, `TopBar.tsx`, the dashboard, the admin CRUD form and `lib/admin-schemas.ts`. It renders as `<a target="_blank" rel="noopener noreferrer">` and logs the selection to `menu_usage_log`.

One consequence to be aware of: **workPulse opens in a new browser tab.** That is correct for a separate deployable, but it does mean the transition is not seamless the way an in-app route is. If SIHL wants it to feel embedded, that is a change to Synapse's sidebar, not to workPulse.

Synapse's existing apps are `BROKING`, `BACKOFFICE` and `SUPPORT`; workPulse becomes the fourth.

Menu-level access in Synapse controls *what appears in the navbar*. It does **not** replace workPulse's own authorisation: row-level rules (confidential tasks, desk-card ownership, the Audit role) stay in workPulse's service layer, per BRS §18.

---

## 5. What this changes in the current code

| File | Change |
|---|---|
| `apps/api/src/modules/auth/keycloak-token.service.ts` | Replaced by `synapse-session.service.ts` — verify HS256 with `jose` against `SESSION_SECRET`, then re-check `isActive`. |
| `apps/api/src/modules/auth/keycloak-auth.guard.ts` | Renamed; reads the `synapse_session` cookie instead of a bearer header. |
| `apps/api/src/trpc/trpc.ts` | `createContext` populates the real user from the verified cookie — the Phase 0 `{ user: null }` stub is exactly this one place. |
| `packages/db/prisma/schema.prisma` | `User.keycloakId` → `synapseUserUid` + `synapseUsername`; add `SynapseRoleMap`. |
| `apps/api/package.json` | Drop `nest-keycloak-connect`; add `jose`. |
| `docker-compose.yml` | Drop the Keycloak service. |
| `.env.example` | Drop `KEYCLOAK_*`; add `SESSION_SECRET`, `SYNAPSE_DATABASE_URL`. |
| `docs/keycloak/` | Delete. |
| `apps/web` | No login route. Unauthenticated users are redirected to Synapse's login. |

**Nothing built in Phase 0 is wasted.** The guard structure, the fail-closed posture, `requireRoles()`, and the audit trail are all transport-agnostic — only the token verifier and the claim source change.

---

## 6. How workPulse reads Synapse's user data

Read-only, and never a second master — the same discipline already applied to Frappe HR.

Preferred: a **read-only Postgres role on Synapse's database**, exposed to workPulse as `SYNAPSE_DATABASE_URL`. Synapse already establishes this pattern with `DATABASE_URL_READONLY` and `prismaReadOnly`. workPulse reads `UserDetails` and `UserRoleMap`; it writes nothing, ever.

If the two databases must not be co-located, the fallback is a small authenticated read API on Synapse. That is a Synapse change and should be raised as such.

---

## 7. Open decisions

| Ref | Question | Recommended default | From |
|---|---|---|---|
| ~~**S-01**~~ | ~~Separate app or merged codebase?~~ | **DECIDED 7 Sep 2026 — separate deployable, Option B. Built.** | CTO |
| **S-02** | Can both apps share a parent domain? | Yes — it removes the whole handoff mechanism | CTO / Infra |
| **S-03** | Direct read-only DB access to Synapse, or a read API? | Read-only DB role, mirroring Synapse's own `prismaReadOnly` pattern | CTO |
| **S-04** | Who administers the Synapse-role → workPulse-role map? | System Admin in workPulse, audited | CTO / HR |
| **S-05** | Behaviour when a Synapse user has no matching Frappe HR employee | Flag as unlinked and surface to admin; never silently unassigned | HR / CTO |
