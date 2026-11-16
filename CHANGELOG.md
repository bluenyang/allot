# Changelog

## 0.1.3-rc.1 — 2026-11-16

Read-only MCP endpoint, API keys, and a Korean/English interface. Intent 008 (`.agents/intent/008_mcp-read-language/`).

### Added
- MCP read endpoint at `POST /api/mcp` (Streamable HTTP, stateless) with six read-only tools: `get_overview`, `list_subscriptions`, `list_plan_changes`, `get_allocation`, `get_schedule`, `list_changes`. Each runs as the key's owner, under the same row-level security as the app. No tool changes data. See the README for how to connect a client.
- API keys, in Settings › AI & integrations: stored hashed, shown once when created, scoped to `mcp:read`, with an expiry (1 to 365 days), revocation and a last-used time; at most 10 live keys per account. A key works only at `/api/mcp`, never as a session for the other API.
- Admin switch (Admin › API key tab) for keys without an expiry, off by default, or `ALLOT_API_KEY_NO_EXPIRY=true|false` (env wins and locks the switch). While it is off, every key without an expiry gets one year from the moment it is switched off or the server starts.
- Abuse limits on the endpoint: 20 failed authentications per client address in 10 minutes (then 429 with `Retry-After`; every failure is the same 401 whatever the reason), and 120 requests a minute per key. The Host and Origin of a request are checked against `TRUSTED_ORIGINS` / `BETTER_AUTH_URL`.
- Interface language: Korean and English, chosen in Settings › General (or follow the browser). Menus, pages, amount units, calendar text, holiday names and the messages the server returns follow it; the sign-in screen uses the language last chosen in this browser, then the browser's language. `Accept-Language` picks the language of API error messages.

### Security
- Lifted the `esbuild` that `@esbuild-kit/core-utils` pulls in past GHSA-67mh-4wv8-2f99 with a package override (6937d61).

### Changed
- The commit and push gates now include the unit tests, and the Playwright E2E is an optional gate (69c53b9).

## 0.1.2 — 2026-11-16

Stable. Same application code as 0.1.2-rc.3. Login and admin (intent 006) and the redesign with display settings, holiday rule sets and the calendar (intent 007); the upgrade notes are under 0.1.2-rc.1.

## 0.1.2-rc.3 — 2026-11-16

### Changed
- The sidebar edge has a visible handle (a small bar on the border line) that highlights on hover, focus and while dragging.

### Fixed
- Dragging the sidebar edge turned the page background teal until the drag ended.

## 0.1.2-rc.2 — 2026-11-16

Layout changes asked for after rc.1 (spec 007 S-20, S-21).

### Changed
- Sidebar: opens wider (272px); drag its edge, or focus the edge and use ←/→ (Shift for bigger steps), Home/End, to set 200–360px; a double-click goes back to the default. A button folds it to icons only. Width and folding are remembered in this browser.
- On a wide screen the content column sits in the middle of the space next to the sidebar; the header bar and footer line up with it. The header keeps one line on narrow windows: the search box drops its hint, then becomes its icon.

## 0.1.2-rc.1 — 2026-11-16

Login and admin. Intent 006 (`.agents/intent/006_login-admin/`). Redesign and display settings, intent 007 (`.agents/intent/007_redesign/`).

### Upgrading from 0.1.1
- **`ALLOT_MASTER_KEY` is required**: 32 random bytes in base64 (`openssl rand -base64 32`). Without it the app does not start and says why. Keep it apart from database backups.
- The existing login account stays, with its data, and becomes the admin. Nothing else changes until you turn on another login method.

