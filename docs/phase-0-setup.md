# Phase 0 setup guide

Follow these steps in order on a fresh checkout.

## Prerequisites

- Node.js 20+ (24 is what this has been built against)
- PostgreSQL 16 and a Redis-compatible server — either via Docker, or installed natively (see §2b)
- Access to a running **Synapse** instance, which is workPulse's identity provider
- Git

## 1. Install dependencies

```
npm install
```

Installs all four workspaces (`apps/web`, `apps/api`, `packages/db`, `packages/shared-types`) in one pass via npm workspaces.

## 2. Start local infrastructure

```
docker compose up -d
```

Brings up Postgres (5432), Redis (6379), MinIO (9000/9001) and Adminer (8081, a simple DB browser).

There is **no identity provider in the compose file**. Identity is federated to Synapse — see [`synapse-integration.md`](./synapse-integration.md). Keycloak was removed on 7 Sep 2026.

### 2b. Without Docker

Docker is not required. A native PostgreSQL 16 plus any Redis-compatible server works identically — on Windows, [Memurai](https://www.memurai.com/) is a drop-in Redis replacement that installs as a service. This is the arrangement the project was first brought up on.

Create the role and database once:

```sql
CREATE ROLE workpulse WITH LOGIN CREATEDB PASSWORD 'workpulse_dev_password';
CREATE DATABASE workpulse OWNER workpulse;
```

`CREATEDB` is required — Prisma's `migrate dev` creates a shadow database.

## 3. Configure environment

```
cp .env.example .env
```

Two values have no working default and must be set before anything authenticates:

| Variable | What it is |
|---|---|
| `SESSION_SECRET` | Must be **byte-identical** to Synapse's `SESSION_SECRET`. It is the HS256 key both apps sign and verify sessions with. |
| `SYNAPSE_DATABASE_URL` | A **read-only** Postgres role on Synapse's database. workPulse reads `user_details` and `user_role_map`; grant `SELECT` and nothing else. |

Leave `FRAPPE_SYNC_MODE=mock` until real SIHL Frappe HR credentials are available (step 6).

## 4. Set up the database

```
npm run db:generate
npm run db:migrate -w packages/db
```

The second command creates the first Prisma migration from `packages/db/prisma/schema.prisma` and applies it. It prompts for a name — `init` is fine.

## 5. Seed and sync

```
npm run db:seed
npm run sync:frappe-hr
```

The seed creates the **Synapse-role → workPulse-role mappings**. It deliberately creates no users: a workPulse `User` row is provisioned lazily on first successful sign-in, because Synapse owns identity and a local user table would be a second place to disable someone.

> The seeded role codes (`ADMIN`, `MANAGER`, …) are placeholders. Replace them with SIHL's real `RoleMaster.roleCode` values from Synapse, or every user will resolve to plain `EMPLOYEE`.

The sync pulls mock Employee/Department fixture data (7 employees, 5 departments) so the rest of the app has realistic data to build against.

## 6. Run the app

```
npm run dev
```

Starts `apps/api` (port 4000) and `apps/web` (port 3000) concurrently. Open http://localhost:3000 — the overview screen shows green status for database, Redis and the Synapse directory.

## 7. Verify

```
npm run typecheck
npm run lint
npm run test -w apps/api
```

All three should pass on a clean checkout.

---

## Known gaps to close before Phase 1 build starts

1. **Synapse read-only role and shared secret** — the code is complete, but until `SYNAPSE_DATABASE_URL` and `SESSION_SECRET` point at a real Synapse instance, the active-user check cannot run and every authenticated request is rejected. This is fail-closed by design, not a bug.
2. **Real Synapse role codes** — see step 5.
3. **Live Frappe HR client** (`apps/api/src/jobs/frappe-hr-client.ts`) — needs SIHL's Frappe instance URL and API key/secret, plus confirmation of the Employee/Department doctype field names against the real instance (they may be customised). `FRAPPE_SYNC_MODE=mock` keeps everything else buildable meanwhile.
4. **App registration in Synapse** — one `AppMaster` row plus `MenuMaster` rows pointing at workPulse routes, so it appears in the Apps navbar. See `synapse-integration.md` §4.3.

## Rotate before this goes anywhere near production

Every credential in `.env.example` is a local-dev placeholder. Rotate all of them via proper secrets management before staging or production — and note that `SESSION_SECRET` must be rotated in Synapse and workPulse **together**, or every session breaks.
