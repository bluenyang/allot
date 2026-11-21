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

Status: 0.1.5 released (2026-11-22); the routing patch next. Settled with the user on 2026-11-11. The former v0.2 (MCP server, OAuth and passkey login) moves down into patch releases of v0.1 — user's words: "v0.2 쪼개기: 응. 쪼개라. 각 patch 버전으로 쪼개고, 버전 v0.2에서 v0.1.x로 내려." Each patch ships on its own.

Direction (user's words, Korean, 2026-11-11):

- "AI가 내 회계를 관리해줄 수 있다는 느낌으로." — MCP can read and change data, from the internet ("LAN이 아니라 인터넷으로 쓸거다").
- "회계재무에 개인 정보가 많다. 이러면 보안문제도 다뤄야 함." — security comes before the AI write path and multi-user.
- "OIDC 호환 + GitHub + Google 3가지하고, ON/OFF 가능하게" — each provider, and password login, can be switched on or off in settings or env.
- Multi-user for a small circle of people, admin-created accounts; the existing user and data are kept.
- Revert works like commits: "일반적인 커밋 단위라고 생각해라."

Decisions from the committee review (2026-11-11), accepted by the user ("그렇게 가자"):

- The backend stays on Hono / Node / TypeScript (shared `calc.ts`, auth as Better Auth plugins, a stable MCP TypeScript SDK).
- One image serves the front end and the API; production compose adds a TLS reverse proxy example.
- Tenant isolation in the app and with PostgreSQL row-level security; Allot uses its own database and a dedicated role that is not a superuser; row-level security is forced on the table owner (spec 005, option A).
- Envelope encryption (AES-256-GCM, per-user data keys wrapped by a master key) for secrets first: OAuth tokens, API credentials, later notes and names.

| Patch | Scope |
|---|---|
| 0.1.1 (released 2026-11-12) | Security foundation: `user_id` on every table (existing data kept for the current user), row-level security, change sets with revert, explicit trusted origins, HTTPS in the production example |
| 0.1.2 (released 2026-11-16) | Login and admin: generic OIDC, GitHub, Google and password, each on/off; per-provider sign-up policy (admin-created, approval, or group/organization/domain rules); admin menu; initial admin from env (email or OIDC subject); encryption module; auth that a future mobile app can use (bearer tokens, deep-link return) |
| 0.1.3 (released 2026-11-17) | MCP read: API keys (hashed, scoped, expiring, revocable), key management page, read tools; UI language setting (added 2026-11-15: "언어를 빼둔다? 그럼 다음 패치 버전으로 일단 적어놔봐.") |
| 0.1.4 (released 2026-11-21) | MCP write: write tools, preview before confirm, revert of AI change sets. rc.2: redesign of every screen from the design canvas and a design system (`DESIGN.md`); features not built yet shown as "coming soon"; the remainder target may be deleted (added after the fact, first audit of intent 010, F-1) |
| 0.1.5 (released 2026-11-22) | One-off expenses: lump sum, split payment, installments — KRW or USD, interest-free or with a fee, each round editable with a paid / remaining state; each round counts in its month by how it is paid (subscription account → that month's subscription transfer, salary account or card → that month's remainder); the Subscriptions menu becomes **Spending**, with General, Installments and Subscriptions tabs as drawn on the design canvas (settled 2026-11-21, see below) |
| next patch after 0.1.5 | Routing: vue-router with history URLs in place of the hand-written hash routes; old `#…` addresses and login return addresses keep working; the server serves the app for every non-API path (settled 2026-11-21: "그렇게 하자 그럼. a방식으로." — its own small patch before account management; its version number is settled when it starts) |
| 0.1.6 | Account management and the budget menus from the design canvas: Living, Savings and Investment screens (items by amount or ratio, the total is the salary allocation value), accounts linked to purposes, target amounts and per-account buffers that refill gradually — reaching a target raises a pending change that the user confirms before allocation stops; item amounts per phase; in Spending, paying a card purchase from an account's buffer and refilling it over chosen months by raising that account's transfer (drawn on the canvas, user: "버퍼에서 지출하는 기능(v0.1.6에서 추가될 예정)"). Actual spending from statements waits for 0.1.7 (settled 2026-11-21) |
| 0.1.7 | Transactions: file import and card statements from Gmail; matching against expected payments (paid, delayed, foreign-currency amount); the actual salary drives the month |
| 0.1.8 | Payslip deductions and month-end close |
| 0.1.9 | Mobile app (Capacitor): payment notifications on Android; on iOS what Shortcuts and the share sheet allow |
| 0.1.10 | MCP over OAuth: remote connectors that take only OAuth (claude.ai, the phone app); 0.1.3 ships API keys only (added 2026-11-16: "a만. 지금 계획되지 않은 빠른 버전이 뭐지? 거기로 미루면 될거 같은데" / "그럽시다.") |

### 0.1.5 and 0.1.6 — settled before the 0.1.5 intent

Settled on 2026-11-21 (user's answers to the PM's questions, Korean): how a round counts in its month — "결제 수단별 반영"; the list screen — "구독 화면에 탭을 둔다. 그런데, 구독 이라는 메뉴를 아예 \"지출\"이라는 메뉴로 개편하고 싶음"; what 0.1.5 accepts — foreign currency (USD), fees on installments, the state of each round, and the amount and date of each round; the scope of 0.1.6 — "캔버스 예산 메뉴 전체". The user then drew the Spending screens on the design canvas: "캔버스를 업데이트 하였음. 버퍼에서 지출하는 기능(v0.1.6에서 추가될 예정)도 포함되어 있음."

### 0.1.2 — redesign before rc.1

Added on 2026-11-15 (intent 007). User's words: "디자인 변경 작업. 계정의 클로드 디자인 아티팩트에서 이 회계 시스템 리디자인 참고"; chosen: "외형 + 설정 일반·테마", menus without a feature "숨김", "0.1.2 rc.1 전에 포함".

- The whole app takes the redesign's tokens, components and shell; behaviour and API stay the same.
- Per-account settings: theme (colours, corners, density) and general display settings.
- Weekend and holiday adjustment of the monthly dates, with holidays from rule sets (RRULE) — user's words: "주말, 공휴일은 약간 플러그인??? 형태로 두자. rrule로 된 규칙 세트를 이용한다는 느낌으로."
- A month calendar on the schedule page (user: "달력을 full-caleandar나 다른 거 써도 되지 않나").
- Menus for features that do not exist yet (AI statements, assistant, AI settings) stay hidden until their version.

Later (not scheduled): user-supplied LLM key for parsing and bookkeeping help, year-end tax estimate, passkey login, wider column encryption, auto-payment discovery.

Out: a full household ledger ("가계부까지는 아님"); licensed financial data services (MyData, open banking) — they require a licence or a business registration.
