---
intent: "015"
status: accepted
approvals:
  - { role: user, kind: summary, by: BlueNyang, at: "2026-11-25", words: "진행", rev: eecb439 }
summary_for_user: |
  0.1.9는 작업 단위 11개(W-1~W-11)입니다. 순서는 Better Auth 올리기 → 데이터 → OAuth 서버 → 동의 화면 → `/mcp` → 연결된 앱 → 스킬 7개 → 세 AI 설치 묶음 → 서버 안내문 → 문서 → 시험입니다.
  Better Auth는 전체를 1.7.28(오늘 15:16 UTC부터 설치 가능, 그 전이면 1.7.27)로 함께 올리고, 올린 날 알려진 취약점과 로그인 회귀를 다시 확인합니다.
  OAuth 권한은 동의 화면에서 셋 중 하나를 고릅니다: 읽기 / 쓰기 제안(화면에서 확인) / 쓰기 제안(대화에서 확인). 키의 세 경우와 같습니다. 외부 앱 연결은 기본으로 꺼져 있고, 끊으면 바로 401입니다.
  새 기능의 제한(돌아갈 주소는 정확히 같아야 함, PKCE S256만, 액세스 토큰 1시간·갱신 토큰 30일, 클라이언트 등록은 1분에 5번)은 S-12에 모아 두었습니다. 기존 키·도구·`/api/mcp`의 입력은 하나도 거부하지 않습니다.
  자동 시험은 :15174에서 가짜 클라이언트로 하고, 실제 AI 앱(claude.ai·휴대폰·Claude Code·ChatGPT·Codex·Gemini CLI) 연결은 rc를 올린 뒤 사용자 서버에서 확인을 부탁드립니다.
---
## 요구 해석
- S-1 **의존성** (intent 계획 1, 사용자 "전체를 올려도 문제 없으면 올려도 좋을 거 같아. vulnerabilities 잘 확인해보고."):
  - `better-auth`, `@better-auth/api-key`와 새 `@better-auth/mcp`, `@better-auth/oauth-provider`, `@better-auth/cimd`를 한 버전으로 맞춘다.
  - 그 버전은 W-1을 할 때 `minimumReleaseAge`를 통과하는 가장 새 1.7.x다. 2026-11-25 08:37 UTC 기준으로 1.7.28(2026-11-24 15:16 UTC 공개)은 15:16 UTC부터, 그 전이면 1.7.27이다.
  - 그날 `pnpm audit`과 GitHub advisories(better-auth와 다섯 패키지)를 다시 보고 기록한다. 2026-11-25 08:37 UTC 현재 설치본은 `pnpm audit` "No known vulnerabilities found"다.
  - Better Auth 1.7에는 예전 `mcp()`·`oidcProvider()`가 없다(설치본 `better-auth/package.json` exports에서 확인).
- S-2 **Allot이 인가 서버** (intent 정한 것, 사용자 "인가 서버인 것 OK"): `@better-auth/mcp`의 `mcp()`(oauthProvider 위)와 `jwt()`를 `server/auth.ts`에 붙인다.
  - 메타데이터: Protected Resource Metadata(RFC 9728)와 Authorization Server Metadata(RFC 8414), OpenID 설정을 루트 `/.well-known/`에 둔다.
    - PRM은 `/.well-known/oauth-protected-resource/mcp`와 `/.well-known/oauth-protected-resource`다.
    - `resource`는 `<BETTER_AUTH_URL>/mcp`다.
    - AS 메타데이터는 `/.well-known/oauth-authorization-server`가 200으로 답한다. Google은 처음 답하는 경로에서 멈추기 때문이다(조사).
  - PKCE는 S256만 받는다. RFC 9207 `iss`를 보낸다. 토큰은 `resource`(audience)에 묶인다.
- S-3 **클라이언트 등록** (intent 정한 것, 사용자 "등록 방식 승인"): CIMD(`@better-auth/cimd`, Node 전송)와 DCR을 둘 다 연다.
  - CIMD를 쓰려면 메타데이터에 `client_id_metadata_document_supported: true`와 `token_endpoint_auth_methods_supported`의 `none`이 있어야 한다. 그래야 Claude가 CIMD를 쓴다(조사).
  - CIMD를 가지러 나가는 요청은 패키지의 Node 전송으로만 한다. 이 전송은 이름을 한 번 풀고, 특수 주소를 막고, 연결을 고정하고, 다른 곳으로 넘기는 응답을 따라가지 않는다(SSRF 방지, 조사).
  - DCR은 '외부 앱 연결'이 켜져 있을 때만 열린다.
- S-4 **권한 셋** (intent 바라는 결과 "권한은 키와 같다", 사용자 4 "동의 화면에서"): OAuth 범위는 키의 세 경우와 같다.
  - `allot:read`: 읽기 도구 12개(지금의 읽기 키).
  - `allot:propose`: 읽기와 쓰기 도구 4개, 화면에서 확인한다(지금의 쓰기 키 `confirm: 'ui'`).
  - `allot:apply`: 같은 16개, 대화에서 확인하고 `apply_proposal`로 적용한다(지금의 쓰기 키 `confirm: 'chat'`).
  - 도구 목록은 지금 키와 똑같다: 쓰기 범위면 확인 방식과 상관없이 16개다. 화면 확인일 때 `apply_proposal`은 지금처럼 거절한다(`server/mcp/tools.ts`).
  - 클라이언트가 무엇을 요청하든, 동의 화면에서 사용자가 하나를 고른다. 고른 범위는 요청한 범위보다 넓어질 수 없다. `openid`·`offline_access`는 그와 함께 준다.