### Added
- Login with generic OIDC (one provider, standards only: discovery, PKCE, ID token checked against JWKS; Dex, Authentik, Keycloak by settings), GitHub and Google, next to the password. Each method is switched on and off in the admin screen or by env (`AUTH_<P>_*`; env wins and locks the field); a change applies without a restart.
- Sign-up policy per provider: admin-created accounts only, approval, or rules (email list, OIDC group, GitHub organization, Google domain). Accounts admitted by a rule are checked again at every login. External accounts link by provider identity (OIDC: issuer + subject), never by a matching email alone.
- Admin screen: accounts (create, approve, roles, ban, password reset, end sessions, full delete with the email typed again) and login methods. The admin sees account details only, never anyone's financial data; impersonation is off; the last admin cannot be demoted, banned or deleted. Password login cannot be switched off while no admin has another login.
- First admin from env: `ADMIN_EMAIL`, or `ADMIN_OIDC_SUBJECT` for an OIDC-only start.
- Account screen: linked logins (link, unlink), password change.
- Envelope encryption (AES-256-GCM, a data key per user wrapped by `ALLOT_MASTER_KEY`) for external login tokens and client secrets entered in the admin screen; `pnpm keys:rotate` re-wraps the data keys after a master-key change.
- For a future mobile app: `Authorization: Bearer` sessions, and a return to the app after an external login through a one-time token, only to URLs listed in `ALLOT_APP_RETURN_URLS` (off by default).
- `pnpm db:admin`: the admin account without any data file (a fresh clone starts here). New accounts start from default settings and empty lists.
- Development: Dex in `docker/compose.dev.yaml` as the test OIDC provider (behind the Vite proxy at `/dex`).
- Redesign: a new look across the app — neutral grounds, green for actions, orange for signals, small corners, tables; IBM Plex Sans KR and Mono bundled with the app (no font CDN); grouped sidebar with the user, page headers, a footer; editors open as a modal.
- 설정 (per account): 일반 — light/dark/system, date format, amount unit (원·천원·만원), negatives, exchange rate and buffer, pay/transfer/billing days and what to do when one falls on a weekend or holiday; 테마 — primary and accent colours (presets or your own, kept readable at 4.5:1), corners, density. Changes are in the change history and can be reverted.
- Holidays as rule sets (iCalendar RRULE, Korean lunar dates as `RSCALE=DANGI`, RDATE/EXDATE, substitute holidays). The public holidays of Korea are built in; add your own sets (company days, election days).
- 일정: a month calendar with the monthly dates, subscription payments, plan changes and holidays (loaded only when opened).
- 현황: KPI strip; the 이번 달 tab shows the distribution, the next six months of subscription costs, upcoming payments, plan changes, upcoming events and the checklist (예정 and 확인할 것 show their own cards). 구독: table with status, category and payment-path filters, a two-line list on phones.
- Saturdays in blue and Sundays in red on the calendar (also the days of the months around it and the phone list) and on the dashboard payment dates.
- A light/dark switch in the header; light is the default, dark uses neutral greys.

### Changed
- Several accounts are normal now: the seed no longer refuses other accounts, and `--replace-admin` takes the old account's email.
- `/api/state` answers default settings for an account that has saved none yet (was 409).
- Development `BETTER_AUTH_URL` should be the computer's LAN address, so the api container reaches Dex.
- Menu names: 분배 → 월급 분배, 내역 → 변경 내역; 계정 is now 설정 › 로그인·보안 (`/#account` still opens it). The pay days and exchange rate moved from 월급 분배 to 설정 › 일반.
- Migrations 0018–0020 add the `preference` and `holiday_set` tables (row-level security forced) and `settings.day_shift` (default: no shift, so every month computes as before); 0020 makes light the default theme.

### Fixed
- The session check (`/api/auth/get-session`) allowed 100 requests a minute per address and the app read a 429 as signed out, so a busy tab could land on the login screen. The limit is 600 a minute, and a 429 now shows a wait note and retries after the time the server gives.

## 0.1.1 — 2026-11-12

Stable. Same application code as 0.1.1-rc.1; adds the env-file guard (`scripts/guard-env.mjs`, PR #7).

## 0.1.1-rc.1 — 2026-11-11

Security foundation. Intent 005 (`.agents/intent/005_security-foundation/`). The screens and the distribution stay the same.

### Added
- Every row has an owner (`user_id`); existing data goes to the existing account on upgrade (migration 0006 refuses when that is ambiguous). References between tables only reach rows of the same user.
- PostgreSQL row-level security on every owned table, forced for the table owner; each request runs as its user. The server warns at start when its database role bypasses it or a table lacks it.
- Change history: every save is a change set; the new 내역 tab lists them and reverts one like a commit (refused when the rows changed since). `CHANGE_LOG_RETENTION_DAYS` prunes old sets (off by default).
- `TRUSTED_ORIGINS` for production; the production example routes through Traefik (HTTPS) and runs read-only without Linux capabilities.

### Changed
- `docker/compose.yaml` is now the production example (was `compose.prod.yaml`, removed); local development and tests use `docker/compose.dev.yaml` with `docker/.env.dev`.
- `pnpm db:seed` writes the account first; `--replace-admin` moves the data to the new account instead of losing it.
- Locks are per user (advisory locks) instead of table locks.

## 0.1.0 — 2026-11-11

First stable release. Intent 004 (`.agents/intent/004_release-image/`).

### Added
- Production image `ghcr.io/bluenyang/allot` (linux/amd64): one Node process serves the built front end and the API, applies migrations on start; `docker/compose.prod.yaml` example with an external PostgreSQL 16.
- Manual release workflow (GitHub Actions, `workflow_dispatch`): version → tag → gates → image → draft Release.

### Changed
- The server sets the client IP for the login rate limit itself: the socket address, or `TRUSTED_PROXY_IP_HEADER` behind a trusted reverse proxy. Client-sent headers are never trusted otherwise.
- `docker/.env.example`: database user and name `allot`; production settings.

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
