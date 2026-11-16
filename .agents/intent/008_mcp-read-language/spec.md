---
intent: "008"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-16"
    words: "진행"
    rev: 244bb42
    note: "영어 금액 단위(₩1,234 / ₩1,234K / ₩123.4×10K)는 요약에 있었고 이 진행으로 받아들임."
summary_for_user: |
  API 키: Better Auth의 API 키 패키지(@better-auth/api-key 1.7.18)를 쓰고, 서버에는 SHA-256 해시만 남깁니다. 설정 › AI·연동에서 만들기·목록·폐기를 하고, 만료 없는 키는 관리자 설정(env 우선, 기본 OFF)으로 켜고 끕니다. OFF면 최대 1년이고, OFF로 바꾸는 순간 만료 없는 키는 1년 뒤 만료됩니다.
  MCP: 같은 서버의 /api/mcp에 Authorization: Bearer로 붙습니다. 도구 6개는 읽기 전용입니다(현황, 구독, 플랜 전환, 분배, 일정, 변경 내역). 키는 MCP에서만 통하고 다른 API에는 통하지 않습니다. 인증 실패는 모두 같은 401로 답하고, IP별 실패 제한과 키별 분당 제한을 둡니다. SDK는 @modelcontextprotocol/server 2.4.0입니다.
  언어: vue-i18n 11.4.20, 한국어·English. 계정 설정이 없으면 브라우저 언어를 따르고, 서버 오류 문구도 같은 언어로 냅니다. 영어의 금액 단위는 ₩1,234 / ₩1,234K / ₩123.4×10K로 씁니다(제가 정함, 바꾸려면 수정).
  작업 단위 8개(W-1~W-8), 검사 11개(V-1~V-11). claude.ai 커넥터의 고정 헤더는 일부 조직에만 열린 베타라, 휴대폰 연결은 0.1.10 계획대로 둡니다.
---
## 요구 해석
- S-1 API 키 (intent "바라는 결과" 1): 키는 사용자 자기 계정의 것이다. 이름(1~32자), 범위, 만료일을 정해 만들고, 원문은 만든 응답에 한 번만 담긴다. 서버에는 해시와 앞 6자(`start`, 목록에서 알아보기용)만 남는다. 목록에는 이름, 앞 6자, 범위, 만든 날, 만료일, 마지막 사용 시각이 나온다. 폐기하면 그 키는 바로 통하지 않는다. 한 사용자 키는 최대 10개.
- S-2 범위 (intent "에이전트가 정한 것" — 범위 값): `permissions = { mcp: ['read'] }`. 값 체계는 `mcp: read | write`로 두고, 0.1.3은 `read`만 발급한다.
- S-3 만료 (intent 질의서 3 "ON/OFF 가능하게 해. OFF면 최대 1년."): 서버 전체 설정 "만료 없는 키 허용"(기본 OFF). env `ALLOT_API_KEY_NO_EXPIRY=true|false`가 있으면 그 값이 이기고, 관리자 화면에서는 잠긴다(0.1.2 로그인 방식과 같은 규칙).
  - OFF: 만료 필수, 1~365일, 기본 90일.
  - ON: "만료 없음"도 고를 수 있다.
  - ON에서 OFF로 바뀌면(관리자 저장 또는 env로 서버 시작) 만료 없는 키는 그 시각 + 365일로 만료가 정해진다.
- S-4 키 관리 화면 (intent 2): 설정 › AI·연동 탭에 키 목록, 만들기 모달, 한 번만 보이는 원문(복사 버튼), 연결 안내(주소, Claude Code 명령 예, claude.ai·휴대폰은 0.1.10이라는 안내)를 둔다. LLM 키 등 기능 없는 칸은 그리지 않는다. 관리자 › "API 키" 탭에는 S-3 스위치만 둔다(사용자들의 키는 보여 주지 않는다).
- S-5 MCP 서버 (intent 3): `POST /api/mcp`, Streamable HTTP, 상태 없이(stateless, 세션 ID 없음) JSON 응답. `Authorization: Bearer <키>`로 인증한다. GET·DELETE는 405.
  - 인증: 키 확인 → 키의 사용자 → 계정 상태 `active`, 차단 아님 → 그 사용자로 `asUser`(RLS).
  - 키는 `/api/mcp`에서만 통한다: 키로 다른 `/api/*`를 부르면 401(세션이 아님). 브라우저 세션만으로 `/api/mcp`를 부르면 401.
  - 키 만들기·폐기·목록은 브라우저 세션에서만(키로 키를 다루지 못함, intent 제약).