- S-5 **동의 화면** (intent 계획 2): Vue 화면 `/oauth/consent`. 보여 주는 것:
  - 앱 이름(클라이언트 메타데이터)
  - 돌아갈 주소의 호스트를 크게 보이고, localhost로만 돌아가는 클라이언트면 경고를 더한다(조사: MCP 규격과 Claude의 권고)
  - 세 권한 중 하나(S-4)
  - 허락과 거절

  로그인이 안 되어 있으면 지금의 로그인 화면으로 갔다가 돌아온다. 비밀번호·OIDC·GitHub·Google 각각에서 돌아오는지 시험한다(조사: OIDC 콜백으로 이어지는지 확인 못 함).
- S-6 **`/mcp`** (사용자 "`/mcp`로 구성가능한가?"):
  - 루트 `/mcp`가 API 키와 OAuth 액세스 토큰을 둘 다 받는다.
  - `/api/mcp`는 지금과 똑같이 키만 받는다(intent 정한 것).
  - 401에는 `WWW-Authenticate: Bearer resource_metadata="<BETTER_AUTH_URL>/.well-known/oauth-protected-resource/mcp"`를 담는다. `/api/mcp`의 401은 지금 그대로 둔다.
  - OAuth 토큰은 서명(JWKS), 발급자, audience = `<BETTER_AUTH_URL>/mcp`, 만료를 확인한 뒤 사용자를 정한다. 지금의 `usableUser` 검사도 거친다(정지·대기 계정은 401).
- S-7 **끊으면 바로 401** (사용자 "연결 끊으면 401 승인"): `/mcp`는 호출마다 그 토큰의 연결(사용자 + 클라이언트의 동의 행)이 아직 있는지 본다. 없으면 401이다. JWT는 폐기해도 만료 전까지 통하므로 이렇게 막는다(조사).
- S-8 **갱신 토큰** (사용자 "갱신 토큰은 RTR처럼 한다는 거지? 승인"): 갱신할 때마다 새 갱신 토큰을 주고 예전 것은 받지 않는다(rotation). 재사용 허용 시간은 0이다(`mcp()`의 기본 30초를 바꿈).
- S-9 **제안의 출처** (S-4): 지금 제안(`mcp_proposal`)은 키(`key_id`)에 묶여 있다. 적용할 때 그 키가 살아 있는지도 본다(`proposals.ts` `keyFor`).
  - OAuth로 만든 제안은 출처를 'OAuth 연결'로 적는다. 적용할 때 그 연결과 범위가 살아 있는지 본다.
  - 변경 내역에는 "AI · 앱 이름"으로 남는다. 되돌리기는 지금과 같다.
  - 키로 만든 제안은 하나도 바뀌지 않는다.
- S-10 **연결된 앱** (intent 바라는 결과, 사용자 5 "꺼 둠"):
  - 설정 › AI·연동: '연결된 앱 관리'가 '준비 중'에서 실제 목록이 된다. 앱 이름, 범위, 연결 날짜, 마지막 사용을 보이고 '끊기'를 둔다. 끊으면 동의와 갱신 토큰이 지워진다.
  - 관리 › 로그인 방식: '외부 앱 연결(OAuth)' 스위치를 둔다. 기본은 꺼짐이고, env `ALLOT_OAUTH_ENABLED`가 있으면 화면은 잠긴다(지금의 로그인 방식 규칙과 같음).
  - 꺼져 있으면 `/.well-known/oauth-*`와 `/oauth2/*`는 404이고, `/mcp`는 키만 받는다.
  - 켜져 있다가 끄면 이미 발급한 OAuth 토큰도 그 순간부터 401이다. 연결 기록은 남는다.
- S-11 **설정 화면의 MCP 주소**: '연결 방법'에 `<origin>/mcp`를 보인다. 키 사용자에게는 `/api/mcp`도 그대로 된다는 한 줄을 더한다.
- S-12 **새 기능의 제한** (AGENTS.md "새 제한은 spec에 적고 승인"). 전부 OAuth라는 새 기능에만 걸린다. 기존 입력(키, 도구, `/api/mcp`, 로그인)은 하나도 거부하지 않는다.
  - 돌아갈 주소는 등록한 것과 정확히 같아야 한다. 예외는 localhost·127.0.0.1·[::1]의 포트뿐이다(Claude Code·Codex·Gemini CLI용, Better Auth 기본).
  - PKCE S256만 받는다. `plain`은 거부한다.
  - 수명: 액세스 토큰 1시간, 갱신 토큰 30일, 인가 코드 10분(Better Auth 기본).
  - 호출 제한: 클라이언트 등록은 1분에 5번, 토큰은 1분에 20번, 인가는 1분에 30번(Better Auth 기본). `/mcp` 호출은 OAuth 연결 하나당 1분에 120번(키와 같음).
  - CIMD 메타데이터는 공개 HTTPS 주소에서만 가져온다. 사설·특수 주소는 거부한다(S-3).
  - 클라이언트 관리용 Better Auth 경로(`/oauth2/create-client`, `update-client`, `get-clients` 등)는 HTTP로 닫는다. 지금 `/api-key/*`를 닫는 것과 같다. 연결된 앱 화면은 Allot 자체 경로로 한다.
- S-13 **스킬 7개** (사용자 2): 월초 점검, 급여 정산, 월말 정산(기타 소비, 통장 잔고 파악), 구독 최적화 제안, 영수증 분석, 소비·지출 계획, 자산관리.
  - 공통 형식(agentskills.io `SKILL.md`, 규격 필드 `name`·`description`만)으로 한 벌을 둔다.
  - 지금 MCP 도구만 쓴다(사용자 승인). 도구로 못 하는 일은 그 화면으로 안내한다. 예: 잔액 기록은 AI가 바꿀 수 없으니 통장 화면을 안내한다.
  - 영수증 분석: AI 앱이 읽은 영수증 내용으로 `propose_changes`의 일회성 지출(또는 구독 영수증 확인 표시)을 제안한다. 반영은 사용자가 확인한다.
