# workPulse — Deployment Guide

For whoever puts workPulse on a server. It follows the same shape as the Synapse UAT
deployment guide, because it is the same method on the same kind of host.

Read §9 before you start. Two of the traps there will cost you the deployment if you meet
them for the first time at 2pm.

---

## 1. What you are deploying

**Two Node processes and one PostgreSQL database**, plus a Redis instance.

| Layer | Choice |
|---|---|
| Framework | NestJS 10 (API) and Next.js 16 (web) in one npm-workspaces repo |
| Runtime | Node.js 20+ (developed on 24.15) |
| Package manager | **npm** — not pnpm |
| Database | PostgreSQL 16 |
| ORM | Prisma 5 |
| Queue | Redis 7 (BullMQ, drives the HR sync) |
| Identity | None of its own — Synapse owns it |

workPulse has **no login screen and no user table of its own**. It reads the
`synapse_session` cookie that Synapse already set, verifies it with the shared
`SESSION_SECRET`, and checks the user is still active by querying Synapse's database
directly on every request. A workPulse `User` row is created lazily on first successful
sign-in.

Two consequences that shape the whole deployment:

- **It must run on the same hostname as Synapse.** See §9.1. This is not a preference.
- **It must be able to reach Synapse's PostgreSQL** with a read-only role, on every
  request. Co-locating with Synapse makes that a local connection.

---

## 2. Environment variables

Set these on the host. `.env` is gitignored and deliberately absent from the repository.

### Required — the app will not start, or will reject every request, without these

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://workpulse:pass@localhost:5432/workpulse` | workPulse's own database. Read by the app, Prisma CLI and the seed. |
| `SYNAPSE_DATABASE_URL` | `postgresql://synapse_readonly:pass@localhost:5432/sihl_synapse` | Synapse's database, **read-only role** (§3.2). Without it every request is rejected, because the active-user check cannot run. |
| `SESSION_SECRET` | *(copy from Synapse)* | **Must be byte-identical to Synapse's.** It is how the session signature is verified. A mismatch means every user is rejected as unauthenticated, with no clue why. |
| `NODE_ENV` | `production` | Also controls the `secure` flag on Synapse's cookie — see §9.1. |

### Strongly recommended

| Variable | Example | Notes |
|---|---|---|
| `WEB_BASE_URL` | `https://<synapse-host>:3200` | The API's CORS origin. Defaults to `http://localhost:3000`, which is wrong on every real host — set it. |
| `API_BASE_URL` | `http://localhost:4000` | Where the web app proxies to. Localhost is correct when both run on one box. |
| `REDIS_URL` | `redis://localhost:6379` | Defaults to this. BullMQ fails to connect without a reachable Redis. |
| `ATTACHMENT_DIR` | `/var/lib/workpulse/attachments` | Where uploaded evidence is written. See §9.3 — this needs a real path and a backup. |
| `TRUST_PROXY` | `1` | Number of proxies in front. Set it **only** if there is a reverse proxy, otherwise callers can spoof their address. Off when unset. |
| `API_PORT` | `4000` | API listen port. |

### Optional

| Variable | Notes |
|---|---|
| `HR_SOURCE` | `synapse` (the default) or `frappe`. Leave it alone — see §9.5. |
| `FRAPPE_SYNC_CRON` | HR sync schedule. Defaults to every two hours. |
| `LOG_LEVEL` | Log verbosity. |

`S3_*` and `CHAT_HUB_*` appear in `.env.example` but are not required for this release —
attachments are on local disk and chat-hub is optional.

workPulse **sends no email**, so none of Synapse's SendGrid variables apply, and the
SendGrid IP-allowlist trap that blocked the Railway trial is not a concern here.

---

## 3. Deployment steps

### 3.1 One-time database setup

Create an empty PostgreSQL 16 database. Do not restore anything into it — the migrations
build the whole schema.

```sql
CREATE DATABASE workpulse;
CREATE ROLE workpulse LOGIN PASSWORD '<password>';
GRANT ALL PRIVILEGES ON DATABASE workpulse TO workpulse;
```

### 3.2 The read-only role on Synapse's database

workPulse reads Synapse's `user_details`, `user_role_map` and `hr_employee` tables. It must
never be able to write to them. Run this **against Synapse's database**:

```sql
CREATE ROLE synapse_readonly LOGIN PASSWORD '<password>';
GRANT CONNECT ON DATABASE sihl_synapse TO synapse_readonly;
GRANT USAGE ON SCHEMA public TO synapse_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO synapse_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO synapse_readonly;
```

This is the same pattern Synapse already uses for its report engine (`synapse_ro`).
Point `SYNAPSE_DATABASE_URL` at it.

### 3.3 Install and build

```bash
npm ci
npm run build
```

`npm run build` generates the Prisma client, then builds the API and the web app in order.

### 3.4 Apply the schema

```bash
npm run db:migrate:deploy
```

Applies the 15 committed migrations in order. **Run this as a separate release step, not
from `start`** — see §9.4. It first asserts it is pointed at the intended database and
refuses otherwise.

