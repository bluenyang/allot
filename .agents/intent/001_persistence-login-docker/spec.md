---
intent: "001"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-10"
    words: "검색해보고, 전체적으로 버전을 가능한 최신으로 올려. vite쓰고. 진행해"
    rev: 4045d33
  - role: user
    kind: post-hoc
    by: BlueNyang
    at: "2026-11-10"
    words: "PUT 승인 (Recommended)"
    rev: 83bee06
    note: "감사 A-2 이후 사후 승인. W-6 수정 API를 PATCH 대신 전체 교체 PUT으로 둔다. 사전 승인이 아니었다는 위반 판정은 남는다."
summary_for_user: |
  먼저 의존성을 최신 안정판으로 올립니다(Vite 8·Vue 3.5·pnpm 12·Node 26 LTS. TS는 vue-tsc 호환 때문에 6.0.3). Docker(web 15173 LAN + api + PostgreSQL 16)로 개발 환경을 띄우고, Hono API와 Drizzle로 모든 데이터를 PostgreSQL에 저장합니다.
  테스트는 docker/compose.dev.yaml과, .env.example을 복사한 테스트 전용 docker/.env.dev로만 합니다.
  로그인은 Better Auth로 이메일+비밀번호만 쓰고, 가입은 막고, 로그인 시도 횟수를 제한합니다. 계정은 시드가 env 값으로 하나 만듭니다.
  시드 실행기는 저장소에, 실제 데이터는 .loctx/scripts/seed-data.ts에 둡니다. 앱에서 seed.ts와 단일 파일 빌드를 뺍니다.
  설정·구간·일정·체크리스트·계좌·부채·ISA·구독·전환 모두 추가·수정·삭제할 수 있게 하고, 찾은 버그 두 개를 고칩니다.
  작업 단위 10개, 검증 13개. 브라우저 검증은 Playwright, v0.2(MCP·OAuth·패스키) 자리를 남깁니다.