- S-6 읽기 도구 (intent 3, 질의서 2 "제안대로"): 6개, 모두 `readOnlyHint: true`. 출력은 JSON 데이터(언어와 무관한 enum 값, ISO 날짜, 원 단위 정수).
  - `get_overview { month? }` — 그 달(기본 이번 달)의 기준 일정(조정된 날짜), 이체 계산(`transferAt`), 분배(`distributionAt`, `splitRemainder`), 그 달 결제와 플랜 전환. 설정(월급, 기준일, 환율)을 함께.
  - `list_subscriptions { status? }` — 구독, 이번 달 플랜(`planAt`), 월 환산(`monthlyKrw`), 다음 결제일(`nextOccurrence`).
  - `list_plan_changes {}` — 예약된 플랜 전환.
  - `get_allocation {}` — 분배 정의: 단계(phase)와 금액, 분배 대상, 나머지 나누기, 계좌, 부채.
  - `get_schedule { from?, months? (1~12, 기본 3) }` — 달마다 기준 일정, 결제, 플랜 전환, 계획 일정(plan_event), 확인 항목(check_item), 그 기간의 켜진 공휴일.
  - `list_changes { before?, beforeId?, limit? (1~50, 기본 20) }` — 변경 내역(`listSets`).
  - 설정 › 일반·테마(preference)와 공휴일 세트 정의는 넣지 않는다(질의서 2).
- S-7 같은 숫자 (intent "에이전트가 정한 것" — 기존 조회 로직): `/api/state`의 조회를 함수로 빼서(`server/state.ts`) 화면과 도구가 함께 쓰고, 계산은 `src/lib/calc.ts`·`holidays.ts`를 그대로 부른다.
- S-8 보안 (intent 제약): 원문 키는 저장·로그·오류·변경 내역에 남기지 않는다. 인증 실패는 이유와 상관없이 같은 401(`WWW-Authenticate: Bearer`). IP별 실패 제한(10분에 20번 → 429), 키별 요청 제한(분당 120). 본문 64KB 제한. `Host`는 `BETTER_AUTH_URL`·`TRUSTED_ORIGINS`의 호스트만(설정된 경우), `Origin`이 있으면 신뢰된 출처만. 관리자 기능·로그인 설정은 도구로 닿지 않는다.
- S-9 화면 언어 (intent 4, 질의서 4 "ㅇㅇ"): 한국어·English. `preference.language`(`ko` | `en` | null). null이면 브라우저 언어(`en`으로 시작하면 English, 아니면 한국어). 로그인 전 화면은 브라우저 언어 → 마지막으로 쓴 언어(이 브라우저의 localStorage). `<html lang>`도 바꾼다.
- S-10 서버 문구 (S-9에서 PM 해석): 화면에 나오는 서버 오류 문구(지금 한국어 약 90줄)도 같은 언어로. 화면이 `Accept-Language: ko|en`을 보내고 서버는 문구 목록(`server/messages.ts`)에서 고른다. MCP 도구 설명과 오류는 영어로 고정.
- S-11 함께 싣는 것 (intent 5): esbuild 보안 수정(6937d61)과 게이트 갱신(69c53b9, 7572d85)을 CHANGELOG 0.1.3에 적는다.

## 설계
### API 키 저장
- 의존성: `@better-auth/api-key@1.7.18`(정확한 버전; peer `better-auth ^1.7.18`, 2026-11-05 공개). better-auth는 1.7.18 그대로.
- 플러그인 설정(`server/auth.ts`):
  - `defaultPrefix: 'allot_'`, 해시는 기본값(SHA-256 → base64url).
  - `enableSessionForAPIKeys: false`.
  - `permissions.defaultPermissions: { mcp: ['read'] }`.
  - `keyExpiration: { defaultExpiresIn: 90일, minExpiresIn: 1, maxExpiresIn: 365 }` — "만료 없음"은 우리 라우트가 정책을 보고 `expiresIn: null`로 넘긴다(플러그인은 null을 허용).
  - `rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 }` — 이 값이 있어야 `lastRequest`가 기록된다(조사: 창이 null이면 기록 안 될 수 있음, V-2에서 확인).
