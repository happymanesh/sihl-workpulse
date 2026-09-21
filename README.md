# SIHL workPulse

Enterprise Work Management Platform for Shah Investors Home Limited (SIHL) - task, project and team execution, MIS, and (in later phases) the CEO Command Centre feed and employee performance evidence.

This repo is a from-scratch build (not built on Frappe) driven with Claude Code. It exists alongside SIHL's existing Frappe estate (Vision/CRM, SIHL-One) - `Employee`/`Department` are read from Frappe HR, never duplicated as a second master.

## Documents this repo implements

- **Business Requirement Specification** - the full BRS this build follows (task taxonomy, RACI/DACI, SLA/escalation, MIS, security, Appendix A functional requirements, Appendix F decisions).
- **UI Wireframes** - 8 low-fidelity screens (My tasks, task detail, Kanban, team workload, enterprise dashboard, project view, recurring task setup, exit checklist), annotated back to BRS requirement IDs.

Keep both alongside this repo (e.g. in `docs/reference/`) - `CLAUDE.md` points at them.

## Stack

Next.js 16 (TypeScript) - NestJS (TypeScript) - tRPC - PostgreSQL/Prisma - Redis/BullMQ - S3-compatible storage. Full rationale in `CLAUDE.md`.

**Identity is federated to [Synapse](../Synapse)** - workPulse is registered in Synapse's app registry, appears in its Apps navbar, and verifies Synapse's session. It has no login screen and stores no credentials. See [`docs/synapse-integration.md`](./docs/synapse-integration.md).

## Quick start

See [`docs/phase-0-setup.md`](./docs/phase-0-setup.md) for full step-by-step setup. Short version:

```
npm install
docker compose up -d
cp .env.example .env
npm run db:generate
npm run db:migrate -w packages/db
npm run db:seed
npm run sync:frappe-hr
npm run dev
```

Then open http://localhost:3000.

## Repo layout

```
apps/
  web/            Next.js frontend
  api/            NestJS backend (REST for now; see CLAUDE.md on tRPC timing)
packages/
  db/             Prisma schema + client, shared by apps/api and any future worker
  shared-types/   Framework-free TypeScript types shared by web and api
docs/
  phase-0-setup.md      Step-by-step local setup
  keycloak/              Local-dev realm import
  reference/             Put the BRS + wireframes PDF/docx here
```

## Where this project is

**Phase 0 (this checkout): foundations.** Auth scaffolding, Employee/Department sync from Frappe HR (mock mode), audit log, health checks, CI. No Task/Project/Team functionality yet - see the commented-out model stubs at the bottom of `packages/db/prisma/schema.prisma` for the intended Phase 1 shape, and Appendix A of the BRS for the requirement-by-requirement backlog.

## Status

- [x] Monorepo scaffold, CI, Docker Compose infra
- [x] Prisma schema (Phase 0 tables) + Frappe HR sync (mock mode)
- [x] Next 16 / React 19 / ESLint 9 flat config
- [x] Design token system, app shell, base components
- [x] tRPC wired end to end through Nest DI
- [x] Synapse federated identity - session verification, live active-user check, role mapping
- [x] Prisma migrations applied (Phase 0 + Phase 1)
- [x] Synapse read-only role + shared `SESSION_SECRET` wired; registered in Synapse Apps
- [ ] Live Frappe HR credentials wired in
- [x] Phase 1: Desk Card + Activity, Task lifecycle state machine, recurrence engine
- [ ] Phase 1 remaining: Kanban board, desk card admin screens
- [ ] Phase 2: calendar and capacity
