# Changelog

## 0.1.0-rc.3 — 2026-11-10

Intent 003 (`.agents/intent/003_public-cleanup/`). Prepares the repository for a public origin.

### Changed
- Allocation is data, not code: **allocation targets** (name + kind: living total / subscription transfer / fixed per phase / remainder), per-phase amounts per fixed target, and a **remainder split** (was the hard-wired split of the rest). Setting "subscription transfer rounding" (`subRound`).
- Migrations 0002–0004 move existing data; the distribution for the same data is unchanged (checked over 36 months).
- Screen copy no longer carries personal notes or account names; names come from the user's data. The dev tab shows only the current data.

### Added
- Allocation target editor; phase editor asks an amount per fixed target.
- API: `/api/targets` (one living / subscriptions / remainder each; the remainder cannot be removed), `/api/remainder-split`.

## 0.1.0-rc.2 — 2026-11-10

Intent 002 (`.agents/intent/002_rename-allot/`).

### Changed
- The product is now **Allot**: logo letter A, sidebar, mobile header, login, page title, package name, compose projects `allot` / `allot-dev`, client-IP header `x-allot-client-ip`.
- New palette: deep green accent with an amber secondary, green-tinted neutrals and sidebar, light and dark.

### Fixed
- Subscription avatar letters were hard to read in dark mode (white on bright colors); they now use a per-mode ink.

### Added
- `tests/contrast.mjs`: WCAG contrast check of the palette (text 4.5:1 or 7:1, chart marks 3:1).

## 0.1.0-rc.1 — 2026-11-10

Intent 001 (`.agents/intent/001_persistence-login-docker/`). Audit: `.agents/audit/0.1.0.md`.

### Added
- PostgreSQL storage for every item through a Hono API and Drizzle ORM; migrations in `drizzle/`, applied on api start.
- Login with Better Auth: email + password, sign-up closed, one account (created by `pnpm db:seed`), sign-in limited to 5 per minute.
- Editors for every item: settings, living costs, phases, events, checklist, accounts, debts, ISA split, subscriptions (with memo) and plan changes.
- Subscription editor shows base vs. applied values when a plan change in effect overrides a field.
- Docker development stack (`docker/compose.yaml`): web on port 15173 (LAN), api and PostgreSQL 16 on the internal network only. `docker/compose.dev.yaml` for tests.
- Seed runner `pnpm db:seed [file]` (idempotent; `--replace-admin` to change the account).
- Playwright E2E (`pnpm e2e`) and an API check (`tests/api/crud.mjs`).

### Changed
- npm → pnpm 12; Vue 3.5, Vite 8, TypeScript 6.0, Node 26 in Docker.
- The app reads data only from the API; `src/data/seed.ts` and the single-file build are gone.
- JSON export includes accounts, debts and the ISA split.

### Removed
- "처음 값으로 초기화" in the 개발 tab (use `pnpm db:seed`).

### Security
- The LAN-facing dev server mounts only front-end files, and Vite denies private paths (found in review: the whole repo, including local data and session files, had been readable).