- 플러그인의 클라이언트용 경로(`/api/auth/api-key/*`)는 닫는다(`CLOSED_PATHS`처럼 before 훅에서 404). 만들기·목록·폐기는 우리 라우트가 서버 쪽 `auth.api.*`를 부른다 — 정책 검사와 zod 검증을 한곳에서(AGENTS.md: 본문은 zod).
- 스키마: `server/db/auth-schema.ts`에 `apikey` 표(플러그인 열 그대로), `pnpm db:generate`. 인증 표라 RLS는 없다(`session`과 같음); 우리 라우트는 항상 `referenceId = 세션 사용자`로 거른다.
- 관리자 완전 삭제(`DELETE /api/admin/users/:id`)는 그 사용자의 `apikey`를 함께 지운다. 차단·승인 대기 계정의 키는 S-5 인증에서 막힌다(키는 남김).

### 정책 설정
- 새 표 `app_setting`(id text PK, `value` jsonb, `updated_at`, `updated_by`) — 전역 설정, RLS 없음(`auth_provider`와 같은 성격). 행 `api_keys` = `{ noExpiry: boolean }`.
- `server/api-key-policy.ts`: 기본값(OFF) ← DB ← env. 값의 출처(`default | db | env`)를 함께 낸다.
- ON → OFF 처리 `applyExpiryCap()`: `expiresAt is null`인 키에 `now() + 365일`. 관리자 저장 때와 서버 시작 때(정책이 OFF면) 부른다. 같은 트랜잭션에서.

### API
- `GET /api/keys` — 내 키 목록(원문·해시 없음). 응답에 정책(`noExpiry`)도.
- `POST /api/keys` `{ name, expiresInDays: 1..365 | null }` — null은 정책 ON일 때만, 아니면 400. 10개 넘으면 400. 응답 `{ key, item }` — `key`는 이때만.
- `DELETE /api/keys/:id` — 내 키만(남의 id면 404).
- `GET /api/admin/api-keys` / `PUT /api/admin/api-keys { noExpiry }` — env가 정했으면 PUT은 409(잠김).
- 이 라우트들은 세션 미들웨어 뒤에 있다. 키로 오면 세션이 없으니 401.

### MCP
- 의존성: `@modelcontextprotocol/server@2.4.0`(2026-10-23, zod ^4.2). `WebStandardStreamableHTTPServerTransport`를 Hono 라우트에서 `c.req.raw`로 바로 쓴다(어댑터 패키지 없음). 대안 `@modelcontextprotocol/sdk@1.32.2`는 express·cors 등 쓰지 않는 의존성을 끌고 와서 고르지 않았다. 2.x가 맞지 않으면 1.32.2로 바꾸고 A-n에 적는다.
- `server/mcp/index.ts`: `app.post('/mcp', …)`를 `app.ts`의 세션 미들웨어 **앞**에 둔다. 요청마다 서버·전송 객체를 새로 만든다(stateless; 사용자 문맥이 요청에 묶임).
- 인증 순서: IP 실패 제한 확인 → `Bearer` 꺼내기 → `auth.api.verifyApiKey({ body: { key, permissions: { mcp: ['read'] } } })` → 사용자 상태 확인 → 도구 실행은 `asUser(uid, …)`. 실패는 모두 `401 { error: 'unauthorized' }`이고 실패 횟수만 센다. IP는 `clientIp(c)`(app.ts) 그대로.
- 실패 제한은 메모리(프로세스 하나 전제, 재시작 시 초기화) — 운영 이미지는 한 프로세스.
- `server/mcp/tools.ts`: 도구 6개. 입력은 zod, 출력은 `structuredContent` + 같은 JSON의 text. 계산은 `server/state.ts`의 `readState(q, uid)` 결과에 `calc.ts` 함수를 적용하는 순수 함수(`server/mcp/views.ts`)로 — 단위 테스트가 DB 없이 돈다.
- 로그: 요청 로그에 `Authorization`을 남기지 않는다(지금 로거 확인, 남기는 곳이 있으면 지운다).
- 프록시: 개발은 Vite가 `/api`를 넘기니 그대로. 운영 예시(`compose.yaml`, Traefik)는 경로를 가리지 않아 바꿀 것 없음 — 문서에만 적는다.