### 3.5 Seed reference data

```bash
npm run db:seed
```

Creates the 6 task types and the Synapse-role → workPulse-role mappings. It is idempotent
and safe to re-run — **but read §9.2 first**, because it is authoritative about role
mappings, not additive.

It deliberately does **not** create users, employees or departments. Users come from
Synapse on first sign-in; employees and departments come from the HR sync.

### 3.6 Load the employee directory

```bash
npm run sync:frappe-hr
```

Reads active staff from Synapse's `hr_employee` table into workPulse. Expect roughly 560
employees, about 200 of them active. The API also runs this on a schedule once it is up.

### 3.7 Start

Two processes. Run them under whatever supervisor the host already uses for Synapse
(systemd, pm2, Windows Service):

```bash
# API
node apps/api/dist/main.js            # listens on API_PORT, default 4000

# Web
npm run start -w apps/web             # listens on 3200
```

Only the **web** port needs to be reachable from staff browsers. The API should be
reachable from the web process only — bind it to localhost if the host allows it.

### 3.8 Point Synapse at it

The launcher entry already exists in Synapse but still points at a developer's machine.
Update it, or nobody will find workPulse:

```sql
UPDATE menu_master
   SET external_url = 'https://<synapse-host>:3200'
 WHERE menu_code = 'WorkPulse';
```

---

## 4. First login

Sign in to **Synapse** as normal, then pick **WorkPulse** from the app switcher. There is no
separate workPulse login.

Who can get in is decided by two gates, both of which must pass:

1. The user's Synapse role carries the `WorkPulse` menu entry at **their own hierarchy**.
2. That Synapse role maps to a workPulse role in `synapse_role_map`.

An unmapped role means no access and there is no fallback — that is deliberate, because
Synapse also authenticates external clients (`CLIENT_SELF`), and a default role would hand
one of them a desk card.

### The day-one users

| Login | Name | workPulse roles |
|---|---|---|
| `SIHL-709` | MANESH MUKHERJEE | SYSTEM_ADMIN, EMPLOYEE |
| `SIHL-251` | JINAL SHAH | DEPARTMENT_HEAD, EMPLOYEE |
| `SIHL-620` | KHUSHALI SHAH | PROJECT_MANAGER, EMPLOYEE |
| `SIHL-484` | RASHMI BORISA | EMPLOYEE — holds COMP-OFFICER |
| `SIHL-467` | FORAM GANDHI | EMPLOYEE — holds ACCOUNT-01 |
| `SIHL-479` | SAHIL CHUNARA | EMPLOYEE — holds ENG-DEV |
| `SIHL-2058` | APURVA SHAH | EMPLOYEE — holds OPS-PLATFORM |

Everyone must change their password at first login. Credentials are in
`C:\Projects\Synapse\provisioned-logins.txt` on the provisioning machine and are handed
over in person — several staff share a mailbox, so email is not safe for all of them.

---

## 5. Verification checklist

Work through this before telling anyone it is live.

1. **API answers.** `curl -s http://localhost:4000/health` returns 200.
2. **Security headers present.** `curl -sD - -o /dev/null http://localhost:4000/health`
   shows `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
   `Strict-Transport-Security`, `Referrer-Policy: no-referrer` and
   `Cross-Origin-Resource-Policy: cross-origin`.
3. **Health is never rate limited.** Thirty rapid calls to `/health` all return 200.
4. **The limiter works.** Twenty-five rapid `POST /speech/transcribe` calls return 401 up
   to twenty, then 429 with a `Retry-After` header.
5. **Synapse's database is reachable read-only.** Start the API and confirm there is no
   `SYNAPSE_DATABASE_URL is not set` warning and no permission error in the log.
6. **The directory loaded.** The Employees screen lists real staff, not fixtures.
7. **End to end.** Sign in to Synapse as `SIHL-484`, open WorkPulse from the app switcher,
   and confirm **My tasks** shows work and **My desk card** shows COMP-OFFICER. If this
   step shows "No valid Synapse session", go straight to §9.1.
8. **Roles resolve.** As `SIHL-709`, confirm the Administration section appears in the nav.

---

## 6. What is deliberately incomplete in this release

| Area | State |
|---|---|
| **Three Critical activities** | DRAFT, awaiting a second approver. Critical work cannot be approved without an approved written procedure, so these generate nothing until JINAL SHAH signs them off. That is the maker-checker control working, not a fault. |
| **SLA targets** | Only one definition exists. SLA tracking is effectively off until targets are configured. |
| **"Daily margin reporting"** | Paused. It generates no new work until somebody unpauses it. |
| **Demo data** | The GATEWAY-26 project, two seeded employees and about ten of their tasks are still present. Harmless but visible. |
| **Attachments on S3** | Not wired. Local disk only — see §9.3. |
| **Gantt / timeline, sprints** | Out of scope by decision. Sprints stay in the engineering team's own tool. |

---

## 7. Rolling forward

1. `git pull`
2. `npm ci`
3. `npm run build`
4. `npm run db:migrate:deploy`
5. `npm run db:seed` — only if role mappings or task types changed, and only after §9.2
6. Restart both processes

---

## 8. Rollback

The database is the hard part; the code is not.

1. Stop both processes.
2. Check out the previous commit, `npm ci`, `npm run build`, restart.
3. **Do not roll migrations back casually.** Prisma has no down-migrations here. If a
   migration must be undone, restore the database from backup instead — which means
   taking one before every deployment that migrates.

Rolling the code back without the database is usually safe; the schema is additive.

---

## 9. Traps — read before deploying

### 9.1 workPulse must share a hostname with Synapse

This is the one that will stop the deployment dead.

Synapse sets `synapse_session` with **no `Domain` attribute**, which makes it a host-only
cookie: the browser sends it back only to the exact host that set it. workPulse has no
login of its own and no token handoff — reading that cookie is the only way it knows who
you are.

So **workPulse must be served from the same hostname as Synapse.** A different port is
fine, because cookies ignore the port number. A different hostname is not.

- `https://sihl-apps:3010` (Synapse) and `https://sihl-apps:3200` (workPulse) — works.
- `https://synapse.sihl.com` and `https://workpulse.sihl.com` — **does not work** as
  things stand. It can be made to work by adding `domain: ".sihl.com"` to Synapse's
  `createSession`, but that is a Synapse change and needs its own testing.

