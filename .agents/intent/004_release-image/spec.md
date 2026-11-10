---
intent: "004"
status: reviewed
approvals: []
summary_for_user: |
  운영 이미지 ghcr.io/bluenyang/allot(linux/amd64 하나)을 만듭니다. Node 프로세스 하나가 빌드된 화면과 API를 함께 서빙하고, 시작할 때 마이그레이션을 적용하며, DB는 DATABASE_URL로 외부에 연결합니다.
  로그인 시도 제한용 클라이언트 IP는 서버가 직접 정합니다(기본은 소켓 주소, 설정하면 신뢰하는 프록시 헤더 하나만).
  릴리스는 pipit-bot처럼 Actions에서 수동 실행합니다: 버전 → 태그 → 게이트 → 이미지 푸시 → Release 초안. env 예시의 money는 allot으로 바꿉니다.
  작업 4개, 검증 8개. PR로 머지하고 감사한 뒤 v0.1.0을 실행하고, 이미지를 받아 실제로 돌려 본 다음 Release를 공개합니다.
---
## 요구 해석
- S-1 "ghcr.io 쓰고" + "단일 이미지" → 저장소 루트 `Dockerfile`로 운영 이미지 `ghcr.io/bluenyang/allot`을 만든다. 태그는 `<버전>`과 `v<버전>`이고, 정식 버전이면 `latest`도 붙인다. 플랫폼은 `linux/amd64`(intent 열린 질문 1 답)이다.
- S-2 intent 계획 2 → 운영에는 Vite 프록시가 없으므로, 로그인 시도 제한에 쓰는 클라이언트 IP를 서버가 직접 정한다. 위조한 헤더로 제한을 피할 수 없어야 한다.
- S-3 "pipit-bot 참고. 수동으로해야 함" → `.github/workflows/release.yml`은 `workflow_dispatch`이다. 입력은 `release_type`(patch, minor, major, rc), `version`, `version_suffix`, `dry_run`이다. 흐름은 버전 계산 → (바뀌었을 때만) 버전 커밋 → 태그 → 게이트 → 이미지 빌드·푸시 → GitHub Release 초안이다. 비밀값은 `GITHUB_TOKEN`만 쓴다.
- S-4 "env example 같은데에도 money 대신 allot" → `docker/.env.example`의 DB 사용자·이름·URL과 에이전트 테스트 값(`docker/.env.dev`)을 `allot`으로 바꾼다.
- S-5 "바로 v0.1.0 stable" → 이 작업을 PR로 머지하고 감사한 뒤, 워크플로를 `version=0.1.0`으로 실행한다. 받은 이미지가 실제로 도는지 확인한 다음 Release 초안을 공개한다.

## 설계
**운영 이미지 (`Dockerfile`, 루트)**
- `builder` 단계 (`node:26.13.0-alpine`):
  - `npm i -g pnpm@12.18.0`.
  - `pnpm install --frozen-lockfile`. 컨테이너에는 `.git`이 없어서 prepare 단계가 lefthook 설치를 건너뛴다.
  - `pnpm build`(화면 → `dist/`), `pnpm build:server`(esbuild로 `server/index.ts` → `dist-server/index.mjs`; ESM, platform node, 패키지는 external).
- `deps` 단계: `pnpm install --prod --frozen-lockfile --ignore-scripts`(운영 의존성만).
- 실행 단계 (`node:26.13.0-alpine`):
  - `NODE_ENV=production`, `USER node`, `EXPOSE 3000`.
  - `HEALTHCHECK`: `/healthz`.
  - `CMD ["node", "dist-server/index.mjs"]`.
  - 복사하는 것: `dist/`, `dist-server/`, `drizzle/`, 운영 `node_modules/`, `package.json`.

**서버**
- 정적 서빙: `STATIC_DIR`(운영 이미지에서 `/app/dist`)이 있으면 `/api`·`/healthz` 밖의 요청에 정적 파일을 주고, 없는 경로는 `index.html`을 준다(SPA 폴백). `@hono/node-server/serve-static`을 쓴다.
- 클라이언트 IP: 맨 앞 미들웨어가 요청마다 내부 헤더 `x-allot-client-ip`를 **덮어쓴다**. Better Auth는 지금처럼 이 헤더만 읽는다.
  - `TRUSTED_PROXY_IP_HEADER`가 비어 있으면 소켓 주소를 쓴다(`@hono/node-server/conninfo`).
  - 값이 있으면(예: `X-Real-IP`) 그 헤더를 쓴다. 쉼표로 여러 값이 있으면 마지막 값을 쓴다(신뢰하는 프록시가 덧붙인 값). 헤더가 없으면 소켓 주소를 쓴다.
  - 개발 스택은 Vite가 이 헤더를 덮어쓰므로 compose의 api에 `TRUSTED_PROXY_IP_HEADER=x-allot-client-ip`를 설정한다(지금 동작과 같음).
- 포트: `API_PORT`(기본 3000).

**운영 compose 예시 (`docker/compose.prod.yaml`)**
- 서비스 `app` 하나: `image: ghcr.io/bluenyang/allot:${ALLOT_VERSION:-latest}`, `env_file: .env`, 포트 `${APP_PORT:-3000}:3000`, `restart: unless-stopped`.
- DB는 외부(운영 서버의 PostgreSQL 16, pgvector 이미지여도 됨)를 `DATABASE_URL`로 연결한다.
- 첫 데이터는 사용자의 로컬 SQL(`.loctx/scripts/seed-data.sql`)을 `psql`로 넣는다(README에 순서를 적음).