### 화면
- 설정 탭: 일반 · 테마 · AI·연동 · 로그인·보안. `src/pages/SettingsAi.vue`: 키 표(`EditSheet` + `useEditor`로 만들기 모달), 만료 선택(30·90·180·365일, 정책 ON이면 "만료 없음"), 원문 표시 상자(한 번, 복사, 닫으면 다시 볼 수 없다는 문구), 연결 안내(`${location.origin}/api/mcp`, `claude mcp add --transport http allot <주소> --header "Authorization: Bearer <키>"`).
- 관리자 탭 "API 키": 스위치 하나, env 잠김 표시(로그인 방식 탭과 같은 모양).

### 언어
- 의존성: `vue-i18n@11.4.20`(전체 esm-bundler 빌드 — `new Function` 없음, CSP 안전). unplugin 없이 TS 객체.
- `src/i18n/ko.ts`(기준), `src/i18n/en.ts`(`satisfies Messages` — 키가 빠지면 typecheck 실패), `src/i18n/index.ts`(`createI18n({ legacy: false })`, 언어 고르기 규칙 S-9).
- 화면 문구를 모두 옮긴다(지금 한국어가 들어간 줄 약 750, 그중 화면 쪽 약 660). 옮길 것: `src/pages/*`, `src/components/*`, `src/App.vue`, `src/Root.vue`, `src/lib/*`의 화면 문구(`auth-ui.ts`, `format.ts`, `view.ts`, `calendar-events.ts` 등), `src/data/types.ts`의 표시 이름. `src/data/holidays-kr.ts`는 공휴일마다 영어 이름을 더한다.
- `calc.ts`는 순수 유지: `won`·`man` 같은 표시 함수는 이미 쓰는 곳을 확인해 `format.ts`(언어를 받는 함수)로 옮기거나 그대로 둔다 — 계산 함수는 건드리지 않는다.
- 금액 단위(PM이 정함, 바꾸려면 수정): 한국어는 지금 그대로. English는 `₩1,234`(원), `₩1,234K`(천원), `₩123.4×10K`(만원), 설정의 선택지 이름은 "Won / Thousand / ×10,000". 날짜 형식·음수 표기는 그대로(intent "하지 않을 것").
- 저장: `preference.language` 열(text, null 허용) + 마이그레이션, zod `'ko' | 'en' | null`, `DEFAULT_PREFERENCES.language = null`. 설정 › 일반 맨 위에 "언어" 선택(브라우저 따라가기·한국어·English). 바꾸면 바로 적용되고 서버에 저장.
- 서버 문구: `server/messages.ts`에 `ko`·`en` 목록, `msg(c, key, vars?)`가 `Accept-Language`로 고른다(없거나 모르면 `ko`). `src/lib/api.ts`가 현재 언어를 헤더로 보낸다.

### 문서
- `CHANGELOG.md` 0.1.3: MCP 읽기, API 키, 언어, esbuild(GHSA-67mh-4wv8-2f99), 게이트.
- `README.md`: MCP 연결(Claude Code 명령, Claude Desktop은 `mcp-remote` 같은 stdio 중계가 필요하다는 안내 — 공식 문서가 아닌 관행이라고 밝힘, claude.ai·휴대폰은 0.1.10), 새 env `ALLOT_API_KEY_NO_EXPIRY`(`.env.example`에 주석과 함께 — 비밀값 아님).
- `docs/ROADMAP.md` 상태 줄.

