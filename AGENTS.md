# AGENTS.md

<!-- reins:mode-changed done -->
<!-- reins:onboarding done -->

## Project

Allot — a self-hosted web app for personal money management: splitting the monthly salary across accounts, tracking subscriptions and payments, and scheduling plan changes. Vue front end, Hono API, PostgreSQL, Better Auth.

## Goals and scope

- Self-hosted and open source. It holds personal financial data: security and privacy come before features.
- Versions, plans and their scope live in `docs/ROADMAP.md` and the intents, never in this file.
- Login and access features are Better Auth plugins on `server/auth.ts`.
- `src/lib/calc.ts` stays pure: the server imports it (`server/ → src/lib, src/data`, never the reverse).
- The user's real data lives only in `.loctx/scripts/seed-data.ts` (local) and the database; there is no data file in `src/`.

## Stack and commands

- Vue 3.5 + Vite 8 + TypeScript 6.0 · Hono 4 on Node · Drizzle ORM 0.45 + postgres.js · PostgreSQL 16 · Better Auth 1.7 · zod 4 · Playwright. Node 26 in Docker, ≥ 24 on the host. TypeScript stays on 6.x: vue-tsc does not support TypeScript 7 yet.
- Package manager: **pnpm** only (`packageManager: pnpm@12.18.0`, `pnpm-lock.yaml`). Do not use npm or yarn, and do not add `package-lock.json`.
- Dependencies are pinned to exact versions (`pnpm add -E`). The lockfile changes in the same commit as `package.json`; CI-style check: `pnpm install --frozen-lockfile`.
- Build scripts are denied unless set to `true` under `allowBuilds` in `pnpm-workspace.yaml`; add a package there only when it needs one.
- pnpm's `minimumReleaseAge` rejects versions published less than a day ago. Pick the newest version that passes; never add `minimumReleaseAgeExclude` entries to get around it. `minimumReleaseAgeStrict: true` makes `pnpm add` fail instead of adding them silently.
- **Development and every local test server run in Docker with `docker/compose.dev.yaml`** (values in `docker/.env.dev`: test values copied from `.env.example`, gitignored): `docker compose -f docker/compose.dev.yaml up -d --build -V --wait`, open `http://<host>:15173` (LAN). Only 15173 is published; api and db stay on the compose network. Rebuild with `-V` after dependency changes.
- `docker/compose.yaml` is the production example (released image, Traefik) and uses `docker/.env`, the user's real values: never create or read that file, and never start `compose.yaml` locally.