- S-14 **세 AI의 설치 묶음** (사용자 1 "둘 다. OAuth가 기본", 3 "이 저장소"; 공식 디렉터리 없음):
  - **Claude Code**: 이 저장소가 마켓플레이스다(`.claude-plugin/marketplace.json`). 플러그인은 둘이다.
    - `allot`: OAuth. 서버 주소를 `userConfig`로 받는다.
    - `allot-key`: API 키를 `userConfig`의 비밀값으로 받는다.

    둘로 나누는 까닭: 헤더가 하나라도 있으면 Claude Code가 OAuth를 쓰지 않고, 빈 키로 무엇이 되는지는 확인되지 않았다(조사). 두 플러그인은 같은 스킬을 쓴다.
  - **claude.ai**: 같은 마켓플레이스를 claude.ai에서도 더할 수 있다. 다만 주소가 `${user_config}`인 서버는 무시되고 스킬만 들어간다(조사). 서버는 사용자 지정 커넥터로 따로 더한다. 스킬 ZIP을 만드는 스크립트도 둔다.
  - **Codex**: 먼저 Codex가 `.claude-plugin/marketplace.json`을 읽고 설치하는지 확인한다(조사: 예전 위치로 읽음, 미확인). 안 되면 Codex 형식 묶음(`plugin.json`, `mcp.json`, 같은 스킬)을 둔다. MCP는 `codex mcp add allot --url https://<your-host>/mcp` + `codex mcp login allot`로 붙인다.
  - **Gemini**: 저장소 루트에 `gemini-extension.json`과 `GEMINI.md`를 두고, 같은 `skills/`를 쓴다. MCP는 `gemini mcp add --transport http allot https://<your-host>/mcp`로 붙인다.
    - Gemini CLI는 이제 유료 키나 Code Assist가 있어야 한다(조사 정정). W-8에서 Antigravity CLI가 원격 MCP와 확장을 받는지 먼저 확인한다. 되면 그쪽 안내와 묶음도 둔다.
- S-15 **MCP 서버 안내문** (intent 계획 7): 지금의 서버 `instructions`(`buildMcpServer`, 키 종류에 따라 한 문장)를 넓혀 Allot이 무엇이고 어떻게 쓰는지 적는다. 앞 512자에 핵심을 둔다(ChatGPT). 핵심은 이것이다: 제안은 사용자가 확인하기 전에는 바뀌지 않는다, 날짜는 사용자 시간대다, 어느 도구부터 쓰는가.
- S-16 **도구 표시** (intent 제약): `readOnlyHint` 등 도구 annotations는 실제 동작대로만 단다. 제안 도구를 읽기 전용으로 표시하지 않는다.
- S-17 **0.1.10과의 관계**: 이 spec은 0.1.10의 8항목을 건드리지 않는다. 도구 설명(0.1.10 항목 3·8)도 이 버전에서 바꾸지 않는다.

## 설계
### 의존성 (W-1)
- `pnpm add -E`로 다섯 패키지를 한 버전(S-1)으로 맞춘다. `pnpm install --frozen-lockfile`이 통과하는지 본다.
- 로그인 회귀: 단위 시험, 그리고 :15174에서 `tests/e2e/auth.spec.ts`와 로그인 방식 API 검사(`login-methods.mjs`, `oidc-flows.mjs`, `password-keys.mjs`)를 돌린다. 1.7.18의 동작과 같아야 한다.

### 데이터 (W-2)
- `server/db/auth-schema.ts`에 oauthClient·oauthAccessToken·oauthRefreshToken·oauthConsent·oauthResource·oauthClientResource·oauthClientAssertion·jwks를 둔다. Better Auth CLI의 출력을 바탕으로 하고, `pnpm db:generate`로 마이그레이션을 만든다.
- 이 테이블들은 RLS 예외다(`auth-schema.ts`의 다른 테이블과 같음, 사용자 승인). 사용자 구분은 앱 코드가 한다: 동의·토큰을 `userId`로 거른다.
- `mcp_proposal`에 `source_kind`(`api_key` 기본 | `oauth`)를 더한다. 기존 행은 모두 `api_key`다. OAuth 제안의 `key_id` 자리에는 OAuth 클라이언트 id를, `key_name`에는 앱 이름을 둔다(열 이름은 그대로, 마이그레이션은 열 하나 추가).

### OAuth 서버 (W-3)
- `server/auth.ts`:
  - `jwt({ disableSettingJwtHeader: true })`
  - `mcp({ resource: <BETTER_AUTH_URL>/mcp, loginPage: '/login', consentPage: '/oauth/consent', scopes: ['openid','offline_access','allot:read','allot:propose','allot:apply'], refreshTokenReuseInterval: 0, allowDynamicClientRegistration, allowUnauthenticatedClientRegistration })`
  - `cimd()`, Node 전송
  - `disabledPaths`에 `/token`을 더한다(jwt 문서).
  - before-hook: 외부 앱 연결이 꺼져 있으면 `/oauth2/*`를 404로 닫는다. 클라이언트 관리 경로는 늘 닫는다(S-12).
- `server/app.ts` 루트:
  - `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration`: 패키지의 메타데이터 도우미를 쓴다.
  - `/.well-known/oauth-protected-resource(/mcp)`
  - 정적 파일과 SPA보다 앞에 둔다. 꺼져 있으면 404다.
- `server/auth-config.ts`: `oauth.enabled`. 화면은 관리 › 로그인 방식, env는 `ALLOT_OAUTH_ENABLED`(env가 이김).
- `vite.config.ts`의 개발 프록시에 `/mcp`, `/.well-known`을 더한다. `vite preview`는 같은 설정을 쓴다.