---
## 요구 해석
- S-1 "PostgreSQL 사용. 라이브러리 사용하기를 권장함" → 앱의 모든 데이터를 PostgreSQL에 저장하고, 접근은 Drizzle ORM(postgres.js 드라이버)으로 한다. 스키마는 drizzle-kit 마이그레이션 파일로 커밋한다. (intent 열린 질문 1 답)
- S-2 "로그인 기능 넣기(다른 라이브러리 사용 권장)" → Better Auth, 이메일+비밀번호, 가입 막음, 계정 하나. 로그인하지 않으면 `/api/*`(auth 제외)는 401을 돌려준다. (열린 질문 1 답)
- S-3 "각 항목 수정이 안되더라고? 수정되게 해놔." + "모든 항목" → 설정, 생활비, 구간, 일정, 체크리스트, 계좌, 부채, ISA 분배, 구독(메모 포함), 플랜 전환을 UI에서 추가·수정·삭제할 수 있다. 단, 설정·생활비는 행이 하나뿐이라 수정만 한다. 수정한 값은 새로고침해도 남는다. (열린 질문 2 답)
- S-4 intent 문제 4 → 구독 목록에서 전환이 덮어쓴 필드를 고칠 때, 사용자가 무엇을 고치는지(기본 플랜인지, 전환 값인지) 화면에 보여야 하고 저장 결과가 목록에 반영돼야 한다.
- S-5 intent 문제 6 → JSON 내보내기에 accounts·debts·isaSplit을 포함한다.
- S-6 "향후 각 버전마다 docker 사용해서 개발 서버 15173으로 열어놓고" + "LAN까지" → `docker compose -f docker/compose.yaml up` 하나로 web·api·postgres가 뜨고, `http://<호스트 IP>:15173`으로 연다. 이후 모든 버전의 개발 방식이므로 README와 AGENTS.md에 기본 명령으로 적는다. (열린 질문 3 답)
- S-7 "docker 폴더에 Dockerfile, compose.yaml, .env.example 놔두고" → `docker/Dockerfile`, `docker/compose.yaml`, `docker/.env.example`.
- S-8 "seed 제거 + 단일파일 중단" → `src/data/seed.ts` 삭제, 앱은 API에서만 데이터를 읽는다. `vite-plugin-singlefile`을 제거한다. 시드 실행기 `server/db/seed.ts`는 커밋하고, 데이터 파일 경로를 인자로 받는다(기본값 `.loctx/scripts/seed-data.ts`). (열린 질문 4 답, 온보딩 결정)
- S-10 "typescript는 6.0.3을 써라." (2026-11-10 수정 요청) → `typescript`를 6.0.3으로 고정한다. TS 6을 지원하는 `vue-tsc` 3.x로 함께 올린다.
- S-11 "테스트용 compose.dev.yaml에 pg16으로 넣고 올려놔. 내 개인 서버 운영환경이 pgvector16이라서." + 정정 "pgvector는 그냥 운영환경이고, postgres16 쓰라니까?" (2026-11-10) → 개발·테스트 DB는 공식 `postgres` 16 이미지(정확한 태그 고정)다. pgvector는 사용자의 운영 환경 정보일 뿐이며, 운영과 같은 메이저 버전(16)을 맞춘다는 뜻이다. `docker/compose.dev.yaml`은 테스트·개발용 스택이며 커밋한다. 검증은 이 파일로 스택을 실제로 띄워서 한다. `compose.yaml`도 같은 이미지를 쓴다.
- S-12 ".env 는 그냥 복사해서 네가 테스트용으로만 써라." → 에이전트는 `docker/.env.example`을 `docker/.env.dev`로 복사하고 테스트용 값을 채워 `compose.dev.yaml`로만 쓴다. `docker/.env`(사용자 실제 값)는 만들지도 읽지도 않는다. `.env.dev`와 `.env`는 gitignore에 넣는다.
- S-13 "검색해보고, 전체적으로 버전을 가능한 최신으로 올려. vite쓰고." (2026-11-10) → 2026-11-10 기준 npm 레지스트리 `latest` 태그의 안정판으로 고정한다(베타·RC·canary 제외). 빌드 도구는 Vite를 유지한다. 예외: TypeScript는 S-10대로 6.0.3이다. 최신 7.0.2는 Go 네이티브 컴파일러라 vue-tsc가 아직 지원하지 않는다(vuejs/language-tools #6156). DB는 S-11대로 PostgreSQL 16이다.
- S-9 approvals의 v0.2 언급("MCP 열고 싶거든? OAuth랑 패스크 로그인") → v0.1에서 구현하지 않는다. 다만 API를 리소스별 REST로 두고, 인증을 Better Auth 플러그인으로 확장할 수 있는 구조(서버 쪽 auth 인스턴스 하나)로 둔다.

## 설계
**구조 (패키지 하나)**
```
docker/            Dockerfile, compose.yaml, compose.dev.yaml, .env.example  (.env, .env.dev는 gitignore)
server/
  index.ts         Hono 앱 (@hono/node-server), /api/auth/* → Better Auth, /api/* → 라우트
  auth.ts          betterAuth({ drizzleAdapter, emailAndPassword: { enabled, disableSignUp: true }, rateLimit })
  db/schema.ts     Drizzle 스키마 (앱 테이블 + Better Auth 테이블)
  db/client.ts     postgres.js + drizzle
  db/seed.ts       시드 실행기: 데이터 파일 경로 인자, 관리자 계정은 ADMIN_EMAIL/ADMIN_PASSWORD env
  routes/*.ts      리소스별 CRUD, zod 검증 (@hono/zod-validator)
drizzle/           drizzle-kit generate 결과 (커밋)
src/lib/api.ts     fetch 래퍼 (401이면 로그인 화면)
src/lib/store.ts   API에서 전체 상태를 읽고, 변경은 API 호출 뒤 반영
src/pages/Login.vue
```
- `src/lib/calc.ts`, `src/data/types.ts`는 서버와 공유한다. import 방향은 `server/ → src/lib, src/data` 한 방향만 둔다.
- 계산은 지금처럼 클라이언트가 한다. API는 `GET /api/state`(전체 상태)와 리소스별 `POST`·`PUT /:id`(전체 교체)·`DELETE /:id`, 단일 행 리소스의 `PUT /api/settings`·`PUT /api/living`만 둔다. (구현 중 정정: 편집기가 항상 객체 전체를 보내므로 PATCH 대신 PUT)

**테이블** (`Dev.vue` 초안 기준. 바꾼 점은 아래 "에이전트가 정한 것")
settings(1행), living(1행), subscription, plan_change(patch jsonb), phase, plan_event, check_item, account, debt, isa_split(name, code, ratio), 그리고 Better Auth의 user, session, account, verification. 이름이 겹치므로 앱 계좌 테이블은 `bank_account`로 둔다.

**Docker**
- `docker/Dockerfile`: `node:24-alpine`(정확한 태그 고정), `corepack enable`, `pnpm install --frozen-lockfile`. 컨테이너에는 git이 없으므로 `prepare`에서 `lefthook install`을 건너뛰게 한다(`CI=true` 또는 git 유무 검사).
- `docker/compose.yaml`
  - `web`: `pnpm dev --host 0.0.0.0 --port 15173 --strictPort`, 포트 `0.0.0.0:15173:15173`, Vite가 `/api`를 `http://api:3000`으로 프록시한다.
  - `api`: `tsx watch server/index.ts`, 외부 포트는 열지 않는다.
  - `db`: `postgres:16.15-alpine3.24`, named volume, healthcheck. 외부 포트는 열지 않는다.
  - 소스는 bind mount, `node_modules`는 named volume. `env_file: docker/.env`는 `required: false`로 두어 셸 env로도 띄울 수 있게 한다.
  - 마이그레이션은 api 시작 전에 `drizzle-kit migrate`로 적용하고, 시드는 수동(`pnpm db:seed`)으로 돌린다.
- `docker/compose.dev.yaml`: 테스트·개발용 스택이다. `compose.yaml`과 같은 web·api·db(PostgreSQL 16)를 쓰되 compose 프로젝트 이름 `money-desk-dev`, 별도 volume, `env_file: .env.dev`를 쓴다. 에이전트의 Docker 검증은 모두 이 파일로 한다.
- `docker/.env.example`: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `WEB_PORT=15173`. 값은 모두 자리표시자다.

**버전 (2026-11-10 조사, 모두 정확한 버전으로 고정)**

| 구분 | 패키지 | 버전 |
|---|---|---|
| 런타임 | Node (Docker 이미지) | 26 LTS (`node:26-alpine` 정확한 태그) |
| 런타임 | pnpm (`packageManager`) | 12.18.0 |
| 프론트 | vue | 3.5.45 |
| 프론트 | vite | 8.3.6 (8.3.7은 공개 1일 미만이라 pnpm `minimumReleaseAge`에 막힘) |
| 프론트 | @vitejs/plugin-vue | 6.0.10 |
| 타입 | typescript | 6.0.3 (S-10) |
| 타입 | vue-tsc | 3.3.14 |
| 타입 | @types/node | 26.6.6 |
| 서버 | hono | 4.13.17 |
| 서버 | @hono/node-server | 2.1.6 |
| 서버 | @hono/zod-validator | 0.9.1 |
| 서버 | zod | 4.6.7 |
| 서버 | better-auth | 1.7.18 (1.7.19는 공개 1일 미만) |
| 서버 | tsx | 4.23.15 |
| DB | drizzle-orm | 0.45.4 (1.0은 아직 RC) |
| DB | drizzle-kit | 0.31.11 |
| DB | postgres | 4.1.0 |
| 도구 | lefthook | 2.2.2 |
| 도구 | @playwright/test | 1.65.0 |

- pnpm 11부터 `onlyBuiltDependencies`가 없어졌으므로 `pnpm-workspace.yaml`의 `allowBuilds`로 옮긴다.
- Node 25부터 corepack이 Node에 포함되지 않으므로, Dockerfile에서는 `npm i -g pnpm@12.18.0`으로 설치한다.
- 호스트의 Node 24·pnpm 10은 그대로 둔다. pnpm은 `packageManager`를 보고 12.18.0으로 전환한다. `engines.node`는 `>=24`.
- TS 6에서 기본값이 바뀌거나 폐기된 옵션은 `tsconfig*.json`에 명시한다. Vite 8에서 바뀐 설정은 `vite.config.ts`에 반영한다.

**스크립트·게이트**
- `typecheck`: `vue-tsc --noEmit && tsc -p tsconfig.server.json`. gates.yaml의 명령(`pnpm typecheck`, `pnpm build`)은 바뀌지 않는다.
- 추가 스크립트: `dev:api`, `db:generate`, `db:migrate`, `db:seed`, `e2e`(Playwright).

**UI**
- 로그인 화면(이메일·비밀번호)과 사이드바의 로그아웃.
- 수정 UI는 지금 구독 편집기와 같은 패턴(패널 + 저장/취소/두 번 눌러 삭제)으로 통일한다. 편집 패널을 열면 그 패널로 스크롤하고 포커스를 옮긴다.
- 분배 탭의 실수령 시뮬레이션 입력은 그대로 두고 "시뮬레이션"이라고 표시한다. 저장되는 실수령은 설정에서 고친다.
- 구독 편집기: 기준 월에 적용 중인 전환이 있으면 "기본값 / 전환 적용값"을 함께 보여 주고, 전환을 고칠 수 있는 링크를 단다.
- 개발 탭의 "처음 값으로 초기화" 버튼은 없앤다. 앱에 seed가 없기 때문이고, 다시 넣으려면 `pnpm db:seed`를 쓴다.

### 에이전트가 정한 것
- 기본 키는 uuid 대신 text다. 새 행은 `crypto.randomUUID()`로 만든다. 기존 seed의 문자열 ID(`claude` 등)와 전환의 `subId` 참조를 그대로 살리려는 것이다. 대안은 uuid로 바꾸고 시드에서 ID를 매핑하는 방식인데, 매핑 오류의 여지가 생긴다.
- phase 기간 겹침은 DB 제약(gist, `btree_gist` 확장 필요) 대신 API 검증으로 막는다. 확장 설치를 피하고 오류 메시지를 한국어로 주려는 것이다.
- Vite `/api` 프록시로 출처를 하나로 둔다(CORS·교차 출처 쿠키 불필요).
- 검증 라이브러리는 zod를 쓴다(Hono 공식 validator와 Better Auth가 함께 쓰는 쪽).
- 브라우저 검증은 Playwright를 devDependency로 고정 버전 추가해서 한다.

## 작업 단위
각 단위는 혼자 되돌릴 수 있고, 커밋마다 게이트(typecheck, build)를 통과한다.
- [x] W-0 의존성 업그레이드: 기존 의존성을 위 표의 버전으로 올린다(pnpm 12, Vue 3.5, Vite 8, plugin-vue 6, TS 6.0.3, vue-tsc 3). `allowBuilds`로 옮기고 `tsconfig`·`vite.config`를 정리한다. 기존 앱이 그대로 typecheck·build를 통과하고 화면이 뜬다. 새 패키지는 해당 단위에서 표의 버전으로 추가한다. (S-10, S-13)
- [x] W-1 Docker 개발 환경 (web + db): `docker/` 네 파일(`compose.dev.yaml` 포함), `.env.dev` 생성(gitignore), Vite 15173 LAN, `prepare`의 lefthook 건너뛰기. 이 단계에서 앱은 아직 메모리 상태로 동작한다. (S-6, S-7, S-11, S-12)
- [x] W-2 API 골격: Hono 서버 `/api/health`, `tsconfig.server.json`, typecheck 확장, Vite 프록시, compose `api` 서비스. (S-1, S-6)
- [x] W-3 DB 스키마와 마이그레이션: Drizzle 스키마(앱 테이블), `drizzle/` 마이그레이션, api 시작 시 migrate. (S-1)
- [x] W-4 시드 실행기: `server/db/seed.ts`(데이터 파일 인자, 다시 돌려도 결과가 같게 upsert). `.loctx/scripts/seed-data.ts`는 로컬에만 둔다. (S-8)
- [x] W-5 로그인: Better Auth(+ 테이블 마이그레이션), 가입 막음, rate limit, 시드에서 관리자 생성, `/api/*` 보호, 로그인 화면·로그아웃. (S-2, S-9)
- [x] W-6 CRUD API: 모든 리소스의 `GET /api/state`와 POST/PUT/DELETE, zod 검증, phase 겹침 검사. (S-1, S-3)
- [x] W-7 프론트를 API로 전환: store를 API 기반으로 바꾸고, `src/data/seed.ts`와 `vite-plugin-singlefile`을 제거하고, 초기화 버튼을 없애고, 내보내기에 빠진 항목을 넣는다. (S-5, S-8)
- [x] W-8 수정 UI: 설정·생활비·구간·일정·체크리스트·계좌·부채·ISA·구독 메모 편집기, 편집 패널 스크롤·포커스, 구독 기본값/전환값 표시. (S-3, S-4)
- [x] W-9 문서와 E2E: README·AGENTS.md 명령표(Docker가 기본 개발 방식), Playwright E2E 스크립트. (S-6)

## 검증 기준
원본 출력은 `.loctx/reports/0.1.0/`에 남긴다. 판정이 모호하면 실패로 본다. Docker 검증은 모두 `docker compose -f docker/compose.dev.yaml`(`.env.dev` 테스트 값)로 한다. `docker/.env`는 만들지도 읽지도 않는다. 아래 `<dev>`는 `docker compose -f docker/compose.dev.yaml`을 줄여 쓴 것이다.
- V-1 게이트: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build` → 모두 exit 0. 실패: 어느 하나라도 0이 아니면 실패.
- V-2 Docker 기동: `<dev> up -d --build --wait` → exit 0, `<dev> ps`에서 web·api·db가 모두 running/healthy. 실패: 하나라도 exited·unhealthy.
- V-3 포트: `<dev> ps --format json`의 Publishers에 15173만 있고, 0.0.0.0에 묶여 있다. `curl -s -o /dev/null -w '%{http_code}' http://<호스트 LAN IP>:15173/` → 200. 실패: 3000·5432가 열려 있거나, LAN IP로 200이 오지 않음.
- V-4 인증 보호: 로그인 없이 `GET /api/state` → 401. 실패: 200 또는 데이터 노출.
- V-5 로그인·가입 막기: 시드 관리자로 `POST /api/auth/sign-in/email` → 200과 세션 쿠키, 그 쿠키로 `GET /api/state` → 200. `POST /api/auth/sign-up/email` → 4xx이고 user 테이블 행 수가 그대로. 실패: 가입 성공 또는 행 증가.
- V-6 rate limit: 틀린 비밀번호로 짧은 시간에 반복 로그인하면 설정 한도 뒤 429. 실패: 한도를 넘어도 429가 없음.
- V-7 시드: `pnpm db:seed` 두 번 실행 → 두 번째도 exit 0이고, 각 테이블 행 수가 `seed-data.ts` 항목 수와 같다(중복 없음). 실패: 오류 또는 행 수 불일치.
- V-8 CRUD·영속성: 리소스마다(설정, 생활비, 구독, 전환, 구간, 일정, 체크, 계좌, 부채, ISA) API로 생성(단일 행은 수정)·수정·삭제한 뒤 `<dev> restart api` 하고 `GET /api/state`에 결과가 반영돼 있다. 겹치는 phase 생성 → 400. 실패: 하나라도 반영 안 됨, 또는 겹침이 허용됨.
- V-9 UI E2E (Playwright, `pnpm e2e`): 로그인 → 위 리소스마다 UI에서 추가·수정·삭제 → 새로고침 → 값 유지. 전환이 적용된 구독의 기본값을 고치면 편집기에 기본값/전환값이 함께 보이고, 저장 결과가 목록 규칙대로 표시된다. 실패: 테스트 하나라도 실패.
- V-10 seed·단일파일 제거: `git ls-files src/data/seed.ts` → 빈 출력, `grep -rn "data/seed" src` → 빈 출력, `package.json`에 `vite-plugin-singlefile` 없음, `dist/`에 index.html 외 assets 파일이 있음. 실패: 하나라도 남아 있음.
- V-11 내보내기: 개발 탭 JSON에 `accounts`, `debts`, `isaSplit` 키가 있고 DB와 값이 같다(V-9 안에서 확인). 실패: 키가 없음.
- V-12 컨테이너 설치: W-1 이미지 빌드 로그에 lefthook 오류가 없고, 호스트에서 `pnpm install` 뒤에는 `.git/hooks/pre-commit`이 그대로 있다. 실패: 빌드 실패 또는 호스트 훅 사라짐.

- V-13 버전: `pnpm exec tsc -v` → `Version 6.0.3`. `pnpm -v` → `12.18.0`. `package.json`의 모든 의존성이 위 표와 일치하고 `^`·`~` 범위가 없다. `<dev> exec db psql -U $POSTGRES_USER -tAc 'show server_version'` → `16.`으로 시작. `git check-ignore docker/.env docker/.env.dev` → 두 줄 모두 출력. 실패: 하나라도 다름.

## 우려
- 메이저 업그레이드가 여럿 겹친다(Vite 5→8, plugin-vue 5→6, TS 5→6, pnpm 10→12). W-0을 따로 커밋해서, 문제가 생기면 이 단위만 되돌릴 수 있게 한다.
- 이 표는 조사 시점의 `latest`다. 구현 중에 새 버전이 나와도 v0.1 안에서는 표를 따른다.
- LAN에 15173이 열리고 로그인이 이 앱의 유일한 방어선이다. rate limit과 강한 `BETTER_AUTH_SECRET`이 필요하고, `.env.example`에 생성 방법(`openssl rand -base64 32`)을 적는다.
- `docker/.env.dev`는 red line C4의 `.env.*` 패턴에 걸린다. 사용자가 "네가 테스트용으로만 써라"라고 허락했으므로, 에이전트가 만든 테스트 값 파일에 한해서만 쓴다. 사용자의 실제 값(`docker/.env`)에는 이 허락이 해당하지 않는다.
- `docker/.env`는 에이전트가 읽을 수 없다. 사용자가 직접 만들고 값을 채워야 실제 개발 환경이 뜬다.
- 실제 데이터는 `src/data/seed.ts`를 지운 뒤에도 init 커밋 이력에 남는다(사용자가 알고 결정함).
- Postgres·Node 이미지 태그는 W-1에서 실제로 받을 수 있는 정확한 태그로 고정한다.

## 범위 밖
- MCP 서버, OAuth·패스키 로그인(v0.2).
- 운영 배포·호스팅, nginx 빌드 이미지.
- 다중 사용자, 가입 화면, 비밀번호 재설정 메일.
- 실제 청구 기록(`charge` 테이블), 영수증 저장.
- 서버 쪽 계산 API(`/api/summary` 등). 계산은 계속 클라이언트가 한다.
