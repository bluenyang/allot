# Allot (0.1.1)

월급 분배·구독·플랜 전환 일정 관리. 한 사람이 쓰는 웹앱.
Vue 3.5 + Vite 8 + TypeScript 6 / Hono API / PostgreSQL 16 (Drizzle ORM) / Better Auth 로그인.

## 개발 서버 (Docker, 기본)

모든 버전은 Docker로 개발 서버를 띄운다. 브라우저에서 `http://<이 컴퓨터 IP>:15173`으로 연다(같은 네트워크의 폰에서도 열린다).

```bash
cp docker/.env.example docker/.env.dev  # 테스트 값 채우기 (비밀번호·BETTER_AUTH_SECRET 등)
docker compose -f docker/compose.dev.yaml up -d --build -V --wait
docker compose -f docker/compose.dev.yaml exec api pnpm db:seed   # 처음 데이터 + 로그인 계정
```

- 서비스: `web`(Vite, 15173 공개), `api`(Hono, 내부 3000), `db`(PostgreSQL 16, 내부). 외부에 열리는 포트는 15173 하나다.
- `/api`는 Vite가 api 컨테이너로 넘긴다(같은 출처라 쿠키·CORS 설정이 필요 없다).
- 의존성이 바뀌면 `up -d --build -V`로 이미지와 `node_modules`를 새로 받는다.
- 마이그레이션은 api가 시작할 때 자동으로 적용된다.
- `pnpm db:seed [파일]`은 데이터 파일(기본 `.loctx/scripts/seed-data.ts`, 로컬 전용)을 id 기준으로 upsert하고, `ADMIN_EMAIL`/`ADMIN_PASSWORD`로 로그인 계정을 만든다(이미 있으면 비밀번호를 바꾸고 기존 세션을 끊는다). 회원가입은 막혀 있다.
- 시드 계정은 하나뿐이다. 다른 이메일로 바꾸려면 `pnpm db:seed --replace-admin` — 데이터와 변경 내역을 새 계정으로 옮긴 뒤 예전 계정과 그 세션을 지운다.
- web 컨테이너에는 프론트 파일(`index.html`, `vite.config.ts`, `tsconfig.json`, `src/`)만 마운트한다. Vite는 LAN의 누구에게나 root 아래 파일을 보여 주기 때문이다.
- 개발과 테스트는 이 스택 하나로 한다. `docker/compose.yaml`은 운영 예시다(아래).

## 운영 배포 (이미지)

릴리스 이미지는 `ghcr.io/bluenyang/allot:<버전>`(정식 버전은 `latest`도)이고, linux/amd64용이다. Node 프로세스 하나가 화면과 API를 함께 서빙하며 포트는 3000이다. 시작할 때 마이그레이션을 적용한다. DB(PostgreSQL 16)는 따로 둔다.

```bash
cp docker/.env.example docker/.env   # DATABASE_URL, BETTER_AUTH_SECRET/URL, TRUSTED_ORIGINS, 운영 항목
docker compose -f docker/compose.yaml up -d
```

- `BETTER_AUTH_URL`은 브라우저로 여는 실제 주소다(예: `https://allot.example.com`).
- `TRUSTED_ORIGINS`에 같은 주소를 적는다(쉼표로 여러 개). 운영에서는 반드시 설정한다. 비워 두면 요청이 온 주소를 믿는 개발용 동작이다.
- **HTTPS(Traefik):** 예시 compose는 이미 떠 있는 Traefik(docker provider) 뒤에 앱을 둔다. 앱은 포트를 열지 않고 Traefik 네트워크(`TRAEFIK_NETWORK`)에 붙고, `ALLOT_HOST`·`TRAEFIK_ENTRYPOINT`·`TRAEFIK_CERTRESOLVER`를 그 Traefik의 이름에 맞춘다. 컨테이너는 읽기 전용, Linux capability 없이 돈다. Traefik을 쓰지 않으면 compose 파일의 주석대로 포트를 연다.
- 변경 내역은 기본으로 계속 쌓인다. `CHANGE_LOG_RETENTION_DAYS`(일)를 정하면 그보다 오래된 변경 묶음을 시작할 때와 하루 한 번 지운다.
- 로그인 시도 제한은 클라이언트 IP로 센다.
  - **Traefik 뒤:** `TRUSTED_PROXY_IP_HEADER=X-Real-IP`. Traefik이 클라이언트 주소로 이 헤더를 채운다. 앱 포트를 열지 않아 Traefik만 앱에 닿을 때만 안전하다.
  - **다른 리버스 프록시 뒤:** `APP_BIND=127.0.0.1`(기본값)로 두어 프록시만 앱에 닿게 하고, `TRUSTED_PROXY_IP_HEADER`에 그 프록시가 덮어쓰는 헤더(예: `X-Real-IP`)를 적는다. 프록시가 컨테이너라면 앱 포트를 공개하지 말고 같은 내부 네트워크로 연결한다.
  - **직접 접속:** `APP_BIND=0.0.0.0`으로 열고 `TRUSTED_PROXY_IP_HEADER`는 **비워 둔다**. 소켓 주소를 쓰고, 클라이언트가 보낸 헤더는 무시한다. 헤더를 믿도록 설정한 채 포트를 열면 누구나 헤더를 바꿔 제한을 피할 수 있다.
  - 프록시 뒤인데 헤더를 비워 두면 모든 접속이 프록시 IP 하나로 묶여 제한이 함께 걸린다(안전한 쪽).
