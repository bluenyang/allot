# Allot (0.1.0-rc.3)

월급 분배·구독·플랜 전환 일정 관리. 한 사람이 쓰는 웹앱.
Vue 3.5 + Vite 8 + TypeScript 6 / Hono API / PostgreSQL 16 (Drizzle ORM) / Better Auth 로그인.

## 개발 서버 (Docker, 기본)

모든 버전은 Docker로 개발 서버를 띄운다. 브라우저에서 `http://<이 컴퓨터 IP>:15173`으로 연다(같은 네트워크의 폰에서도 열린다).

```bash
cp docker/.env.example docker/.env      # 값 채우기 (비밀번호·BETTER_AUTH_SECRET 등)
docker compose -f docker/compose.yaml up -d --build -V
docker compose -f docker/compose.yaml exec api pnpm db:seed   # 처음 데이터 + 로그인 계정
```

- 서비스: `web`(Vite, 15173 공개), `api`(Hono, 내부 3000), `db`(PostgreSQL 16, 내부). 외부에 열리는 포트는 15173 하나다.
- `/api`는 Vite가 api 컨테이너로 넘긴다(같은 출처라 쿠키·CORS 설정이 필요 없다).
- 의존성이 바뀌면 `up -d --build -V`로 이미지와 `node_modules`를 새로 받는다.
- 마이그레이션은 api가 시작할 때 자동으로 적용된다.
- `pnpm db:seed [파일]`은 데이터 파일(기본 `.loctx/scripts/seed-data.ts`, 로컬 전용)을 id 기준으로 upsert하고, `ADMIN_EMAIL`/`ADMIN_PASSWORD`로 로그인 계정을 만든다(이미 있으면 비밀번호를 바꾸고 기존 세션을 끊는다). 회원가입은 막혀 있다.
- 계정은 하나뿐이다. 다른 이메일로 바꾸려면 `pnpm db:seed --replace-admin` — 예전 계정과 그 세션을 지운다.
- web 컨테이너에는 프론트 파일(`index.html`, `vite.config.ts`, `tsconfig.json`, `src/`)만 마운트한다. Vite는 LAN의 누구에게나 root 아래 파일을 보여 주기 때문이다.
- 테스트용 스택은 `docker/compose.dev.yaml`(값은 `docker/.env.dev`, 별도 DB 볼륨). 두 스택은 같은 포트를 쓰므로 하나씩 띄운다.

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