## 작업 단위
- [x] W-1 키 저장과 정책: 의존성(`@better-auth/api-key@1.7.18`), `auth-schema.ts`의 `apikey`, `app_setting` 표, `pnpm db:generate`, 플러그인 설정과 클라이언트 경로 닫기, `server/api-key-policy.ts`(기본값 ← DB ← env, `applyExpiryCap`, 시작 시 호출), 관리자 완전 삭제가 키를 지움, `.env.example`. (S-1, S-2, S-3) (commits 62f819f, 3a46422)
- [x] W-2 키 API: `/api/keys` GET·POST·DELETE, `/api/admin/api-keys` GET·PUT, zod, `tests/api/api-keys.mjs`. (S-1, S-3, S-5의 "세션에서만") (commit 9254391)
- [x] W-3 MCP 경로와 인증: 의존성(`@modelcontextprotocol/server@2.4.0`), `server/state.ts`로 `/api/state` 조회 빼기(응답 같음), `server/mcp/index.ts`(인증, 실패 제한, Host·Origin, 본문 제한, stateless 전송), 로그 확인. 도구는 아직 없음(`tools/list`가 빈 목록). (S-5, S-7, S-8) (commits 0f9e4d5, 9a2f82e)
- [x] W-4 읽기 도구: `server/mcp/views.ts`(순수), `server/mcp/tools.ts`(6개), 단위 테스트 `tests/unit/mcp-views.test.ts`, API 검사 `tests/api/mcp.mjs`(SDK 클라이언트로 인증·도구·격리). (S-6, S-7) (commit 3636b77)
- [x] W-5 화면: 설정 › AI·연동(`SettingsAi.vue`), 관리자 "API 키" 탭, store·api, E2E `tests/e2e/api-keys.spec.ts`. (S-4) (commits d63645b, 7768511)
- [x] W-6 언어 구조: `vue-i18n@11.4.20`, `src/i18n/*`, 언어 고르기, `preference.language` 열·마이그레이션·zod·defaults, 설정 › 일반의 언어 선택, `<html lang>`, `api.ts`의 `Accept-Language`, `server/messages.ts`와 서버 문구 옮기기, 키 비교 단위 테스트 `tests/unit/i18n.test.ts`. 이 W에서는 셸(사이드바·헤더·푸터)·설정 › 일반·로그인 화면 문구만 옮긴다. (S-9, S-10) (commits c49f8bd, 10c660d)
- [x] W-7 나머지 화면 문구: 남은 `src/pages/*`, `src/components/*`, `src/lib/*` 문구, `types.ts` 표시 이름, 공휴일 영어 이름, 영어 금액 단위(`format.ts`), W-5 화면 문구. 화면마다 커밋. 한글이 남은 곳 검사 스크립트 `scripts/check-i18n.mjs`(허용 목록: `src/i18n/ko.ts`, 공휴일 데이터, 주석). (S-9) (commits d27d710 공통 lib·단위·열거 이름, 35a7dd8 현황, 7f0bf69 구독, 05ef1ca 월급 분배, a1c3163 일정, a66d567 변경 내역, e6d93ff 계정, 023f5b3 개발, 2db0c3c 테마, 8913a89 AI·연동, f9450ec 관리, 2d884ef calc 정리, 97b7c7f 검사 스크립트, 1ae27ae·bb9e02b E2E 분리)
- [ ] W-8 문서: CHANGELOG, README, ROADMAP. (S-11)