- 첫 데이터: 스키마는 앱이 시작할 때 만들어진다. 그다음 시드 SQL(`targets`, `phases`, 계정 등)을 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <파일>`로 넣는다. 또는 개발 환경에서 `DATABASE_URL`을 운영 DB로 두고 `pnpm db:seed <데이터 파일>`을 실행한다.
- 패키지가 비공개로 만들어졌다면, 서버에서 `docker login ghcr.io`를 하거나 GitHub 패키지 설정에서 공개로 바꾼다.

### 전용 DB 롤

사용자 데이터는 앱의 조건과 PostgreSQL 행 수준 보안(RLS) 두 겹으로 사용자별로 나뉜다. RLS는 슈퍼유저나 `BYPASSRLS` 롤에는 적용되지 않는다. 앱은 그런 롤로 접속하면 시작할 때 `WARNING`을 남기고 그대로 동작한다(보호가 한 겹만 남는다). 다른 앱과 같이 쓰는 DB 서버라면 특히, Allot 전용 롤과 database를 둔다.

```sql
-- 슈퍼유저로 한 번 실행. 비밀번호는 직접 정한다.
CREATE ROLE allot LOGIN PASSWORD '<password>' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE DATABASE allot OWNER allot;
```

`DATABASE_URL=postgres://allot:<password>@<host>:5432/allot`. 앱이 이 롤로 테이블을 만들고(소유자), 마이그레이션이 RLS를 소유자에게도 강제(FORCE)한다. 이미 다른 롤로 만든 DB라면 `ALTER DATABASE allot OWNER TO allot;`과 각 테이블의 `ALTER TABLE … OWNER TO allot;`으로 옮긴다.

## 릴리스

GitHub Actions → **Allot Release** → Run workflow(수동 실행).

- 입력: `release_type`(patch·minor·major·rc), `version`(정확한 버전, 비우면 올림), `version_suffix`(예: `rc.1`), `dry_run`.
- 순서: 버전 계산 → (바뀌었을 때만) `package.json` 커밋 → 태그 → 게이트 → 이미지 푸시 → Release 초안.
- 먼저 `dry_run`으로 돌려 보고, 초안 Release를 확인한 뒤 공개한다.

## 분배 구조

월급이 어디로 가는지는 코드가 아니라 데이터로 정한다(분배 화면 → 구간 탭).

- **분배 대상**: 이름과 종류. 종류는 `생활비 합계`(생활비 항목의 합), `구독 이체액`(구독 필요 이체액을 올림 단위로 올림), `구간별 고정`(구간마다 정한 금액), `나머지 전부`(실수령에서 나머지를 뺀 금액). 생활비 합계·구독 이체액·나머지는 하나씩, 나머지는 꼭 하나.
- **구간**: 기간과, 고정 대상마다의 금액.
- **나머지 분배**: 나머지 금액을 비율로 나눈다. 마지막 항목이 남는 금액을 받는다.

시드 데이터 파일(`pnpm db:seed [파일]`)은 `targets`, `phases[].amounts`, `remainderSplit`을 포함한다.

## 명령

패키지 매니저는 **pnpm** (`packageManager: pnpm@12.18.0`, Node ≥ 24). pnpm은 `packageManager`를 보고 해당 버전으로 자동 전환한다.

```bash
pnpm install       # 의존성 설치 (CI: pnpm install --frozen-lockfile), git 훅(lefthook) 설치
pnpm typecheck     # vue-tsc + 서버 tsc — 게이트
pnpm build         # vite build → dist/ — 게이트
pnpm build:server  # 서버 번들 → dist-server/ (운영 이미지)
pnpm dev           # Vite만 (호스트에서), /api는 localhost:3000으로
pnpm dev:api       # API만 (호스트에서, DATABASE_URL 등 env 필요)
pnpm db:generate   # 스키마 변경 → drizzle/ 마이그레이션 생성
pnpm db:migrate    # 마이그레이션 적용
pnpm db:seed       # 처음 데이터 + 로그인 계정
pnpm e2e           # Playwright E2E (스택이 떠 있어야 함, 아래)
```

## 테스트

```bash
docker compose -f docker/compose.dev.yaml up -d --build -V --wait
docker compose -f docker/compose.dev.yaml exec api pnpm db:seed
BASE=http://<IP>:15173 ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm e2e              # UI: 모든 항목 추가·수정·삭제·새로고침
BASE=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/api/crud.mjs create      # API: create → (api 재시작) → verify → cleanup
```

E2E는 시스템 Chrome(`channel: 'chrome'`)을 쓴다. 로그인 시도는 1분에 5번으로 제한된다.

## 구조

- `src/` 프론트. 상태는 `src/lib/store.ts`가 API에서 읽고, 바꿀 때는 API에 먼저 저장한다.
- `src/lib/calc.ts` 순수 계산 함수 (서버와 공유).
- `server/` API: `app.ts`(라우팅·세션 확인), `routes.ts`(CRUD), `auth.ts`(Better Auth), `db/`(스키마·마이그레이션·시드).
- `drizzle/` 커밋된 SQL 마이그레이션.
