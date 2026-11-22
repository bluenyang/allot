---
intent: "012"
status: draft
approvals: []
summary_for_user: |
  주소에서 `#`를 뺍니다: `/spend/general`, `/settings/ai`처럼 지금 해시와 같은 이름이고, 첫 화면은 `/`(현황, `/home`도 `/`로)입니다. vue-router 5.5.1(history 모드) 하나를 정확한 버전으로 들입니다.
  예전 주소는 모두 같은 화면으로 이어 줍니다: `#home`·`#subs`·`#subs?add`·`#spend/<탭>?add`·`#settings/<탭>`·`#account` 등은 열 때나 주소창에서 바꿀 때 새 주소로 바뀌고(기록에 두 번 남지 않게 replace), `?error=` 같은 질의는 따라갑니다. 외부 로그인 연결은 이제 `/settings/security`로 돌아오고, 예전 `/#account`도 그대로 됩니다. 모바일 앱의 `#app-login`은 건드리지 않습니다.
  화면·저장·KeepAlive 상태 유지·탭 떠날 때 편집기 닫기·지연 로드와 불러오기 실패 안내·스크롤 맨 위·뒤로/앞으로는 지금과 같게 둡니다. 서버는 API가 아닌 경로에 앱을 돌려주는 처리가 이미 있어 단위 테스트로 굳히기만 합니다.
  PM 결정: 첫 화면 JS 증가 한도 +15 kB(gzip, 0.1.5와 같음), 모르는 경로는 현황으로, 탭이 없거나 틀린 `/spend`·`/settings`는 기본 탭 주소로. 버전 표기 밀기(0.1.10→0.1.11 등)도 넣습니다.
  작업 단위 7개(W-1~W-7), 검사 9개(V-1~V-9). 기준 E2E 실패(따로 하기로 함)는 master 이미지로 먼저 재 두고, 그 밖의 실패만 회귀로 봅니다.
---
## 요구 해석
- S-1 경로 표 (intent 바라는 결과 1; 열린 질문 2 "해시와 같은 이름"):

  | 화면 | 새 주소 | 예전 해시 |
  |---|---|---|
  | 현황 | `/` (`/home`은 `/`로 replace) | 없음, `#home`, 모르는 해시 |
  | 월급 분배 | `/pay` | `#pay` |
  | 지출 | `/spend/general`·`/spend/inst`·`/spend/subs` | `#spend/<탭>`, `#spend`(→general), `#subs`(→subs) |
  | 일정 | `/events` | `#events` |
  | 대기 중인 변경 | `/pending` | `#pending` |
  | 변경 내역 | `/history` | `#history` |
  | 설정 | `/settings/general`·`theme`·`ai`·`security` | `#settings/<탭>`, `#settings`(→general), `#account`(→security) |
  | 관리 | `/admin` | `#admin` |
  | 개발 | `/dev` (메뉴 없음, 지금처럼) | `#dev` |

  - `/spend`·`/settings`처럼 탭이 없거나 모르는 탭이면 기본 탭 주소로 replace한다(PM 결정: 지금은 주소가 그대로이고 화면만 기본 탭이다. 새 주소는 화면과 짝이 맞게 한다).
  - 모르는 경로(`/foo`)는 현황을 보여 주고 주소는 `/`로 replace한다(지금 모르는 해시가 현황인 것과 같다).
  - 월급 분배 안의 탭(분배·계좌 등)은 지금처럼 주소에 넣지 않는다.
- S-2 예전 해시 넘기기 (intent 바라는 결과 2, 에이전트가 정한 것 "클라이언트에서 넘긴다"):
  - 순수 함수 `fromOldHash(hash)`(새 파일 `src/lib/old-hash.ts`)가 해시를 `{ path, query } | null`로 바꾼다. 위 표의 해시면 새 주소, `#app-login…`과 그 밖의 해시는 `null`(손대지 않음).
  - 라우터의 `beforeEach`에서 `to.hash`에 이 함수를 쓴다. 처음 열 때, 주소창에서 해시를 바꿀 때(popstate), 앱 안에서 해시로 갈 때가 한곳에서 처리된다. 결과는 replace라 기록이 두 번 남지 않는다.
  - 해시의 질의 `?add`는 새 주소의 질의로 옮긴다(`#subs?add` → `/spend/subs?add`, `#spend/inst?add` → `/spend/inst?add`). 해시 앞 경로의 질의(`/?error=…#account`의 `error`)도 그대로 따라간다. 둘 다 있으면 둘 다 남긴다.
  - 해시는 `/`가 아닌 경로에 붙어 있어도 표에 있으면 넘긴다(주소창에 `#settings/ai`를 쳐도 되게).