### 동의 화면 (W-4)
- `src/pages/OAuthConsent.vue`, 라우트 `/oauth/consent`. 로그인 필요.
- `oauthProviderClient()`가 `location.search`의 서명된 요청을 붙인다(조사).
- 허락하면 `authClient.oauth2.consent({ accept: true, scope })`를 부른다. 셋 중 고른 범위 + `openid offline_access`다.
- 로그인 화면은 서명된 요청이 있으면 로그인 뒤 그 흐름을 잇는다. 비밀번호·OIDC·GitHub·Google 각각 시험한다.
- `EditSheet`가 아니라 페이지다. 디자인 토큰(`DESIGN.md`)을 쓰고, 휴대폰 폭에 맞춘다.

### `/mcp` (W-5)
- `server/mcp/index.ts`의 `handle`이 Bearer 값을 보고 가른다.
  - JWT 꼴(점 둘)이고 외부 앱 연결이 켜져 있으면 OAuth 검사(S-6, S-7)를 한다. 그 밖에는 지금의 키 검사다.
  - `/mcp`는 둘 다 받고, `/api/mcp`는 키만 받는다.
- OAuth 범위를 지금의 `confirm` 값으로 바꾼다. `allot:read` → null, `allot:propose` → `'ui'`, `allot:apply` → `'chat'`(`server/keys.ts` `confirmOf`와 같은 값). 그러면 `buildMcpServer`가 같은 도구 목록을 만든다.
- 호출 제한: 지금 `FailureLimiter`와 키 분당 120번과 같은 크기로, OAuth 연결(사용자+클라이언트) 단위로 센다.
- `proposals.ts`: `keyFor`가 `source_kind`로 갈라 OAuth면 동의 행과 범위를 본다. `Recorder`의 행위자는 `{ kind: 'oauth_app', id }`이고, 변경 내역의 표시는 "AI · 앱 이름"이다.
- 마지막 사용 시각: OAuth 연결마다 둔다(동의 행에 열이 없으면 Allot 쪽 작은 표, W-2에 포함).

### 연결된 앱 (W-6)
- 경로: `GET /api/oauth-apps`(내 연결 목록), `DELETE /api/oauth-apps/:clientId`(끊기 — 동의, 갱신 토큰, 그 클라이언트의 액세스 토큰 행을 지움).
- 화면: `src/pages/SettingsAi.vue`의 '연결된 앱 관리'를 실제 목록으로 바꾼다. 관리 › 로그인 방식에 스위치를 둔다.

### 스킬 (W-7)
- `skills/<name>/SKILL.md` 7개: `allot-month-start`, `allot-payday`, `allot-month-end`, `allot-subscriptions`, `allot-receipt`, `allot-spending-plan`, `allot-assets`.
- 본문은 영어로 쓰고, "사용자의 언어로 답한다"를 넣는다(PM 판단: 세 AI가 같이 읽는 모델용 지시문). 사용자에게 보이는 이름·설명은 영어와 한국어를 함께 적는다.
- 도구 이름은 지금 도구 그대로다. 각 스킬에 "쓰는 도구", "제안은 확인 전에는 바뀌지 않음", "못 하는 일과 안내할 화면"을 적는다.

### 설치 묶음 (W-8)
- `.claude-plugin/marketplace.json`: `allot`(source `./`), `allot-key`(source `./plugins/allot-key`).
- `.claude-plugin/plugin.json`(루트 = `allot`), `.mcp.json`(`url: ${user_config.server_url}`, 헤더 없음).
- `plugins/allot-key/.claude-plugin/plugin.json` + `.mcp.json`(`Authorization: Bearer ${user_config.api_key}`).
  - 스킬을 공유하는 방법은 `claude plugin validate --strict`로 정한다: 매니페스트의 `skills` 경로가 플러그인 밖을 가리킬 수 있으면 그렇게 하고, 아니면 스크립트로 복사한다.
- Codex: 확인 결과에 따라(S-14).
- Gemini: 루트 `gemini-extension.json`(`mcpServers` 없음, `contextFileName: GEMINI.md`), `GEMINI.md`.
- `scripts/skills-zip.mjs`: claude.ai에 올릴 스킬 ZIP을 만든다. 출력은 커밋하지 않는다.
- 이름 규칙: `claude-`·`anthropic-`로 시작하지 않는다. README 40단어 이상, LICENSE가 있다(조사: 검증 규칙).

### 서버 안내문 (W-9)
- `buildMcpServer`의 `instructions`를 넓힌다. 사용자 언어 설정을 따르지 않고 영어 하나로 쓴다(모델용, 지금과 같음). 키 종류별 문장(읽기 전용 / 화면 확인 / 대화 확인)은 남기고 OAuth 범위에도 같게 쓴다.

### 문서 (W-10)
- README "MCP로 AI 연결"을 "AI 연결"로 다시 쓴다.
  - 세 AI별 방법: claude.ai·휴대폰 커넥터, Claude Code 플러그인 둘, ChatGPT 웹, Codex, Gemini CLI(와 Antigravity CLI 결과).
  - 요금제 제약: ChatGPT 쓰기는 Business 이상, Pro는 읽기만, Gemini 앱은 미국·영어만.
  - 공개 HTTPS 요건. LAN 전용이면 CLI들의 API 키만 된다.
  - 외부 앱 연결 켜기, 연결된 앱, 접속하는 IP(Anthropic `160.79.104.0/21`·`153.61.208.0/20`, OpenAI 목록 주소).
- `server/docs.ts`(API 문서), CHANGELOG, `docker/.env.example`의 `ALLOT_OAUTH_ENABLED`(값은 비워 둠).

