# Roadmap

Only items the user has settled are listed here. Ideas live in each developer's `.loctx/ROADMAP.local.md`.

## v0.1 — persistence, login, editing, Docker dev

Status: **0.1.0 released** (2026-11-11). See `CHANGELOG.md`.

Settled with the user on 2026-11-10 (user's words, Korean):

- PostgreSQL 사용. 라이브러리 사용하기를 권장함
- 로그인 기능 넣기(다른 라이브러리 사용 권장)
- seed 때문인지는 몰라도 각 항목 수정이 안되더라고? 수정되게 해놔.
- 향후 각 버전마다 docker 사용해서 개발 서버 15173으로 열어놓고.
- docker 폴더에 Dockerfile, compose.yaml, .env.example 놔두고.

In short:

- Store data in PostgreSQL through a library (ORM / query builder), replacing the in-memory store.
- Add login using an existing auth library.
- Make every item editable (today several items cannot be edited).
- From this version on, every version runs its dev server in Docker on port 15173.
- `docker/` holds `Dockerfile`, `compose.yaml` and `.env.example`.

### 0.1.0-rc.2 — rename to Allot

User's words (2026-11-10): "다 allot으로 하고, 색상도 좀 어울리는 색으로 바꿔라." — the product is renamed **Allot** everywhere and gets a palette that fits the name, before the first stable release (intent 002).

### 0.1.0-rc.3 — allocation as data, public repository

Added to the roadmap after the work started (audit 0.1.0-rc3, A-1). User's decisions (2026-11-10): publish the repository after removing personal data and account names — "이력 정리 후 공개 푸시", "은행 이름까지" — and start the public history from a fresh `.git` (intent 003).

- Allocation targets, per-phase amounts and the remainder split are data; no account names in code or copy.
- The public history starts at 0.1.0-rc.3; the earlier history stays local.

### 0.1.0 — stable, release image

Added to the roadmap after the work started (audit 0.1.0-stable, A-1). User's words (2026-11-11): "일단 stable 릴리스좀 해봐. ghcr.io 쓰고, env example 같은데에도 money 대신 allot 쓰고" (intent 004).

- Production image `ghcr.io/bluenyang/allot` (linux/amd64) and a manual release workflow.
- Status: **released** 2026-11-11 — https://github.com/bluenyang/allot/releases/tag/v0.1.0

## v0.1.x — security, login, MCP, and money management (patch releases)

Status: planned. Settled with the user on 2026-11-11. The former v0.2 (MCP server, OAuth and passkey login) moves down into patch releases of v0.1 — user's words: "v0.2 쪼개기: 응. 쪼개라. 각 patch 버전으로 쪼개고, 버전 v0.2에서 v0.1.x로 내려." Each patch ships on its own.

Direction (user's words, Korean, 2026-11-11):

- "AI가 내 회계를 관리해줄 수 있다는 느낌으로." — MCP can read and change data, from the internet ("LAN이 아니라 인터넷으로 쓸거다").
- "회계재무에 개인 정보가 많다. 이러면 보안문제도 다뤄야 함." — security comes before the AI write path and multi-user.
- "OIDC 호환 + GitHub + Google 3가지하고, ON/OFF 가능하게" — each provider, and password login, can be switched on or off in settings or env.
- Multi-user for a small circle of people, admin-created accounts; the existing user and data are kept.
- Revert works like commits: "일반적인 커밋 단위라고 생각해라."

Decisions from the committee review (2026-11-11), accepted by the user ("그렇게 가자"):

- The backend stays on Hono / Node / TypeScript (shared `calc.ts`, auth as Better Auth plugins, a stable MCP TypeScript SDK).
- One image serves the front end and the API; production compose adds a TLS reverse proxy example.
- Tenant isolation in the app and with PostgreSQL row-level security; Allot uses its own database and a non-owner role.
- Envelope encryption (AES-256-GCM, per-user data keys wrapped by a master key) for secrets first: OAuth tokens, API credentials, later notes and names.

| Patch | Scope |
|---|---|
| 0.1.1 | Security foundation: `user_id` on every table (existing data kept for the current user), row-level security, change sets with revert, explicit trusted origins, HTTPS in the production example |
| 0.1.2 | Login and admin: generic OIDC, GitHub, Google and password, each on/off; per-provider sign-up policy (admin-created, approval, or group/organization/domain rules); admin menu; initial admin from env (email or OIDC subject); encryption module; auth that a future mobile app can use (bearer tokens, deep-link return) |
| 0.1.3 | MCP read: API keys (hashed, scoped, expiring, revocable), key management page, read tools |
| 0.1.4 | MCP write: write tools, preview before confirm, revert of AI change sets |
| 0.1.5 | One-off expenses: lump sum, split payment, installments |
| 0.1.6 | Account management: purposes linked to accounts, target amounts (allocation stops at the target), buffers that refill gradually after use |
| 0.1.7 | Transactions: file import and card statements from Gmail; matching against expected payments (paid, delayed, foreign-currency amount); the actual salary drives the month |
| 0.1.8 | Payslip deductions and month-end close |
| 0.1.9 | Mobile app (Capacitor): payment notifications on Android; on iOS what Shortcuts and the share sheet allow |

Later (not scheduled): user-supplied LLM key for parsing and bookkeeping help, year-end tax estimate, passkey login, wider column encryption, auto-payment discovery.

Out: a full household ledger ("가계부까지는 아님"); licensed financial data services (MyData, open banking) — they require a licence or a business registration.