- S-3 질의로 여는 창 (intent 계획 "`?add`처럼 화면을 여는 질의"):
  - 새 형태: `/spend/general?add`·`/spend/inst?add`·`/spend/subs?add`. 지출 페이지가 `route.query.add`를 보고 창을 연 뒤 `router.replace`로 `add`만 뺀다(지금 `replaceState`로 해시를 지우는 것과 같은 동작).
  - 기록 추가 창(`AddRecordModal`)의 "구독"·"일회성 지출"은 `router.push('/spend/subs?add')`·`router.push('/spend/general?add')`.
  - 지금 받는 형태 `#subs?add`, `#spend/<탭>?add`, 그리고 `add`가 다른 질의와 함께 있는 `?x=1&add`도 그대로 연다(지금 정규식 `(.*&)?add\b`와 같게: 질의에 `add` 키가 있으면 연다).
- S-4 동작은 그대로 (intent 바라는 결과 3):
  - 페이지 상태 유지: `<RouterView v-slot>` 안에 `<KeepAlive>`, 키는 지금처럼 페이지(탭이 아님). 설정·지출은 지금처럼 `sub`(탭)를 prop으로 받는다.
  - 지연 로드와 불러오기 실패 안내(spec 010 A-24, `PageLoadError`): 경로의 컴포넌트는 지금의 `defineAsyncComponent`를 그대로 쓴다(vue-router의 지연 경로로 바꾸지 않는다 — 그러면 실패가 내비게이션 오류가 되어 안내가 사라진다).
  - 탭을 옮길 때 편집기 닫기(spec 011 A-13): 지출의 구독 탭 `KeepAlive`와 `onDeactivated`는 그대로.
  - 화면 맨 위로: 지금은 해시가 바뀔 때마다(뒤로/앞으로 포함) 맨 위로 간다. `scrollBehavior`가 늘 `{ top: 0 }`를 돌려준다. 질의만 빼는 replace(S-3)는 이미 맨 위라 달라지지 않는다.
  - 휴대폰 아래 막대·더보기 시트의 선택 표시와 닫기(주소가 바뀌면 닫힘)는 라우트에서 같은 값으로 계산한다.
  - 링크: 템플릿의 `href="#…"`는 모두 `<RouterLink>`로, `location.hash = …`는 `router.push`로. 페이지의 `hashchange` 듣기는 없앤다.
- S-5 로그인 돌아오기 (intent 바라는 결과 2):
  - 외부 로그인 연결(`Account.vue` link)의 돌아오기는 `${origin}/settings/security`로 바꾼다. 예전 `/#account`(이미 떠난 연결, 북마크)는 S-2로 `/settings/security`가 된다. 오류로 돌아온 `/?error=…#account`는 `/settings/security?error=…`가 되고, 계정 화면이 지금처럼 오류를 보여 준 뒤 주소에서 지운다.
  - 로그인 화면의 외부 로그인은 지금처럼 그 주소(`location.href`)로 돌아온다. 이제 `/spend/subs` 같은 깊은 주소에서도 그 주소로 돌아온다.
  - 서버의 오류 주소(`server/auth.ts` `errorURL` = `/`)는 그대로.
  - `takeErrorFromUrl`의 `history.replaceState(null, …)`는 vue-router가 쓰는 `history.state`를 지운다. 상태를 그대로 넘기게(`history.state`) 고친다. 보이는 동작은 같다.
  - 모바일 앱 돌아오기(spec 006 S-6, `#app-login?return=…`, `Root.vue`)는 해시 그대로 둔다. README가 앱과의 약속으로 적어 둔 주소이고, S-2가 `null`을 돌려 손대지 않는다.