### 시험 (W-11)
- `tests/api/oauth.mjs`: DCR로 가짜 클라이언트를 만들고 흐름 전체를 돈다(V-4).
  - CIMD는 공개 HTTPS 메타데이터 주소가 있어야 해서(S-3 SSRF 방지), 자동 시험에서는 메타데이터에 광고되는지만 본다. 실제 CIMD는 V-8에서 Claude·ChatGPT로 확인한다.
- E2E `tests/e2e/oauth.spec.ts`: 동의 화면, 연결된 앱, 스위치, 로그인 뒤 동의로 이어지기.
- 기존 `mcp.mjs`·`api-keys.mjs`를 `/mcp`와 `/api/mcp` 둘에 돌린다(`disposable.sh`).

## 작업 단위
- [x] W-1 의존성: Better Auth 다섯 패키지를 한 버전으로, 취약점 기록, 로그인 회귀(S-1). — 1.7.27(2026-11-25 08:48 UTC, 1.7.28은 아직 하루 전), `pnpm audit` "No known vulnerabilities found", GitHub advisories 다섯 패키지 0건(08:49 UTC); 로그인 회귀는 V-3에서.
- [x] W-2 데이터: OAuth 테이블·jwks, `mcp_proposal.source_kind`, 마지막 사용, 마이그레이션, `pnpm check:migrations`(S-2, S-9).
- [x] W-3 OAuth 서버: 플러그인 설정, 루트 메타데이터, 외부 앱 연결 스위치(서버), 닫는 경로, 개발 프록시(S-2, S-3, S-8, S-10 서버, S-12).
- [x] W-4 동의 화면과 로그인 이어가기(S-4, S-5).
- [x] W-5 `/mcp`: 키와 OAuth, 연결 확인, 범위→도구, 호출 제한, 제안 출처·적용·변경 내역(S-6, S-7, S-9, S-11).
- [x] W-6 연결된 앱: 경로, 설정 화면 목록·끊기, 관리 스위치 화면(S-10).
- [x] W-7 스킬 7개(S-13).
- [x] W-8 설치 묶음: Claude Code 마켓플레이스·플러그인 둘, Codex 확인과 묶음, Gemini 확장(Antigravity 확인), 스킬 ZIP 스크립트(S-14).
- [x] W-9 서버 안내문과 도구 annotations 확인(S-15, S-16).
- [x] W-10 문서: README, API 문서, CHANGELOG, env 예시.
- [x] W-11 시험: OAuth API 검사, E2E, 키 회귀.

## 검증 기준
모든 검사는 `scripts/check-run.sh`로 돌리고 `pnpm check:logs`를 통과해야 증거로 친다. 시험 서버는 :15174만 쓴다. DB에 직접 쓰는 검사는 `disposable.sh`로 돈다.
- V-1 **게이트**: 머리 커밋에서 typecheck·build·unit이 exit 0이다. 실패 = 하나라도 0이 아님.
- V-2 **의존성**:
  - `pnpm install --frozen-lockfile` 통과.
  - 고른 버전에서 `pnpm audit` 알려진 취약점 없음. GitHub advisories에서 다섯 패키지의 고른 버전에 열린 권고 없음(조회 시각과 함께 기록).
  - `package.json`의 다섯 패키지가 같은 버전이고 정확히 고정돼 있다.
  - 실패 = 하나라도 아님. 취약점이 있으면 멈추고 사용자에게 묻는다.
- V-3 **로그인 회귀** (:15174, 새 이미지): `tests/e2e/auth.spec.ts`, `login-methods.mjs`, `oidc-flows.mjs`, `password-keys.mjs`, `admin.mjs`가 0.1.8 이미지에서와 같은 결과다. 실패 = 하나라도 다름.
- V-4 **OAuth 흐름** (:15174, 외부 앱 연결 켬, `tests/api/oauth.mjs`):
  - 메타데이터: PRM 두 경로가 `resource`=`<base>/mcp`이고, AS 메타데이터가 200이며 S256만, `iss` 지원, `client_id_metadata_document_supported: true`, 토큰 인증 방식에 `none`.
  - 흐름: DCR 등록 → 인가 → 로그인 → 동의(범위 좁히기) → 코드 → 토큰(PKCE) → `/mcp` 도구 목록이 범위대로(읽기 12 / 화면 확인 16 / 대화 확인 16, 화면 확인의 `apply_proposal`은 거절) → 제안·적용(대화 확인 범위) → 변경 내역 "AI · 앱 이름" → 갱신(새 갱신 토큰, 예전 것은 거부, 재사용 0초) → 끊기 → 같은 액세스 토큰이 바로 401.
  - 거부할 것: 다른 audience 토큰, PKCE 없는 요청, `plain`, 등록과 다른 돌아갈 주소(localhost 포트는 예외).
  - 격리와 스위치: 사용자 A의 토큰으로 B의 데이터를 볼 수 없다. 스위치를 끄면 메타데이터·`/oauth2/*`가 404이고, 이미 받은 토큰이 401이다.
  - 실패 = 기대한 코드·값이 하나라도 다름.
- V-5 **키 회귀**: `mcp.mjs`(tools·auth·isolation·write)와 `api-keys.mjs`가 `/api/mcp`에서 0.1.8과 같은 결과이고, `/mcp`에서도 같다. `/api/mcp`의 401 헤더는 그대로다. 실패 = 하나라도 다름.
- V-6 **마이그레이션**: `pnpm check:migrations` 변경 없음. 0.1.8 상태(키로 만든 대기 제안 포함)에서 올리면 그 제안이 `api_key`로 남고, 화면 확인·대화 확인이 그대로 된다. 실패 = 값이 다르거나 제안이 안 됨.
- V-7 **E2E** (:15174):
  - 동의 화면: 세 권한, 거절, localhost 경고, 휴대폰 폭에서 가로 스크롤 없음.
  - 로그인 안 된 상태에서 동의로 이어지기: 비밀번호, OIDC(Dex).
  - 연결된 앱 목록·끊기, 관리 스위치(env가 있으면 잠김), 설정의 MCP 주소 `/mcp`.
  - 실패 = 시험 하나라도 실패.