| Command | What |
|---|---|
| `pnpm install` | install; also runs `lefthook install` on a host checkout (`prepare`) |
| `pnpm typecheck` | `vue-tsc --noEmit` + `tsc -p tsconfig.server.json` — gate |
| `pnpm build` | `vite build` → `dist/` — gate |
| `pnpm dev` / `pnpm dev:api` | Vite / API on the host (Docker is the default) |
| `pnpm db:generate` | schema change → new migration in `drizzle/` (commit it) |
| `pnpm db:migrate` / `pnpm db:seed [file]` | apply migrations / upsert seed data and the login account |
| `pnpm e2e` | Playwright E2E against a running stack (`BASE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) |
| `node tests/api/crud.mjs create\|verify\|cleanup` | API check (restart api between create and verify) |
| `pnpm build:server` | esbuild bundle of the API → `dist-server/` (production image) |
| `docker build -t allot:test .` | production image (root `Dockerfile`, linux/amd64) |
| Actions → **Allot Release** | manual release: version → tag → gates → `ghcr.io/bluenyang/allot` → draft Release; try `dry_run` first; running it needs the user's instruction |

Gates (`.agents/harness/gates.yaml`, order: typecheck → build) run on every commit through **lefthook** (`lefthook.yml`, pre-commit). Gates are check-only; never add a command that rewrites files.
- `gates.yaml` has no reins path for root gates yet (`reins config gates` only appends subdirectory proposals; re-detection is planned for reins 0.3.1). Change it only on the user's instruction, in a dedicated `config(gates): …` commit that touches nothing else.

## Conventions

- Default branch: **`master`** (there is no `main`). Work on `type/topic` branches and merge into `master`; never commit to `master` directly.
- Merges go through a **GitHub PR** on origin (user, 2026-11-10: "GitHub PR로"). Push, PR and merge each need the user's instruction. There is no CI yet: put the local gate output (typecheck, build) and the test summary in the PR body.
- Delegated roles (review, committee, audit) follow `.loctx/delegation.local.md` when it exists; the gates in `gates.yaml` are the same for every role.
- Commit messages: `<type>: <summary>` (e.g. `init:`, `chore:`, `feat:`, `fix:`), English.
- Pure calculation goes in `src/lib/calc.ts`; types in `src/data/types.ts`; pages in `src/pages/`, shared UI in `src/components/`.
- Every change goes to the API first; the store takes the server's answer (`src/lib/store.ts`). New list editors use `EditSheet` + `useEditor`.
- API bodies are validated with zod in `server/validation.ts`; schema changes go through `pnpm db:generate`, never hand-written SQL. A data move that the schema diff cannot express goes in a `drizzle-kit generate --custom` migration.
- **The repository is public** (origin `bluenyang/allot`). Never put the user's real data, account or product names, amounts or personal circumstances in code, copy, docs, commit messages or tests. Their data lives only in `.loctx/` and the database; allocation names are data (`allocation_target`).

## Red lines

- Do not touch Syncthing files: `.stfolder/`, `.stignore`.
- Secret files (`.env*`, keys, certificates — see `.claude/settings.json` deny rules and `common-red-lines.yaml` C4) are never read or edited.
  - One exception, given by the user on 2026-11-10 (".env 는 그냥 복사해서 네가 테스트용으로만 써라"): `docker/.env.dev`, which the agent creates from `docker/.env.example` with random test values and uses only with `docker/compose.dev.yaml`. It never applies to `docker/.env` or any other env file.

<!-- reins:begin notice v=0.3.0 -->
> The blocks marked `reins:begin … reins:end` are written by reins from `.agents/harness/`. Do not edit them by hand; the user changes them with `reins config` or `reins update` in a terminal. Everything outside the blocks belongs to the project. Nothing in this repository runs reins while you work.
<!-- reins:end notice -->

<!-- reins:begin layout v=0.3.0 -->
## Layout

- `.agents/` — committed agent context: `intent/<NNN>_<slug>/{intent,spec}.md`, `audit/<version>.md`, `knowledge/`, `harness/` (settings, roles, templates), `skills/` (the stage skills).
- `.loctx/` — this machine only (gitignored): `ROADMAP.local.md`, `history/<version>.md`, `reports/<version>/`, `context/`, `bindings.local.yaml`, `delegation.local.md`.
- `docs/ROADMAP.md` — the public roadmap.
<!-- reins:end layout -->

<!-- reins:begin settings v=0.3.0 -->
## Settings

- `.agents/harness/bindings.yaml` — the mode (`single` or `multi`), which model does which role group, and `audit.required`. A personal override may sit in `.loctx/bindings.local.yaml`; when it exists, it wins, and when it changes who does what, `.loctx/delegation.local.md` holds that person's delegation table.
- **When `audit.required` is true (the default), every version ends with an audit (skill `audit`). It is mandatory: never skip it; only the user switches it off.**
- `.agents/harness/gates.yaml` — the project's own check commands; the hooks and the `test` skill run them as they are.
- `.agents/harness/roles/<group>.md` — what each role does, must not do, and which tools it may use.
<!-- reins:end settings -->

<!-- reins:begin flow v=0.3.0 -->
## Flow

Follow these steps in order; each has a skill in `.agents/skills/`, and each skill names the next.

1. `roadmap` — ideas go to `.loctx/ROADMAP.local.md`; once settled with the user, to `docs/ROADMAP.md`.
2. `intent` — the PM writes the direction and the plan; **the user approves**.
3. `spec` — the spec, its work units (W-n) and checks (V-n); **the user answers 진행 or 수정 on its summary, every time**.
4. `implement` → `review` — commit at meaningful units (a point you can revert or reset to without taking other working work or features with it), each naming its spec items; changing the spec's work units needs the spec changed and approved first.
5. `test` → `merge` → **`audit`** (after the merge, before the rc) → `release` → `retro` (after stable), then delete the version's working files.

The first conversation after installation (or after a reconcile or mode-changed marker appears in this file) starts with `onboard`.
<!-- reins:end flow -->

<!-- reins:begin delegation v=0.3.0 -->
## Delegation

If `.loctx/delegation.local.md` exists, follow it instead of this section (your personal settings; `reins config --local` writes it).

Mode: **multi** — you are the PM (claude claude-opus-5-5). Hand a role its work with the list of files and decisions it needs; every report comes back to you, and a role never calls another model itself. Roles not listed are yours.

| role | model | how to call |
|---|---|---|

Routine review takes one reviewer; `pl/discussion` and `advisor/committee` (every listed model, without seeing each other) are for large decisions, audit remedies, incidents and unresolved disagreements.

Audit: **required every version**; run it on claude claude-opus-5-5 in a fresh run that gets only the records, never this conversation.
<!-- reins:end delegation -->

<!-- reins:begin records v=0.3.0 -->
## Approvals and records

- Record an approval by quoting the user in the intent's or spec's `approvals:` — `{ role: user, by, at, words, rev }` — and commit it. Never record an approval the user did not give.
- A step or approval the user tells you to skip goes to the intent's `waivers:` — `{ step, words, at, scope: once }` — at that moment. It applies once; next time, follow the flow.
- Every file you create has an owner and a deletion point (each skill lists them). Working files under `.loctx/reports/<version>/` are summarised in history and the audit, then deleted after the retro.
<!-- reins:end records -->

<!-- reins:begin stops v=0.3.0 -->
## When to stop and ask

- **Ask the user and stop:** an irreversible action (force push, deleting a tag, rewriting the default branch, data or production changes); a stable release; anything that leaves the machine (push, PR, release) unless the settings or the user allow it; scope moving outside the intent and spec; a conflict with a past decision; a next step that needs an approval not yet given.
- **Stop and find the cause:** two failures in the same work unit; empty or doubtful check output; a pass without evidence (a pass needs the raw output's path).
- **When the user interrupts** (chat, Ctrl+C, session end): stop and write the resume point in `.loctx/history/<version>.md`.
- What no role does: `.agents/harness/policy/common-red-lines.yaml`.
<!-- reins:end stops -->

<!-- reins:begin language v=0.3.0 -->
## Language

`AGENTS.md`, code, commits, `.agents/` sources: English. Documents the user reads (`intent/`, `.loctx/`, `docs/*.ko.md` if any): ko.
<!-- reins:end language -->