## 검증 기준
모든 출력은 `.loctx/reports/0.1.3/test/`에 명령·rev·종료 코드와 함께 남긴다(파이프로 종료 코드를 가리지 않음, 첫 실패에서 멈춤).
- V-1 게이트: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build && pnpm build:server && pnpm test:unit` 모두 exit 0. `pnpm build`의 첫 화면 JS gzip 크기를 적는다. 기대: master(6937d61) 대비 증가 40kB 이하. 넘으면 원인을 적고 묻는다.
- V-2 키 수명 (`node tests/api/api-keys.mjs`, dev 스택):
  - 만들면 응답에만 원문이 있고, 목록·`GET /api/keys`에는 원문과 해시가 없다. DB `apikey.key`는 원문의 SHA-256 base64url과 같고, DB 전체 덤프(`pg_dump --data-only`)에서 원문이 나오지 않는다.
  - 정책 OFF: `expiresInDays` 없음 → 90일, 366 → 400, null → 400. 11번째 키 → 400.
  - 정책 ON: null → 만료 없음.
  - MCP를 한 번 부른 뒤 목록의 마지막 사용 시각이 채워진다.
  - 폐기한 키, DB에서 `expires_at`을 과거로 바꾼 키 → MCP 401.
  - 남의 키 id로 DELETE → 404. 키를 Bearer로 `/api/keys` → 401.
  - 실패 모습: 위 중 하나라도 다르면 실패.
- V-3 정책: 정책 ON에서 만료 없는 키를 만들고 OFF로 저장 → 그 키의 `expires_at`이 저장 시각 + 365일(±1분). env `ALLOT_API_KEY_NO_EXPIRY=false`로 api를 다시 띄우면 PUT → 409, 화면에 잠김 표시, 시작 때 만료 없는 키가 다시 365일로 정해진다.
- V-4 MCP 인증 (`node tests/api/mcp.mjs auth`): 헤더 없음·틀린 키·폐기·만료·차단된 계정의 키·승인 대기 계정의 키가 모두 같은 상태와 본문(401, `{"error":"unauthorized"}`). 같은 IP에서 21번째 실패 → 429. 세션 쿠키만으로 `/api/mcp` → 401. 키로 `/api/state` → 401. GET `/api/mcp` → 405. 65KB 본문 → 413. 신뢰되지 않은 `Origin` → 403.
- V-5 격리 (`node tests/api/mcp.mjs isolation`, `isolation.mjs` 방식): 사용자 A·B에 서로 다른 표시 이름의 데이터를 넣고, A의 키로 도구 6개를 모두 부른다 — 결과에 B의 이름·id가 없다. B도 반대로.
- V-6 도구: `tools/list`가 정확히 6개, 모두 `readOnlyHint: true`, 이름이 S-6과 같다. 시드한 테스트 계정에서 `get_overview`의 이번 달·3개월 뒤 값이 같은 데이터로 `calc.ts`를 직접 부른 값과 같다(단위 테스트 + API 검사). 모르는 도구 → MCP 오류. 쓰기 도구 없음.
- V-7 로그에 키 없음: V-2~V-6 뒤 `docker compose -f docker/compose.dev.yaml logs api`에서 V-2~V-6에 쓴 키 원문(그리고 `allot_` 다음 글자 20자 이상)이 나오지 않는다. 출력은 파일로 쓰기 전에 화면에서 확인한다(env 값 규칙).
- V-8 언어:
  - `tests/unit/i18n.test.ts`: en·ko의 키가 같고, 빈 값이 없고, 변수 자리(`{n}` 등)가 같다.
  - `node scripts/check-i18n.mjs`: 허용 목록 밖에 한글이 없다(exit 0).
  - E2E `tests/e2e/i18n.spec.ts`: 설정 › 일반에서 English → 사이드바·페이지 제목이 영어, `html[lang=en]`, 새로고침 뒤에도 영어(서버 저장). 로그아웃 → 로그인 화면이 English. 새 브라우저 문맥 `locale: 'en-US'` → 로그인 화면 English, `ko-KR` → 한국어. English 상태에서 잘못된 입력 저장 → 서버 오류 문구가 영어. 금액 단위 세 가지의 영어 표기.
- V-9 기존 동작: 0.1.2의 E2E 전부(`pnpm e2e`)와 `tests/api/*.mjs`가 통과(기본 한국어, 문구 그대로). `/api/state` 응답이 W-3 전후로 같다(시드 계정, JSON 비교).
- V-10 실제 클라이언트: dev 스택에서 Claude Code로 `claude mcp add --transport http allot http://<host>:15173/api/mcp --header "Authorization: Bearer <키>"` → 도구 목록 6개, `get_overview` 호출 결과를 적는다(값은 적지 않고 성공 여부와 필드 이름만). 이 기기에서 `claude` CLI를 쓸 수 없으면 rc 서버에서 사용자가 한다고 적는다.
- V-11 rc 테스트 서버: rc 이미지를 `allot-rc`(:13000)로 올려 마이그레이션 적용, 테스트 계정으로 키 만들기 → MCP `tools/list`·`get_overview` 성공, 언어 English 전환 확인.

## 조정 기록
- A-1 (2026-11-16, W-1) 플러그인 `keyExpiration.defaultExpiresIn`을 두지 않고, 만료 기본값 90일은 `POST /api/keys`가 정한다 · 플러그인은 `expiresIn: null`을 `defaultExpiresIn`으로 바꿔 "만료 없음"을 만들 수 없다(`expiresIn ? … : defaultExpiresIn ? … : null`). 최소 1일·최대 365일은 플러그인 설정 그대로 · 62f819f
- A-2 (2026-11-16, W-1) 목록용 `start`를 앞 6자가 아니라 앞 12자로 저장(`startingCharactersConfig.charactersLength: 12`) · 접두어 `allot_`가 6자라 앞 6자는 모든 키가 같다(접두어 + 임의 6자). 임의 부분 6자가 드러나도 키 공간은 52^64 · 3a46422
- A-3 (2026-11-16, W-3·W-4) MCP 검사(`tests/api/mcp.mjs`)는 SDK 클라이언트(`@modelcontextprotocol/client`) 없이 JSON-RPC를 fetch로 직접 보낸다 · 서버 SDK만 의존성으로 두고 검사 때문에 의존성을 더하지 않으려고. 응답 모양은 같다 · 9a2f82e, 3636b77
- A-4 (2026-11-16, W-3) Host 검사는 `TRUSTED_ORIGINS`가 있을 때만(그 호스트 + `BETTER_AUTH_URL` 호스트), 없으면(개발) Origin이 있을 때 요청의 Host와 같아야 통과. 키별 요청 제한(분당 120 초과)은 같은 401이 아니라 429 · "설정된 경우"의 해석: 개발 스택은 LAN 주소가 여러 개라 Host를 고정할 수 없다. 429는 유효한 키에게만 보이는 답이라 키 존재를 새로 알리지 않는다 · 9a2f82e
- A-5 (2026-11-16, W-5) 키 만들기 모달은 `useEditor` 대신 `EditSheet`와 화면 안 상태로 만든다 · `useEditor`는 `store`의 목록(`ListKey`)용이고 키는 스토어에 두지 않는다(원문이 한 번만 보임) · d63645b
- A-6 (2026-11-16, W-6) 로그인 전 화면의 언어는 "이 브라우저에서 마지막으로 고른 언어(localStorage) → 브라우저 언어" 순이다(S-9 문구는 반대 순서) · 로그아웃 뒤 로그인 화면이 계정에서 고른 English로 남아야 하는데(V-8), 브라우저 언어를 먼저 보면 한국어 브라우저에서 항상 한국어가 된다. 계정이 "브라우저 따라가기"(null)면 저장값을 지워 브라우저 언어가 이긴다 · 10c660d
- A-7 (2026-11-16, W-6) `preferences.language`는 zod에서 선택 항목이다(없으면 저장된 값을 둠, `dayShift`와 같은 방식) · language를 모르는 클라이언트와 0.1.2의 `tests/api/preferences.mjs`가 그대로 통하게. 그 검사는 `language: 'en'`을 넣고 `Accept-Language`별 메시지를 확인하도록 고쳤다 · c49f8bd, 1ae27ae
- A-8 (2026-11-16, W-6) 서버에서 깊은 곳(검사 함수, 되돌리기 오류, 공휴일 규칙, 로그인 방식 문제)이 던지는 문구는 문자열 대신 메시지 참조(`Msg`/`MsgError`, 공휴일은 `{code, vars}`)를 실어 올리고 라우트가 요청 언어로 푼다. zod 메시지는 `server/messages.ts`의 키이고 `server/body.ts`가 요청마다 푼다(세 라우터의 같은 검사기를 하나로) · 스키마를 언어마다 두지 않으려고 · c49f8bd
- A-9 (2026-11-16, W-6) Better Auth 훅(로그인 방식 거부)의 문구는 요청의 `Accept-Language`로 고르고, 세션 만들기 훅의 PENDING_APPROVAL은 한국어로 둔다(요청이 없는 자리). 화면은 어차피 오류 코드로 문구를 고른다(`authMessage`) · c49f8bd
- A-10 (2026-11-16, W-6) 공용 `EditSheet`의 문구(닫기·취소·저장·삭제)와 `notReady`를 부르는 현황·구독의 네 곳은 W-6에서 함께 옮겼다 · 셸과 설정 › 일반이 같은 컴포넌트를 쓰고, `notReady`가 메시지 키를 받도록 바뀌어 타입 검사가 통해야 해서 · 10c660d
- A-11 (2026-11-16, W-7) `calc.ts`의 표시 함수 `won`·`man`은 어디서도 쓰이지 않아 지웠다(단위 붙은 금액은 `format.ts`의 `wonText`·`manText`). `distributionAt`의 `detail`은 사용자 메모만 담고, 메모가 없을 때의 기본 문구("생활비 항목 합계" 등)는 `labels.ts`(`kindDetail`)가 언어에 맞게 낸다 · `calc.ts`는 서버가 쓰는 순수 계산으로 둠(서버는 `detail`을 쓰지 않음) · d27d710, 2d884ef
- A-12 (2026-11-16, W-7) `check-i18n.mjs` 허용 목록에 `src/data/types.ts`·`src/lib/labels.ts`(저장된 한국어 일정 분류 코드), `src/lib/holidays.ts`·`holiday-names.ts`(대체공휴일 이름), `src/i18n/en.ts`(언어 목록의 "한국어")를 더했다 · 모두 데이터나 저장 값이지 화면 문구가 아님 · 97b7c7f
- A-13 (2026-11-16, W-7) 색 프리셋(`theme.ts`)은 한국어 이름 대신 id(green, teal…)를 갖고 이름은 메시지에서 · 이름이 화면 문구라서 · 2db0c3c
- A-14 (2026-11-16, W-7) 로그아웃 뒤 로그인 화면 E2E는 새로 로그인하지 않고 공유 세션을 마지막에 로그아웃하는 `tests/e2e/zz-i18n-signout.spec.ts`(파일 이름이 맨 뒤로 가게)로 두었고, `global-setup`의 로그인 문맥은 `locale: 'ko-KR'`로 고정했다(Playwright 기본은 en-US라 이제 로그인 화면이 영어) · 로그인 시도 제한이 분당 5회라, 로그인을 하나 더 하면 뒤쪽 V-14 a, b가 429를 받았다(트레이스로 확인) · bb9e02b

## 우려
- 플러그인의 클라이언트 경로 목록이 버전마다 다를 수 있다 — 닫을 때 경로를 하나씩 적지 않고 `/api-key/` 접두로 막고, V-2에서 `/api/auth/api-key/create`·`list`·`delete`·`update`가 막힌 것을 확인한다.
- `@modelcontextprotocol/server` 2.x는 1.x보다 쓰는 곳이 적다. 맞지 않으면 1.32.2로 바꾼다(설계 MCP).
- Claude Desktop은 원격 커넥터가 claude.ai 규칙을 따라 헤더를 못 넣는다. 로컬 중계(`mcp-remote`)는 공식 문서가 아니다 — README에 그렇게 밝힌다.
- 영어 번역은 PM·구현 모델이 쓴다. 금융 용어가 어색할 수 있어 rc에서 사용자 확인을 받는다.
- 문구 옮기기(W-7)는 양이 많다. 화면마다 커밋해 되돌릴 수 있게 하고, E2E 선택자가 한국어 문구에 기대는 곳은 그대로 둔다(기본 한국어).
- 키를 만들 때 다시 로그인을 요구하지 않는다(OIDC 사용자에게 무겁다). 세션을 빼앗기면 키를 만들 수 있다는 위험은 지금 세션 수명 정책을 따른다.

## 범위 밖
- 쓰기 도구, 미리보기·확인, AI 변경 되돌리기(0.1.4). 키 만들기·폐기는 변경 내역에 남기지 않는다(데이터가 아니라 인증 정보, 되돌리기 대상 아님).
- OAuth 기반 MCP(0.1.10), 상태 있는 MCP 세션, SSE 알림.
- 관리자가 다른 사용자의 키를 보거나 폐기하는 화면(완전 삭제 때 지우는 것만).
- 두 언어 밖의 번역, 날짜·음수 형식 변경.