- V-8 **설치 묶음**:
  - `claude plugin validate --strict`가 두 플러그인에서 통과한다.
  - 로컬 경로로 마켓플레이스를 더하고 `allot`을 설치한 뒤 `http://127.0.0.1:15174/mcp`로 OAuth 로그인과 도구 호출이 된다(Claude Code는 loopback이면 http도 OAuth를 보냄). `allot-key`는 시험 키로 된다.
  - Codex·Gemini CLI·Antigravity CLI는 이 기계에 설치돼 있으면 같은 확인을 하고, 없으면 매니페스트 형식만 확인한다. 어느 쪽인지 기록한다.
  - 실패 = 검증이나 연결 실패.
- V-9 **사용자 확인** (rc를 사용자 서버에 올린 뒤, 실제 데이터, 사용자가 함):
  - (A-24로 넘겨 받은 것) OIDC·GitHub·Google로 로그인한 뒤 동의 화면으로 이어지는지, Codex·Antigravity·Claude Code에서 실제 도구 호출.
  - Claude: claude.ai 커넥터, 휴대폰, Claude Code 플러그인.
  - ChatGPT: 웹(요금제가 허용하는 범위), Codex.
  - Gemini: CLI(또는 Antigravity).
  - 클라이언트마다 연결·읽기·(가능하면)제안 결과를 rc별로 적는다. 안 되는 클라이언트는 원인과 함께 기록하고, 0.1.9 안에서 고칠지 묻는다.
- V-10 **화면 확인**: rc를 :15173에 올린 뒤 그 rc의 화면 확인을 묻고 답을 rc별로 적는다(AGENTS.md "Screen checks per rc").