- S-6 서버와 개발 서버 (intent 바라는 결과 4):
  - `server/app.ts`의 `serveStatic` 뒤 `get('*')` → `index.html`은 이미 있다. 바꾸지 않고, 단위 테스트로 굳힌다: `/settings/ai`·`/spend/subs`는 `index.html`, `/api/없는것`은 JSON 404, `/healthz`는 JSON, `/assets/<있는 파일>`은 그 파일.
  - `index.html`과 빌드 결과의 자원 주소는 `/assets/…`(절대)라 깊은 주소에서도 깨지지 않는다. 빌드 결과에 상대 주소가 없음을 V-3에서 본다.
  - Vite 개발 서버는 기본 `appType: 'spa'`로 이미 같은 처리를 한다. 설정은 바꾸지 않고 V-4로 확인한다.
  - `/api/*`(인증 `/api/auth/*`, MCP `/api/mcp` 포함)와 `/healthz`의 응답은 바뀌지 않는다.
- S-7 버전 표기 밀기 (intent 바라는 결과 5):
  - 화면 문구 ko·en `later`(MCP OAuth) 0.1.10 → 0.1.11, README 108줄 0.1.10 → 0.1.11.
  - 코드 주석 "0.1.6 adds 'buffer'"·`// 0.1.6`(`types.ts`, `SpendEditor.vue`, `SpendInstallments.vue`) → 0.1.7. `server/token-crypto.ts`의 "0.1.7, the first reader"(Gmail 명세서 = 거래 패치) → 0.1.8.
  - 출시된 CHANGELOG 항목은 그대로 둔다.
  - README 145줄의 "`#subs` 같은 예전 주소"는 새 주소와 예전 주소 둘 다 적게 고친다.

## 설계
- 의존성: `vue-router@5.5.1`(2026-11-13 공개, `pnpm add -E`). `allowBuilds` 필요 없음(빌드 스크립트 없음 — 설치 때 확인).
- `src/router.ts`: `createRouter({ history: createWebHistory(), routes, scrollBehavior })`. 경로마다 `meta.page`(KeepAlive 키, 메뉴 선택 표시)와 `props`(설정·지출은 `{ sub: params.tab }`). 경로 컴포넌트는 `App.vue`에 있던 `PAGES` 표를 옮긴 것(현황만 첫 묶음, 나머지 `lazyPage`).
  - `/spend/:tab(general|inst|subs)`, `/spend/:rest(.*)*` → `/spend/general`; 설정도 같은 모양.
  - `/home` → `/`, `/:rest(.*)*` → `/`.
  - `beforeEach`: `const to2 = fromOldHash(to.hash)`; 있으면 `{ path, query: { ...to.query, ...to2.query }, hash: '', replace: true }`.
- `src/main.ts`: `createApp(Root).use(i18n).use(router)`. 로그인 화면이 먼저 떠도 라우터는 설치되어 있다(로그인 뒤 같은 주소로 앱이 열림).
- `App.vue`: `read()`·`route` ref·`hashchange` 대신 `useRoute()`. `route.page`·`route.sub`는 `computed`로 `meta.page`·`params.tab`에서 만든다. 셸의 나머지(빵 부스러기, 아래 막대, 더보기, 접기)는 그 값만 쓰므로 그대로.
- `fromOldHash`는 `src/lib`의 순수 함수라 단위 테스트한다(V-2). 표는 S-1 그대로, 모르는 탭은 기본 탭.
- 서버 fallback 테스트: `STATIC_DIR`을 임시 폴더(가짜 `index.html`·`assets/x.js`)로 두고 `server/app.ts`를 불러 `root.request()`로 부른다. DB가 필요 없는 경로만.
- E2E: `tests/e2e/*`의 `goto('/#…')`·`toHaveURL(/#…/)`를 새 주소로 바꾼다(약 160곳). 보존 E2E는 새 파일 `tests/e2e/router.spec.ts`.
- 마이그레이션 없음. API·데이터 변경 없음.