This works on a developer machine because Synapse is `localhost:3010` and workPulse is
`localhost:3200` — same host, different port. That is an accident of localhost, not a
design that survives real hostnames.

**Also:** `secure: true` is set on the cookie whenever `NODE_ENV=production`, so the
browser will refuse to send it over plain HTTP. **TLS is not optional.** An internal
certificate is fine; no certificate is not.

### 9.2 The seed is authoritative about role mappings, not additive

`npm run db:seed` **deactivates any role mapping not listed in `ROLE_MAP`** in
`packages/db/prisma/seed.ts`.

A mapping an administrator adds through the Access screen and nobody adds to that list
will be silently switched off by the next seed, and everyone depending on it loses access
at their next sign-in. The symptom is people who worked yesterday being refused today,
with nothing in the release notes to explain it.

The list currently matches production. **If you add a mapping through the screen, add it
to `ROLE_MAP` too.**

### 9.3 Attachments are on local disk, so run one API instance

Evidence files are written to `ATTACHMENT_DIR`, not object storage. Two API instances would
each see only the files they wrote, and half of every evidence trail would appear missing.

Run **one** API process until storage moves to S3 or a shared volume. Back that directory
up with the database — the attachments are audit evidence, and a database backup without
them is incomplete.

### 9.4 Do not wire migrations into `start`

Synapse's `start` runs `db:deploy` first, which it documents as safe for a single
instance. Do not copy that here. Run `npm run db:migrate:deploy` as its own release step.
Both workPulse processes start independently, and two of them racing on the same migration
is a bad way to find out.

### 9.5 Leave `HR_SOURCE` alone

It defaults to `synapse`, which is the working path. Setting it to `frappe` with
`FRAPPE_SYNC_MODE=live` reaches a client that **throws on every call** — it was never
implemented, because the Frappe credentials never arrived. The fixtures behind
`FRAPPE_SYNC_MODE=mock` are fictional people and must never be loaded over real staff.

### 9.6 npm, not pnpm

Same as Synapse. pnpm has approve-builds problems on these machines.

### 9.7 Set `TRUST_PROXY` only if there is actually a proxy

Behind a reverse proxy, leaving it unset puts every unauthenticated caller in one
rate-limit bucket and makes the access log useless. Setting it when there is **no** proxy
is worse: callers can then claim any address they like through `X-Forwarded-For`.

### 9.8 On Windows, stop the services before rebuilding

`prisma generate` replaces `node_modules/.prisma/client/query_engine-windows.dll.node`.
Windows will not let it rename over a file another process has open, so a rebuild while
the API is running fails with:

    EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmp####'

Stop both workPulse processes first. Note the generated client is otherwise fine — only
the identical DLL swap fails — so a build that reports this has usually produced correct
output anyway, which makes it easy to misread as harmless. Linux hosts do not have this
problem.

### 9.9 Three dependency vulnerabilities remain

`multer` and `@nestjs/platform-express` (denial of service) and `lodash` (code injection)
are outstanding. All three need a NestJS major upgrade and were deliberately not attempted
before launch. The multer issue sits behind authentication and a 60/minute limit on the
attachment endpoint; the lodash issue is not reachable from this codebase. **Schedule the
upgrade** — do not let it become permanent.

---

## 10. Reference

| | |
|---|---|
| Repository | `C:\Projects\SIHL_workPulse` |
| Synapse integration | `docs/synapse-integration.md` |
| Synapse deployment | `C:\Projects\Synapse\docs\05-uat-deployment.md` |
| Tests | `npm test` (276 unit), `npm run test:e2e -w apps/api` (248 e2e) |
| CI | `.github/workflows/ci.yml` — lint, typecheck, both suites, build |