## 조정 기록
<!-- - A-n (YYYY-MM-DD, W-n) 무엇을 · 왜 · 커밋 · 예전 입력 거부·새 제한: 있음|없음 -->
- A-1 (2026-11-25, W-1) 1.7.28 대신 1.7.27 · W-1을 한 08:48 UTC에 1.7.28이 아직 하루가 안 됨(S-1이 정한 대로) · 99327bc · 예전 입력 거부·새 제한: 없음
- A-2 (2026-11-25, W-2) OAuth 표는 Better Auth CLI 대신 설치된 Drizzle 어댑터의 생성기(CLI가 쓰는 것)로 만듦 · CLI를 내려받아 실행하는 것이 이 기계의 자동 승인에서 막힘, 같은 생성기라 결과는 같음 · ded950e · 예전 입력 거부·새 제한: 없음
- A-3 (2026-11-25, W-3) 로그인 화면 경로 `/oauth/login`(설계의 `/login` 대신) · 앱에 `/login` 경로가 없고 로그인 화면은 세션이 없을 때 어디서나 나옴; 따로 이름을 두어 로그인된 사용자도 다시 로그인할 수 있게(prompt=login) · b6fb53d · 예전 입력 거부·새 제한: 없음
- A-4 (2026-11-25, W-3) JWT 발급자를 BETTER_AUTH_URL의 origin으로 · 그래야 AS 메타데이터가 RFC 8414 그대로 루트 `/.well-known/oauth-authorization-server`에 있음(S-2) · b6fb53d · 예전 입력 거부·새 제한: 없음
- A-5 (2026-11-25, W-3) OAuth 플러그인은 BETTER_AUTH_URL이 https이거나 loopback의 http일 때만 붙임 · `@better-auth/mcp`가 그 밖의 resource로는 시작을 거부함(LAN http의 :15173이 멈춤). 그 밖이면 외부 앱 연결은 쓸 수 없고(관리 화면에 표시) 키는 그대로 됨 — W-10의 "공개 HTTPS 요건"과 같은 말 · b6fb53d · 예전 입력 거부·새 제한: 없음(새 기능이 서는 조건이며 기존 입력은 그대로)
- A-6 (2026-11-25, W-3) DCR의 `application_type` 기본을 `infer`로 · 이를 빼먹는 네이티브 클라이언트(loopback 콜백)가 web으로 보아 거부되지 않게; 웹 클라이언트 규칙은 그대로 · b6fb53d · 예전 입력 거부·새 제한: 없음(받는 쪽을 넓힘)
- A-7 (2026-11-25, W-3) 스위치 값은 `app_setting`의 `oauth` 행(마이그레이션 0040이 id 검사에 `oauth`를 더함) · 키 정책과 같은 자리 · b6fb53d · 예전 입력 거부·새 제한: 없음
- A-8 (2026-11-25, W-4) 동의 화면이 앱 이름·돌아갈 주소·요청한 권한을 Allot 경로 `GET /api/oauth-apps/request`에서 받음(서명을 서버가 확인) · 주소창의 값을 그대로 보이지 않고 서명된 요청만 믿기 위해. 앱이 요청하지 않은 권한은 고를 수 없게 흐리게 둠(`/oauth2/consent`가 요청한 범위 밖을 거부함, S-4 "넓어질 수 없다") · 6481ec0 · 예전 입력 거부·새 제한: 없음
- A-9 (2026-11-25, W-5) 토큰의 권한은 토큰이 받은 것과 지금 연결(동의)이 가진 것 중 좁은 쪽(읽기 < 화면 확인 < 대화 확인) · 다시 동의해 권한을 바꾸면 전에 받은 토큰도 그 순간 좁아지고 넓어지지는 않게(S-7·S-9 "연결과 범위가 살아 있는지") · 48438ab · 예전 입력 거부·새 제한: 없음(새 기능 안의 판단, S-9에 적힌 것)
- A-10 (2026-11-25, W-5) 변경 내역의 행위자 종류 `oauth_app`을 enum에 더함(마이그레이션 0041), 변경 내역의 AI 칩은 `api_key`와 `oauth_app`을 함께 셈. 대기 중인 변경은 앱의 연결이 끊기면 "앱의 연결이 끊겼거나…"로 안내 · 설계의 `{ kind: 'oauth_app', id }`를 그대로 하려면 필요 · 48438ab · 예전 입력 거부·새 제한: 없음
- A-11 (2026-11-25, W-5) 루트 `/mcp`에 토큰 없이 온 첫 요청은 주소별 실패로 세지 않음 · OAuth 클라이언트는 401을 받고서야 인가를 시작하므로; 틀린 키·토큰은 지금처럼 셈 · 48438ab · 예전 입력 거부·새 제한: 없음
- A-12 (2026-11-25, W-7) 스킬은 잔액 기록을 통장 화면으로 안내하지 않고 `propose_changes`의 `balances`로 제안함 · S-13의 예("잔액 기록은 AI가 바꿀 수 없으니")가 틀림: 0.1.7(spec 013 S-10)부터 잔액 기록은 제안할 수 있음(`server/ops.ts` AI_LISTS). 못 하는 일 안내는 은행·카드사·명세서 읽기, 돈 옮기기, 표시 설정 등으로 · ca8d87c · 예전 입력 거부·새 제한: 없음
- A-13 (2026-11-25, W-8) 두 플러그인을 `plugins/allot`·`plugins/allot-key`에 두고(설계의 루트 `./` 대신), 스킬은 루트 `skills/` 하나를 `scripts/plugins-sync.mjs`로 복사해 커밋, `tests/unit/plugins.test.ts`가 같은지 봄 · 루트를 플러그인으로 하면 CLAUDE.md를 플러그인으로 읽어 `--strict`가 실패하고 설치 때 저장소 전체가 복사됨; 설치된 플러그인은 자기 폴더 밖을 못 읽음(설계가 정한 "아니면 스크립트로 복사") · MCP 설정은 `.mcp.json` 대신 plugin.json 안에(루트 `.mcp.json`은 이 저장소를 여는 Claude Code가 프로젝트 MCP로 읽음) · 8d3b157 · 예전 입력 거부·새 제한: 없음
- A-14 (2026-11-25, W-8) Gemini 확장의 맥락 파일 이름을 `ALLOT.md`로(설계의 `GEMINI.md` 대신) · 루트 `GEMINI.md`는 이 저장소에서 Gemini CLI를 여는 개발자에게 프로젝트 맥락으로 읽혀 잘못 안내함 · 8d3b157 · 예전 입력 거부·새 제한: 없음
- A-15 (2026-11-25, W-8) Codex용 따로 묶음 없음 · 확인 결과(codex-cli 0.167.0, 격리한 CODEX_HOME): Codex가 `.claude-plugin/marketplace.json`을 읽고 `allot@allot`을 설치해 스킬 7개가 들어감. 플러그인의 MCP 주소(`${user_config.server_url}`)는 풀지 않지만 `codex mcp add allot --url …`로 더한 사용자 설정이 같은 이름을 덮음. Antigravity CLI(agy 1.5.14, 격리한 HOME)도 Claude Code 플러그인을 변환해 스킬 7개를 설치, MCP는 `agy mcp add`. 이 기계의 Gemini CLI는 0.1.9(확장 명령 없음)라 Gemini 확장은 형식만 확인(단위 시험) · 8d3b157 · 예전 입력 거부·새 제한: 없음
- A-16 (2026-11-25, W-5, 리뷰 1 R1-1) 앱이 대화 확인 제안을 스스로 적용하려면 지금 그 토큰과 연결이 둘 다 '대화에서 확인'이어야 함 · 권한을 화면 확인으로 좁힌 뒤에도 예전 대화 제안을 앱이 적용할 수 있었음(키는 확인 방식을 바꾸면 대기 제안을 화면 확인으로 옮김, A-9의 뜻) · 4d536cb · 예전 입력 거부·새 제한: 없음(A-9가 정한 좁힘을 적용에도 지킴; 키의 동작은 그대로)
- A-17 (2026-11-25, W-5, 리뷰 1 R1-4) 지금 연결(동의 행)이 생기기 전에 발급된 토큰은 거절 · 끊었다가 다시 연결하면 끊기 전 토큰이 다시 통했음(S-7 "끊으면 바로 401") · f2748d8 · 예전 입력 거부·새 제한: 없음(S-7의 뜻)
- A-18 (2026-11-25, W-4, 리뷰 1 R1-3) `/oauth/*` 화면에 `frame-ancestors 'none'`·`X-Frame-Options: DENY`(운영 이미지의 서버) · 다른 사이트가 동의 화면을 프레임에 넣어 '허락'을 누르게 하지 못하게. 이 두 경로에만, 다른 화면의 프레임은 그대로. `vite preview`(:15173)는 OAuth를 쓸 수 없어(A-5) 두지 않음 · 728da86 · 예전 입력 거부·새 제한: 없음
- A-19 (2026-11-25, W-7, 리뷰 1 R1-2) 구독 스킬은 해지·플랜 변경을 `plan-changes`로만 제안하고, 영수증 스킬은 구독과 맞으면 구독 화면의 영수증 확인을 안내 · `list_subscriptions`는 계산된 보기라 구독 행 수정에 보낼 저장 행(`nextDate`·기본 플랜)이 없음 · 1bb4b29 · 예전 입력 거부·새 제한: 없음
- A-20 (2026-11-25, W-11, 시험 V-7) 낡은 E2E 기대값 둘을 spec대로 고침: `api-keys.spec.ts`는 설정의 주소가 `/mcp`이고 키 주소 `/api/mcp` 줄과 '연결된 앱'이 보이는지 봄(전엔 `/api/mcp`와 '0.1.11' 준비 중 문구), `redesign.spec.ts`의 준비 중 목록에서 '연결된 앱 관리'를 뺌 · W-6이 S-10·S-11대로 화면을 바꿀 때 이 두 시험을 같이 고쳤어야 함(전체 E2E 1회차 `test/v7-e2e-all.log`에서 실패) — 1차 감사 F-6: 동기화가 늦은 것 자체가 절차 위반(knowledge `2026-11-24_stale-test-expectations`), 고친 내용은 감사가 '통과시키려고 바꾼 것 아님'으로 판정 · 2665251 · 예전 입력 거부·새 제한: 없음
- A-21 (2026-11-25, W-10, 시험 V-8) README와 두 플러그인 README에 '`allot`과 `allot-key` 중 하나만 설치' · 둘 다 켜고 둘 다 설정하면 `claude mcp list`에 `plugin:allot:allot` 하나만 나옴(Claude Code 2.1.327, `test/v8-dedup.log`; 리뷰 4 R4-1: 처음 인용한 `v8-allot-key-1-dedup.log`는 설정 반영 전이라 원인을 가르지 못함). `allot`을 끄면 `allot-key`가 목록에 나옴(`test/v8-dedup-off.log`; 리뷰 5 R5-1). 시험 키로의 연결과 폐기 뒤 401은 `v8-allot-key.log` · c87b633 · 예전 입력 거부·새 제한: 없음
- A-22 (2026-11-25, W-8, 1차 감사 F-3) 저장소에 `LICENSE`(GNU AGPL v3, FSF 원문 그대로 — 이 기계의 세 패키지 사본과 sha256 같음)를 두고 `package.json`·두 plugin.json에 `license: AGPL-3.0-or-later`, README에 라이선스 절 · 설계의 "LICENSE가 있다"가 빠져 있었음. 라이선스와 표기는 사용자가 고름("AGPL-3.0", "AGPL-3.0-or-later") · 26e100e · 예전 입력 거부·새 제한: 없음
- A-23 (2026-11-25, W-7, 리뷰 2 R2-1, 1차 감사 F-5) 두 스킬의 플랜 변경 제안 안내에 입력 필드(`subId`·`effective`·`to`·`note`)를 적음 — A-19의 후속 · `list_plan_changes`의 `subscriptionId`를 그대로 보내면 거부됨 · c75003a · 예전 입력 거부·새 제한: 없음(스킬 글만). 기록의 한계(F-5): A-16~A-19의 '예전 입력 거부·새 제한' 칸은 구현 커밋 뒤의 기록 커밋 7e4cce4에서 처음 커밋됐고, 구현 커밋 전에 적었는지는 기록으로 확인할 수 없음. 판단은 리뷰 1 보고서(`refuses-input: no`)에 있었음
- A-24 (2026-11-25, 시험, 1차 감사 F-1·F-2 — 사용자 처리) 이 버전에서 돌리지 못한 검사를 V-9로 넘김: V-3의 Dex 검사(`login-methods.mjs`·`oidc-flows.mjs`; :15174에 Dex 없음, 0.1.8과 같은 한계), V-7·S-5의 OIDC·GitHub·Google 로그인 뒤 동의로 이어지기, V-8의 Codex·Antigravity 도구 호출과 Claude Code의 개별 도구 호출. rc를 사용자 서버에 올린 뒤 V-9에서 확인. F-2(:15174 겹침)는 다시 돌리지 않고 수용. 사용자: "V-9로 넘김 (추천)", "그대로 수용" · 기록만 · 예전 입력 거부·새 제한: 없음