## 작업 단위
- [ ] W-1 라우터 기반: `vue-router` 추가(`package.json`·`pnpm-lock.yaml` 같은 커밋), `src/lib/old-hash.ts`+단위 테스트, `src/router.ts`, `main.ts` 설치. 이 커밋만으로도 앱은 지금처럼 해시로 돈다(App.vue는 아직 해시를 읽음 — 라우터의 넘기기는 W-2와 함께 켠다: `beforeEach`는 W-2 커밋에서 연결).
- [ ] W-2 셸: `App.vue`를 `RouterView`+`KeepAlive`, `RouterLink`로. `beforeEach` 넘기기 연결. S-1·S-2·S-4(셸 부분).
- [ ] W-3 페이지 안 주소: `Settings.vue`·`Spending.vue`(탭 `router.push`, `?add`를 `route.query`로 S-3)·`Payroll.vue`·`AddRecordModal.vue`·`MoreSheet.vue`와 `href="#…"`가 있는 모든 곳(`Dashboard`·`Pending`·`History`·`SettingsTheme`·`SpendGeneral`·`Account`의 관리 링크)을 `RouterLink`/`router.push`로. S-3·S-4.
- [ ] W-4 로그인 돌아오기: `Account.vue` 연결 돌아오기 `/settings/security`, `takeErrorFromUrl`이 `history.state`를 지키게. S-5.
- [ ] W-5 서버 fallback 단위 테스트(`tests/unit/spa-fallback.test.ts`). 서버 코드는 바꾸지 않는다. S-6.
- [ ] W-6 버전 표기와 문서: S-7, CHANGELOG 0.1.6(Unreleased) 항목, `App.vue`·`Settings.vue` 등의 "hash" 주석 고치기.
- [ ] W-7 E2E: 기존 E2E 주소를 새 주소로, `tests/e2e/router.spec.ts` 추가(V-5의 보존 목록). AGENTS.md "reshaped input": 바뀌기 전에 받던 주소(`git show master:src/App.vue`의 `read()`·`Spending.vue`의 `checkAdd`)를 모두 E2E에 넣는다.

## 검증 기준
모든 검사는 `scripts/check-run.sh`로 돌리고, 로그는 `.loctx/reports/0.1.6/test/`에 둔다. `pnpm check:logs`를 통과한 로그만 증거로 쓴다. 서버가 필요한 검사는 :15174(`allot-rc`)에서만, 한 번에 한 담당만 한다. 검사 전에 `scripts/test-server/cleanup.mjs`, 필요하면 `seed.mjs`.
- V-1 게이트: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm build:server`, `pnpm test:unit`, `pnpm check:migrations`(변화 없음)이 모두 exit 0. 실패: 하나라도 0이 아니면.
- V-2 단위 테스트(`tests/unit/old-hash.test.ts`): S-1 표의 예전 해시 모두(빈 해시, `#home`, `#pay`, `#spend`, `#spend/general|inst|subs`, `#spend/모름`, `#subs`, `#subs?add`, `#spend/inst?add`, `#spend/subs?x=1&add`, `#events`, `#pending`, `#history`, `#settings`, `#settings/general|theme|ai|security`, `#settings/모름`, `#account`, `#admin`, `#dev`, `#모름`)와 `#app-login?return=…`(→ null)의 기대값을 테스트에 적는다. 실패: 하나라도 다르면.
- V-3 크기와 자원 주소: 첫 화면 JS(`dist/index.html`의 script+modulepreload, gzip)가 master보다 +15 kB 이하. `dist/index.html`의 `src`·`href`가 모두 `/`로 시작. 실패: 넘거나 상대 주소가 있으면 — 넘으면 원인을 적고 묻는다.
- V-4 개발 서버: API 없이 `pnpm exec vite --port 15175 --strictPort`(호스트, 이 검사만)를 띄우고 `/settings/ai`·`/spend/subs?add`가 200 HTML(`<div id="app">`)이다. 끝나면 내린다. 실패: 404거나 HTML이 아니면.
- V-5 E2E(:15174, 이 브랜치 이미지, `pnpm e2e`):
  - 기준: 같은 시험 계정·시드로 master 이미지(`ghcr.io/bluenyang/allot:0.1.5`)에서 전체 E2E를 먼저 돌려 실패한 테스트 제목을 적는다. 이 브랜치에서 그 밖의 실패가 있으면 실패다.
  - `router.spec.ts`(새로, 모두 통과해야 함):
    - 예전 해시마다(V-2 목록) 열면 새 주소로 바뀌고 같은 화면·탭이 보인다. 그 뒤 뒤로 가기 한 번이면 이 앱을 떠난다(`about:blank`) — 기록이 두 번 남지 않음.
    - `#subs?add`·`#spend/subs?add` → 구독 추가 창, `#spend/general?add`·`#spend/inst?add` → 지출 추가 창, 새 주소 `/spend/*?add`도 같고, 창이 열린 뒤 주소에 `add`가 없다.
    - `/?error=state_mismatch#account` → `/settings/security`, 오류 문구가 보이고 주소에 `error`가 없다.
    - `/#app-login?return=allot://x`: 주소의 해시가 그대로 남고 앱 셸이 아닌 돌려보내기 화면이 뜬다(목록에 없는 주소라 오류 문구).
    - 깊은 주소 새로고침(`/settings/ai`, `/spend/inst`)이 같은 화면. `/home`·`/foo` → `/`, `/spend`·`/settings/x` → 기본 탭 주소.
    - 메뉴·아래 막대·더보기 시트·탭·페이지 안 링크(현황 → 구독 전체, 대기 중 → 키 관리 등)를 누르면 새 주소로 가고 선택 표시가 맞다. 뒤로/앞으로가 화면을 되돌리고 매번 맨 위에서 시작한다.
    - 상태 유지: 지출 구독 탭에서 보기를 바꾸고 다른 메뉴에 갔다 오면 보기가 남는다. 구독 수정 창을 연 채 다른 탭으로 가면 창이 닫힌다(A-13).
    - 지연 로드 실패: 지출 화면 코드 요청을 막고(`page.route`) `/spend/general`을 열면 불러오기 실패 안내가 보인다.
  - 실패: 기준 밖의 실패, `router.spec.ts`의 실패나 건너뜀.
