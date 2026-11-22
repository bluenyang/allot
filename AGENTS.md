# AGENTS.md

<!-- reins:tidy done -->

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

- Vue 3.5 + Vite 8 + TypeScript 6.0 · Hono 4 on Node · Drizzle ORM 0.45 + postgres.js · PostgreSQL 16 · Better Auth 1.7 · zod 4 · Playwright. Node 26 in Docker, ≥ 24 on the host. TypeScript 6.x (why: `.agents/knowledge/2026-11-16_typescript-6-for-vue-tsc.md`).
- Package manager: **pnpm** only (`packageManager: pnpm@12.18.0`, `pnpm-lock.yaml`). Do not use npm or yarn, and do not add `package-lock.json`.
- Dependencies are pinned to exact versions (`pnpm add -E`). The lockfile changes in the same commit as `package.json`; CI-style check: `pnpm install --frozen-lockfile`.
- Build scripts are denied unless set to `true` under `allowBuilds` in `pnpm-workspace.yaml`; add a package there only when it needs one.
- pnpm's `minimumReleaseAge` rejects versions published less than a day ago. Pick the newest version that passes; never add `minimumReleaseAgeExclude` entries to get around it. `minimumReleaseAgeStrict: true` makes `pnpm add` fail instead of adding them silently.
- **Two local servers, two roles** (user, 2026-11-20: "원래 변경 > 15174 테스트 > 문제 없으면 배포 > 15174 내리고 15173에 적용(최신화)", "15174는 개박살 나도 되는거로"; retro 0.1.4: "15173은 E2E 같은 테스트를 하지 않는 '스테이징'으로 본다. 작업 후 업데이트하여 사용자가 확인 가능한 compose.dev 스택. 정식/프리릴리스보다 먼저일 수 있음"). Order of a change: work on the branch → test on **:15174** → update **:15173** so the user can look → release.
  - **:15174 — the throwaway test server.** Every E2E, API check and screen check runs here, never on :15173. Container `allot-rc` on the dev compose network, read-only, its own database `allot_rc` (non-superuser role) and a seeded test account; it runs the branch under test built as an image (`docker build -t allot:test .`) or a released image, and may be broken or wiped freely. It is the one local server outside `docker/compose.dev.yaml`; take it down when the work is released. One check uses it at a time: the PM gives the server to one role at a time and names it in that role's brief ("you are the only one on :15174"); a second role waits (retro 0.1.5, two delegated runs overlapped twice).
  - **:15173 — the staging stack the user uses** (`docker/compose.dev.yaml`, values in `docker/.env.dev`: test values copied from `.env.example`, gitignored): `docker compose -f docker/compose.dev.yaml up -d --build -V --wait`, open `http://<host>:15173` (LAN); it holds the user's real data, so nothing that writes test data runs against it. Update it after the work is done so the user can check — it may be ahead of the latest rc or stable. Only 15173 is published from that stack; api and db stay on the compose network. Rebuild with `-V` after dependency changes.
- `docker/compose.yaml` is the production example (released image, Traefik) and uses `docker/.env`, the user's real values: never create or read that file, and never start `compose.yaml` locally.