## 우려
- **Better Auth를 올리면 로그인이 흔들릴 수 있다**(1.7.18 → 1.7.27/28): V-3으로 막는다. 문제가 나면 1.7.18 + pnpm override(조사 A.3 (a))로 돌아가고, 조정 기록에 남긴다.
- **로그인 뒤 동의로 이어지기**가 OIDC 콜백에서도 되는지 확인되지 않았다(조사). 안 되면 OIDC 사용자에게 "다시 시도"를 안내하는 방안을 조정으로 묻는다.
- **DCR 남용**: 누구나 클라이언트를 등록할 수 있다. 1분에 5번 제한, 스위치 기본 꺼짐, 동의가 없으면 토큰이 나가지 않는다. 쓰이지 않는 클라이언트 정리는 이번 범위가 아니다(범위 밖).
- **Gemini와 갱신 토큰 회전**: Google은 회전하지 않는 갱신 토큰을 바란다. 회전 때문에 Gemini에서 끊기면 기록만 한다(intent 제약).
- **프로토콜 판**: Claude 앱들은 2025-11-25 판까지 적혀 있다(조사). 지금 전송의 판 협상을 바꾸지 않는다.
- **Codex 위치**: Codex 형식이 `.agents/plugins/`를 요구하면 이 저장소의 `.agents/`(에이전트 하니스)와 섞인다. 그러면 하니스 파일과 분리해 둘 수 있는지 보고, 안 되면 조정으로 묻는다.

## 범위 밖
- intent의 하지 않을 것 전부: 공식 디렉터리·갤러리, AWS 검토, 패스키, 앱 안 채팅(0.1.11), MCP 도구 변경, 0.1.10 항목, 다른 로그인 변경, Gemini 앱 확인.
- 쓰이지 않는 OAuth 클라이언트 자동 정리, DPoP, `private_key_jwt`, 장치 인가(RFC 8628).
- 관리자가 다른 사용자의 연결을 보거나 끊는 기능.