**`docker/.env.example`**
- `POSTGRES_USER=allot`, `POSTGRES_DB=allot`, `DATABASE_URL=postgres://allot:…@db:5432/allot`.
- 운영 항목을 추가한다: `APP_PORT`, `TRUSTED_PROXY_IP_HEADER`(설명 포함), `BETTER_AUTH_URL`(운영 주소).

**워크플로 (`.github/workflows/release.yml`)**
- pipit-bot `release.yml` 구조를 따른다. 다른 점:
  - `version` 잡: 계산한 버전이 `package.json`과 같으면 커밋을 건너뛰고 태그만 만든다. 이미 원격에 있는 태그면 실패한다.
  - `gates` 잡: Node 26, pnpm 12.18.0으로 `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`.
  - `publish` 잡(`needs: [version, gates]`): buildx, ghcr 로그인, metadata(태그 `<버전>`, `v<버전>`, 정식이면 `latest`), `build-push-action`(platforms `linux/amd64`, gha 캐시), Release 초안(본문에 이미지 이름과 pull 명령).
  - 권한: `contents: write`, `packages: write`. 액션은 메이저 태그로 고정한다(pipit-bot과 같음).

### 에이전트가 정한 것
- 서버는 esbuild로 묶어서 실행한다. tsx를 운영 의존성으로 두는 대안은 이미지를 키운다.
- 운영 compose에는 DB를 넣지 않는다. 사용자 운영 서버에 이미 PostgreSQL 16이 있다(intent 004 "하지 않을 것").
- `X-Forwarded-For`처럼 여러 값이 오는 헤더는 마지막 값(신뢰하는 프록시가 붙인 값)을 쓴다.

## 작업 단위
- [ ] W-1 서버: 정적 서빙과 SPA 폴백, 클라이언트 IP 미들웨어, `build:server` 스크립트, 개발 compose의 `TRUSTED_PROXY_IP_HEADER`. (S-1, S-2)
- [ ] W-2 이미지: 루트 `Dockerfile`, `.dockerignore` 정리, `docker/compose.prod.yaml`, `docker/.env.example`의 money → allot과 운영 항목. 에이전트 테스트 값도 allot으로 바꾸고 테스트 DB를 다시 만든다. (S-1, S-4)
- [ ] W-3 워크플로: `.github/workflows/release.yml`. (S-3)
- [ ] W-4 문서: README(운영 배포, 릴리스 절차), AGENTS.md(릴리스 명령), CHANGELOG 0.1.0. (S-1, S-3, S-5)

## 검증 기준
원본 출력은 `.loctx/reports/0.1.0/stable/`에 남긴다. 모호하면 실패다.
- V-1 게이트: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build && pnpm build:server`가 exit 0.
- V-2 이미지 빌드: `docker build -t allot:test .`이 exit 0이다. 이미지 사용자는 `node`, 플랫폼은 `linux/amd64`다. 이미지 안에 `src/`·`tests/`·`.loctx`·`docker/.env*`가 없다.
- V-3 이미지 실행: 빈 PostgreSQL 16 DB에 연결해 컨테이너를 띄운다. 마이그레이션이 적용되고 `/healthz`가 200이다. `/`가 화면 HTML, `/assets/*`가 정적 파일, `/없는-경로`가 `index.html`, `/api/state`가 401을 돌려준다. SQL 시드(계정 포함판)를 넣은 뒤 로그인 200, 그 쿠키로 `/api/state` 200.
- V-4 클라이언트 IP:
  - 이미지 기본값(헤더 설정 없음)에서 `x-allot-client-ip`·`X-Forwarded-For`를 시도마다 다르게 위조해도 틀린 로그인 6번째부터 429.
  - `TRUSTED_PROXY_IP_HEADER=X-Real-IP`로 띄우면 `X-Real-IP`가 다른 요청끼리는 따로 센다(한 IP가 429여도 다른 IP는 401).
- V-5 개발 스택 회귀: 테스트 스택(새 DB 값 allot)을 다시 만들고 시드한 뒤 `tests/api/crud.mjs` 4단계 exit 0, `pnpm e2e` 전부 통과.
- V-6 워크플로 dry-run: 머지 후 Actions에서 `dry_run=true`로 실행해 성공한다. 태그·커밋·푸시·Release가 생기지 않는다.
- V-7 릴리스: `version=0.1.0`으로 실행해 성공한다. `ghcr.io/bluenyang/allot:0.1.0`·`:latest`를 받아 V-3과 같은 확인을 통과한다. Release 초안 `v0.1.0`이 있다. 확인한 뒤 초안을 공개하고, `git ls-remote --tags origin`에 `v0.1.0`이 있다.
- V-8 이름·공개 정리: `git grep -nI money`가 과거 기록(`.agents/intent/001_*`, `.agents/audit/`, `CHANGELOG.md`의 rc 절, `.agents/history-archive.md`) 밖에서 0건이다. `.loctx` 금지어 검사가 새 파일에서 실제 개인 정보 0건이다.

## 우려
- 워크플로는 원격에서만 끝까지 검증할 수 있다(V-6, V-7). 로컬에서는 구조만 확인하고, dry-run으로 먼저 돌린다.
- 운영 서버가 리버스 프록시 뒤에 있는데 `TRUSTED_PROXY_IP_HEADER`를 설정하지 않으면, 모든 사용자가 프록시 IP 하나로 묶인다. 로그인 제한이 모두에게 함께 걸리므로, 사용자 한 명인 앱에서는 안전한 쪽이다. README에 적는다.
- ghcr 패키지는 처음 올릴 때 비공개로 생길 수 있다. 공개 여부는 GitHub 패키지 설정에서 사용자가 정한다.

## 범위 밖
- 운영 서버 배포 자동화, arm64, DB 이미지, v0.2 기능.