| Command | What |
|---|---|
| `pnpm install` | install; also runs `lefthook install` on a host checkout (`prepare`) |
| `pnpm typecheck` | `vue-tsc --noEmit` + `tsc -p tsconfig.server.json` — gate |
| `pnpm build` | `vite build` → `dist/` — gate |
| `pnpm test:unit` | unit tests (`tsx --test tests/unit/*.test.ts`), no database — gate |
| `pnpm dev` / `pnpm dev:api` | Vite / API on the host (Docker is the default) |
| `pnpm db:generate` | schema change → new migration in `drizzle/` (commit it) |
| `pnpm db:migrate` / `pnpm db:seed [file]` | apply migrations / upsert seed data and the login account |
| `pnpm check:logs <files>` | verify evidence logs made by `scripts/check-run.sh` (rev, command, exit per step; no pipes) |
| `pnpm check:migrations` | migration drift check: `db:generate` must report no schema changes |
| `pnpm review:mark` | after a review with no open findings: record the reviewed head of the branch |
| `pnpm e2e` | Playwright E2E against a running stack (`BASE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) — optional gate, not run by the hooks |
| `node tests/api/crud.mjs create\|verify\|cleanup` | API check (restart api between create and verify) |
| `pnpm build:server` | esbuild bundle of the API → `dist-server/` (production image) |
| `docker build -t allot:test .` | production image (root `Dockerfile`, linux/amd64) |
| Actions → **Allot Release** | manual release: version → tag → gates → `ghcr.io/bluenyang/allot` → draft Release; try `dry_run` first; an rc follows the flow, a stable release needs the user's instruction |

Gates (`.agents/harness/gates.yaml`, order: typecheck → build → test; e2e is optional) run before every commit and push through **lefthook** (`lefthook.yml`), which calls `sh .agents/harness/run-gates.sh pre-commit|pre-push`; each run is kept in `.loctx/reports/gates/<tree>.log` for the audits. Gates are check-only; never add a command that rewrites files.
- Change `gates.yaml` (and the hook wiring) only on the user's instruction, in a dedicated `config(gates): …` commit that touches nothing else.

## Conventions

- Default branch: **`master`** (there is no `main`). Work on `type/topic` branches and merge into `master`; never commit to `master` directly.
- Merges go through a **GitHub PR** on origin (user, 2026-11-10: "GitHub PR로"); when to push, open a PR and merge follows the flow section below. There is no CI yet: put the local gate output (typecheck, build, unit tests) and the test summary in the PR body.
- The gates in `gates.yaml` are the same for every role.
- Commit messages: `<type>: <summary>` (e.g. `init:`, `chore:`, `feat:`, `fix:`), English. PR titles and bodies are English too (user, 2026-11-17: "커밋과 PR은 영어를 선호함").
- Every check whose log is evidence (V-n, re-runs, the release test server) runs through `scripts/check-run.sh`; a log is evidence only after `pnpm check:logs` passes on it. Delegated checks get the same instruction. A schema change runs `pnpm check:migrations` before its PR. A failed release run's log is saved at once (`gh run view <id> --log-failed`) under `.loctx/reports/<version>/`.
- A change that makes the app refuse input it accepted before — new validation, a stricter schema, a new error for a case that used to pass — is a spec change, also when it fixes a review finding: stop before the commit and ask the user (user, 2026-11-18: "둘 다 받음", after audits 0.1.3 F-1 and 0.1.4 F-1). Delegated work and review requests carry this rule; a reviewer marks each finding whose fix would refuse new input. This includes a rule or limit on a table, field or feature that is new and not released yet: any limit the spec did not state (a maximum, a precision, a refused value, a narrowed meaning) is asked before its commit (retro 0.1.5, user: "네가 제안한대로 수용." — the third post-hoc approval of the same finding, audit 0.1.5 F-1).
- Before committing a change that replaces or reshapes an input (a field, a picker, a select, a segment, an editor), compare it with the version before the change (`git show <base>:<file>`): every value the old control accepted and stored is still accepted and stored the same way, and no option, view or editor is gone. Add an E2E that saves such an old value and reads it back. Delegated work carries this step in its brief (retro 0.1.4, user: "승인" — seven input refusals or removals were committed and only caught by review in 0.1.4).
- Say what is running, done or blocked only after checking it — the process list, the log, `git log`/`git status` — never from memory or from a report alone; a claim about a tool or hook (what it blocks) is checked in its source or by trying it (retro 0.1.4, user: "승인").
- A delegated brief also carries: one commit per finding or cause (`.agents/knowledge/2026-11-16_commit-per-cause.md`), and the check-before-saying rule above for the role's own report — the PM checks a report's claims (a test "already failing", a log's result) in the logs before relying on them (retro 0.1.5).
- **Delegation, every session:** before the first step that hands work to a role, read `.loctx/delegation.local.md`. Where it exists it replaces the table in the Delegation block below, and that block's "roles not listed are yours" does not apply. At the start of the session, write the assigned models in `.loctx/history/<version>.md`. Each review and audit record names the model that ran it, the command and the output file, so the audit can check it. (user, 2026-11-23: "AGETNS.md는 수정할 수 있잖아. 위임표의 위치를 남겨서 무조건 참조하도록 하면 안됨?", then "따로 PR로 지금 (Recommended)" — after the 0.1.6 reviews 1–2 and first audit ran on the PM's model instead of the assigned ones, and the implementation was not delegated.)
- `scripts/guard-review.mjs` (PreToolUse hook, enabled by the user in `.claude/settings.json`) allows only `gh pr create --head <branch> [--base|--title|--body-file <v>] [--draft]` and `gh pr merge <number> [--merge|--subject|--body|--body-file <v>|--delete-branch]`, each standing alone (no chaining, `-R`, env prefix or `gh api`), and refuses them while the branch has commits after its last review mark.
- Pure calculation goes in `src/lib/calc.ts`; types in `src/data/types.ts`; pages in `src/pages/`, shared UI in `src/components/`.
- Every change goes to the API first; the store takes the server's answer (`src/lib/store.ts`). New list editors use `EditSheet` + `useEditor`.
- API bodies are validated with zod in `server/validation.ts`; schema changes go through `pnpm db:generate`, never hand-written SQL. A data move that the schema diff cannot express goes in a `drizzle-kit generate --custom` migration.
- **The repository is public** (origin `bluenyang/allot`). Never put the user's real data, account or product names, amounts or personal circumstances in code, copy, docs, commit messages or tests. Their data lives only in `.loctx/` and the database; allocation names are data (`allocation_target`).

## Red lines

- Do not touch Syncthing files: `.stfolder/`, `.stignore`.
- Secret files (`.env*`, keys, certificates — see `.claude/settings.json` deny rules and `common-red-lines.yaml` C4) are never read or edited.
  - One exception, given by the user on 2026-11-10 (".env 는 그냥 복사해서 네가 테스트용으로만 써라"): `docker/.env.dev`, which the agent creates from `docker/.env.example` with random test values and uses only with `docker/compose.dev.yaml`. It never applies to `docker/.env` or any other env file.
  - A second exception, given by the user on 2026-11-17 ("b, 예외 허락"): `.loctx/rc/allot-rc.secrets` (mode 600, gitignored with `.loctx/`), which the PM creates with random test values for the release test server — its database password, auth secret, master key and the test account — and uses only to start `allot-rc`. It keeps the test server's database across versions; the test account's password goes to the user in the chat. It never applies to `docker/.env` or any other env file.
  - A command that loads an env file reads it: `docker compose` with an `env_file:` (`up`, `run`, and `config` without `--no-env-resolution`), `source`/`.`, `dotenv`, `direnv`, `cat`/`grep` on it. Locally only `docker/compose.dev.yaml` runs; compose files are checked with `--env-file docker/.env.example config --no-env-resolution`; output that could hold env values is never written to a file before it is checked (user, 2026-11-11, after audit 0.1.1 A-1). `scripts/guard-env.mjs` is the PreToolUse hook that enforces this (on, in `.claude/settings.json`).

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
- **When `audit.required` is true (the default), every version is audited twice (skill `audit`): a first audit before the merge and a second audit after the release. Both are mandatory: never skip one; only the user switches them off.**
- `.agents/harness/gates.yaml` — the project's own check commands; the hooks and the `test` skill run them as they are.
- `.agents/harness/roles/<group>.md` — what each role does, must not do, and which tools it may use.
<!-- reins:end settings -->

<!-- reins:begin flow v=0.3.0 -->
## Flow

Follow these steps in order; each has a skill in `.agents/skills/`, and each skill names the next.

1. `roadmap` — ideas go to `.loctx/ROADMAP.local.md`; once settled with the user, to `docs/ROADMAP.md`.
2. `intent` — the PM writes the direction and the plan; **the user approves**.
3. `spec` — the spec, its work units (W-n) and checks (V-n); **the user answers 진행 or 수정 on its summary, every time**.
4. `implement` → `review` — commit at meaningful units (a point you can revert or reset to without taking other working work or features with it), each naming its spec items. Adding, dropping or rescoping a work unit needs the spec changed and approved first; a smaller adjustment goes on, is recorded in the spec (`A-n`) and is reported at the end of the flow.
5. `test` → `merge` (push, PR, CI) → **`audit`** (the first audit: risk, before the merge) — from the accepted spec to the first audit this is **one flow without asking**: do not stop for permission between these steps; report once at its end. Then the merge on the user's instruction → `release` (the rc the way the repository releases; stable on the user's instruction) → **`audit`** (the second audit: procedure only, handed to the retro) → `retro`, then delete the version's working files.

A loop is the work the user started — usually one version — up to its retro. **The retro ends the loop**: report that it is closed and stop; the next `intent` is written when the user starts the next work. If the user named another end ("go on to …", "do not stop"), follow it for that instruction only and quote it in `.loctx/ROADMAP.local.md`; the intent's approval, the spec's 진행 or 수정, every merge and the stable release still wait for the user. Ideas for later work go to the roadmap whenever they come. Naming a version is not an instruction to start it.

The first conversation after installation, and any conversation that finds a pending `reins:` marker in this file (onboarding, reconcile, mode-changed, tidy), starts with `onboard`.
<!-- reins:end flow -->

<!-- reins:begin delegation v=0.3.0 -->
## Delegation

If `.loctx/delegation.local.md` exists, follow it instead of this section (your personal settings; `reins config --local` writes it).

Mode: **multi** — you are the PM — the model in this conversation. Hand a role its work with the list of files and decisions it needs; every report comes back to you, and a role never calls another model itself. Roles not listed are yours.

| role | model | how to call |
|---|---|---|

Routine review takes one reviewer; `pl/discussion` and `advisor/committee` (every listed model, without seeing each other) are for large decisions, audit remedies, incidents and unresolved disagreements.

Audit: **required every version, before the merge and after the release**; run it in a fresh run of your own model (or another one the user chooses) that gets only the records, never this conversation.
<!-- reins:end delegation -->

<!-- reins:begin records v=0.3.0 -->
## Approvals and records

- Record an approval by quoting the user in the intent's or spec's `approvals:` — `{ role: user, by, at, words, rev }` — and commit it. Never record an approval the user did not give.
- A step or approval the user tells you to skip goes to the intent's `waivers:` — `{ step, words, at, scope: once }` — at that moment. It applies once; next time, follow the flow.
- Every file you create has an owner and a deletion point (each skill lists them). Working files under `.loctx/reports/<version>/` are summarised in history and the audit, then deleted after the retro.
- `.agents/audit/<version>.md` holds both audits of a version; an adjustment made while working is a line in the spec's adjustment record (`A-n`).
<!-- reins:end records -->

<!-- reins:begin stops v=0.3.0 -->
## When to stop and ask

- **Ask the user and stop:** an irreversible action (force push, deleting a tag, rewriting the default branch, data or production changes); a merge; a stable release; work that would touch a red line; a work unit that has to be added, dropped or rescoped; scope moving outside the intent and spec; a conflict with a past decision; a next step that needs an approval not yet given. Pushing a branch of the work in progress and opening its PR is part of the flow (an accepted spec's work units, their records, release documents); taking anything else out of the machine still needs the user's word.
- **While you wait for the user** — a release approval, a merge instruction, a stable instruction — report and wait; do not start another unit's work. Stabilising the same version is this loop's work.
- **The retro ends the loop:** report that it is closed and stop.
- **Stop and find the cause:** two failures in the same work unit; empty or doubtful check output; a pass without evidence (a pass needs the raw output's path).
- **When the user interrupts** (chat, Ctrl+C, session end): stop and write the resume point in `.loctx/history/<version>.md`.
- What no role does: `.agents/harness/policy/common-red-lines.yaml`.
<!-- reins:end stops -->

<!-- reins:begin language v=0.3.0 -->
## Language

`AGENTS.md`, code, commits, `.agents/` sources: English. Documents the user reads (`intent/`, `.loctx/`, `docs/*.ko.md` if any): ko.
<!-- reins:end language -->
