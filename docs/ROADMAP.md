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

## v0.2 — MCP server, OAuth and passkey login

Status: planned.

User's words (2026-11-10, Korean):

> v0.2에서 MCP 열고 싶거든? OAuth랑 패스크 로그인 넣어서. 클로드랑 이전에 대화했던거를 MCP로 데이터 조정해달라고 하려고.

In short:

- Open an MCP server so Claude can read and adjust the app's data (e.g. from earlier conversations).
- Add OAuth and passkey login.
- v0.1 choices (Better Auth, API shape) should leave room for this.