- V-6 서버(:15174, 이 브랜치 이미지): `curl`로 `/spend/general`·`/settings/ai`·`/pay` → 200 `text/html`(같은 `index.html`), `/api/없는것` → 404 JSON, `/healthz` → 200 JSON, `/api/mcp`(키 없음)과 `/api/auth/get-session`(쿠키 없음)의 상태 코드·본문이 master 이미지와 같다. 실패: 하나라도 다르면.
- V-7 휴대폰 너비: 390px에서 아래 막대·더보기 시트 링크로 이동하고 가로 스크롤이 없다(`router.spec.ts` 안, `scrollWidth <= clientWidth`). 실패: 넘치거나 이동이 안 되면.
- V-8 릴리스 서버: rc 이미지를 :15174에 올려 V-6과 `router.spec.ts`를 다시 돌린다. 끝나면 :15174를 내리고 :15173을 이 커밋으로 최신화한다(시험 데이터 없음). 실패: 하나라도 실패하면.
- V-9 사용자 확인: :15173에서 북마크한 예전 주소와 새 주소로 화면을 열어 본다(사용자). 실패: 사용자가 문제를 말하면.

## 조정 기록
<!-- - A-n (YYYY-MM-DD, W-n) 무엇을 · 왜 · 커밋 -->
—

## 우려
- vue-router의 `history.state`: 앱이 아닌 코드가 `history.replaceState(null, …)`를 부르면 뒤로 가기 스크롤 위치·경고가 생긴다. 지금 두 곳(`Spending.vue` checkAdd, `auth-ui.ts`)뿐이고 W-3·W-4에서 고친다. 새로 생기지 않게 리뷰에서 `replaceState`·`pushState`·`location.hash`를 grep한다.
- 로그인 화면이 먼저 뜰 때 라우터의 첫 내비게이션(`beforeEach`의 해시 넘기기)이 `#app-login`을 건드리면 앱 돌아오기가 깨진다 — `fromOldHash`가 `null`을 돌려주고 V-2·V-5에서 본다.
- Better Auth가 돌아오기 주소에 질의를 붙이는 방식(`/settings/security?error=…`)이 해시 주소와 다를 수 있다. `takeErrorFromUrl`은 질의만 읽으므로 같아야 하지만, Dex 없는 시험 서버에서는 실제 연결을 못 한다 — V-5는 `?error=`를 직접 넣은 주소로 본다(실제 외부 로그인은 범위 밖: 기준 실패 auth:105와 같은 사정).
- E2E 160곳을 바꾸는 동안 기준 실패와 회귀가 섞일 수 있다 — 기준을 먼저 master 이미지로 잰다(V-5).
- 예전 `#…` 주소는 다른 사람이 만든 링크에도 남아 있을 수 있어 넘기기를 없애는 시점은 정하지 않는다(계속 둔다).

## 범위 밖
- 시험 서버 기준 E2E 실패 고치기(열린 질문 1 "따로").
- 화면·기능·API·데이터 변경, 새 메뉴, 페이지 제목(`<title>`) 바꾸기.
- 월급 분배 안의 탭을 주소에 넣기.
- 모바일 앱의 `#app-login` 주소 바꾸기.
- 실제 외부 로그인(Dex·GitHub·Google)으로 돌아오기 확인 — 시험 서버에 제공자가 없다.
