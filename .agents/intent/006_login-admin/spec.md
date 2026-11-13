---
intent: "006"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-13"
    words: "진행"
    rev: 3b36137
summary_for_user: |
  로그인은 비밀번호·일반 OIDC·GitHub·Google 네 가지입니다. 각각 env나 관리자 화면에서 켜고 끄고, 화면에서 저장하면 재시작 없이 반영됩니다(인증 인스턴스를 다시 만듭니다). env로 정한 값이 우선하고, 화면에는 잠긴 채로 보입니다.
  가입은 제공자마다 닫힘·승인 대기·규칙 중 하나입니다. 승인 대기 사용자는 세션을 받지 못합니다. 규칙으로 들어온 사용자는 로그인할 때마다 규칙을 다시 확인합니다.
  관리자 메뉴는 계정 정보만 다루고 금융 데이터는 보지 않습니다. 대신 로그인하기(impersonation)는 막고, 마지막 관리자와 자기 자신은 지울 수 없습니다. 완전 삭제는 그 사용자의 데이터·변경 기록·계정을 한 트랜잭션에서 지웁니다.
  암호화 모듈(AES-256-GCM, 사용자별 키, ALLOT_MASTER_KEY 필수)로 외부 로그인 토큰 3종과 화면에서 넣은 클라이언트 시크릿을 저장합니다. 모바일은 bearer와 일회용 토큰으로 앱 주소에 돌아오는 경로까지, 서버 쪽만 합니다.
  정정: GitHub·Google 실제 로그인은 사용자 계정이 있어야 하므로 제가 끝까지 할 수 없습니다. 제공자 화면으로 넘어가는 데까지는 자동으로 확인하고, 로그인 한 번은 사용자가 직접 한 뒤 결과를 제가 검사합니다. Google은 http 주소로 localhost만 허용해서, 그 확인은 localhost로 열어야 합니다.
---
## 요구 해석
- S-1 "로그인 방식 네 가지: 일반 OIDC, GitHub, Google, 비밀번호. 각각 켜고 끌 수 있다 — env로, 또는 관리자 화면의 설정으로." + 에이전트 결정 "env가 이긴다", "기본값은 가장 닫힌 쪽" → 항목마다 env 값이 있으면 그 값을 쓰고 화면에서는 잠긴다. 아무 설정이 없으면 비밀번호만 켜진다. 화면에서 바꾼 값은 재시작 없이 반영된다(PM 해석).
- S-2 "제공자마다 가입 정책을 고른다: 관리자가 만든 계정만 / 승인 대기 → 관리자가 승인 / 규칙에 맞으면 바로 사용(OIDC group, GitHub organization, Google 도메인이나 이메일 목록)." → 정책 `closed`·`approval`·`rules`. 이메일 목록 규칙은 세 제공자 모두에 쓸 수 있다. PM 해석: 규칙으로 들어온 사용자는 로그인할 때마다 규칙을 다시 확인한다. 제공자에서 group을 빼면 접근도 끊긴다.
- S-3 "관리자 메뉴: 사용자 목록, 계정 만들기, 승인 대기 처리, 정지·해제, 역할, 로그인 방식 설정." + "관리자는 금융 데이터를 보지 않는다", "impersonation도 끈다".
- S-4 "초기 관리자를 env로: 이메일(`ADMIN_EMAIL`) 또는 OIDC 계정 식별자(issuer + subject). 지금 계정과 데이터는 그대로이고, 그 계정이 관리자가 된다."
- S-5 "암호화 모듈: AES-256-GCM 봉투 암호화(사용자별 데이터 키를 마스터 키로 포장). 외부 로그인 토큰부터." + 질문 1 답 "b" → 화면에서 넣은 클라이언트 시크릿도 암호화해 저장한다. 시크릿은 다시 보여주지 않는다.
- S-6 "bearer 토큰으로도 API를 부를 수 있고, 외부 로그인 뒤 앱 주소(deep link)로 돌아올 수 있다. 앱 자체는 0.1.9."
- S-7 "새 클론에서 데이터 파일 없이 관리자 계정만 만들 수 있다. 새 사용자는 빈 데이터로 시작한다."
- S-8 질문 2 답 "b" → 정지(해제 가능)와 완전 삭제(데이터까지, 한 번 더 확인). 자기 자신과 마지막 관리자는 지울 수 없다.
- S-9 질문 3 답 "1(a)", "테스트 하기 전에 직접 넣어주는 거로" → GitHub·Google 테스트 앱 값은 사용자가 `docker/.env.dev`에 넣는다. PM 정정: 실제 로그인은 사용자 계정으로만 끝까지 갈 수 있다. 그래서 제공자 화면으로 넘어가는 데까지는 자동으로 검사하고, 로그인 한 번은 사용자가 한 뒤 그 결과를 PM이 검사한다(V-13).
- S-10 "운영에서는 Dex 쓸건데 … Authentik이든 KeyCloak이든 호환은 다 되어야 한다" → 일반 OIDC는 표준만 쓰고 제공자별 분기를 두지 않는다. group·subject 클레임 이름은 설정값이다. E2E는 Dex로 한다.
- S-11 "외부 계정 연결 기준은 issuer + subject(이메일 아님)" + "비밀번호 끄기 안전장치".

## 설계
### 설정 계층 (S-1, S-5)
- 새 표 `auth_provider`(전역, `user_id` 없음, RLS 없음 — 사용자 데이터가 아니고 로그인 전에 읽힌다):
  - 열: `id`(`password`·`oidc`·`github`·`google`), `enabled`, `signup`(`closed`·`approval`·`rules`), `rules jsonb`(`groups[]`, `orgs[]`, `domains[]`, `emails[]`), `options jsonb`(표시 이름, discovery URL, client id, scope, group·subject 클레임 이름), `client_secret_enc text`(암호문), `updated_at`, `updated_by`.
  - 이 표는 관리자 API와 설정 읽기 함수만 다룬다.
- env(가칭, spec 승인 뒤 `.env.example`에 확정):
  - 제공자별(`<P>` = `PASSWORD`·`OIDC`·`GITHUB`·`GOOGLE`): `AUTH_<P>_ENABLED`, `AUTH_<P>_SIGNUP`, `AUTH_<P>_ALLOW_EMAILS`(쉼표 구분).
  - 외부 제공자 공통: `AUTH_<P>_CLIENT_ID`, `AUTH_<P>_CLIENT_SECRET`.
  - OIDC만: `AUTH_OIDC_DISCOVERY_URL`, `AUTH_OIDC_NAME`, `AUTH_OIDC_SCOPES`, `AUTH_OIDC_GROUPS_CLAIM`(기본 `groups`), `AUTH_OIDC_ALLOW_GROUPS`.
  - GitHub·Google만: `AUTH_GITHUB_ALLOW_ORGS`, `AUTH_GOOGLE_ALLOW_DOMAINS`.
- 합치기: `loadAuthConfig()`가 기본값 ← DB ← env 순으로 덮는다. 항목마다 출처(`default`·`db`·`env`)를 함께 돌려준다. 관리자 API는 출처가 `env`인 항목을 바꾸려 하면 409로 거절한다.
- 다시 만들기: Better Auth 설정은 시작할 때 한 번 정해진다(제공자 목록은 컨텍스트를 만들 때 고정, 1.7.18 조사). 그래서 `server/auth.ts`가 `getAuth()`로 지금 인스턴스를 주고, 관리자가 설정을 저장하면 `reloadAuth()`가 새 인스턴스를 만들어 바꿔 끼운다.
  - 세션은 DB에 있고 secret이 같으므로 기존 세션은 그대로 유효하다.
  - 새 인스턴스를 만들지 못하면(설정 오류) 저장을 롤백하고 400을 돌려준다. 이전 인스턴스는 그대로 쓴다.
- 이중 방어: `hooks.before`가 요청마다 지금 설정을 보고, 꺼진 제공자에 대한 `/sign-in/social`·`/link-social`·`/callback/:id`, 비밀번호가 꺼졌을 때의 `/sign-in/email`을 403으로 막는다.
- 공개 엔드포인트 `GET /api/auth-methods`(세션 없이): 켜진 방식의 id와 표시 이름만 준다. client id·URL·규칙은 주지 않는다.
- 비밀번호 끄기 안전장치(S-11): 관리자 가운데 누구도 켜진 외부 제공자에 연결된 계정이 없으면 비밀번호를 끌 수 없다(409). `AUTH_PASSWORD_ENABLED=true`는 언제나 켜고, 화면에서 잠근다(비상구).
- 운영 모드(`TRUSTED_ORIGINS` 설정됨)에서는 discovery URL이 https여야 한다. 개발은 http도 허용한다.

### 제공자 (S-1, S-10, S-11)
- **일반 OIDC**: Better Auth `genericOAuth`, providerId `oidc`, 0.1.2에서는 하나만.
  - 쓰는 표준: `discoveryUrl`, `pkce: true`, `requireIdTokenVerification: true`(JWKS로 서명·iss·aud·exp 검증, JWKS가 없으면 그 제공자를 켜지 않는다).
  - `accountSubject`가 계정 키를 issuer와 subject의 조합으로 만든다(구분자는 URL에 쓸 수 없는 문자). issuer는 discovery 문서의 값이다. 그래서 discovery URL을 다른 issuer로 바꾸면 예전 연결로는 로그인되지 않는다.
  - client가 보낸 `idToken`으로 하는 `/sign-in/social`은 hook으로 막는다(code flow만 쓴다).
  - Dex·Authentik·Keycloak에 쓰는 전용 코드는 없다. 다른 점은 group 클레임 이름 정도이고, 설정으로 바꾼다.
- **GitHub**: 내장 `socialProviders.github`.
  - org 규칙을 켰을 때만 `read:org` scope를 더하고, `getUserInfo`를 직접 구현한다(`/user`, `/user/emails`, `/user/orgs`). org 목록은 profile의 `data`로 규칙 검사에 넘긴다.
  - 계정 키는 GitHub 숫자 id다.
- **Google**: 내장 `socialProviders.google`(`disableIdTokenSignIn: true`). 도메인 규칙은 ID 토큰의 `hd` 클레임, 이메일 규칙은 `email` + `email_verified`로 본다. 계정 키는 `sub`다.
- **비밀번호**: 지금과 같다(`disableSignUp: true`, 로그인 5회/분).
- 외부 계정 연결(S-11):
  - 이메일만 같다고 기존 계정에 자동으로 붙지 않는다.
  - 예외는 관리자가 만든 "연결 대기" 계정 하나뿐이다. 그 계정의 이메일과 제공자의 확인된(verified) 이메일이 같으면, 처음 로그인할 때 연결된다. 이 판정은 `user.validateUserInfo`(`source.action = 'link-account'`)에서 한다.
  - 로그인한 사용자는 내 계정 화면에서 다른 제공자를 직접 연결·해제할 수 있다(`/link-social`, `/unlink-account`). 마지막 로그인 방식은 해제할 수 없다.
- 토큰 엔드포인트 `/get-access-token`·`/refresh-token`·`/account-info`는 0.1.2에서 쓸 곳이 없고 암호문을 돌려주게 되므로 `disabledPaths`로 닫는다. Better Auth 자체 토큰 암호화(`encryptOAuthTokens`)는 ID 토큰을 평문으로 두므로 쓰지 않는다. 대신 아래 암호화 모듈을 쓴다.

### 가입 정책과 상태 (S-2, S-4)
- `user`에 열을 더한다(Better Auth `additionalFields`, `input: false`):
  - `status`: `active` 또는 `pending`.
  - `admission`: `seed`·`admin`·`approval`·`rule`·`bootstrap` — 어떻게 들어왔는지.
  - admin 플러그인이 `role`·`banned`·`banReason`·`banExpires`, session의 `impersonatedBy`를 더한다.
  - 마이그레이션: 기존 사용자는 `active`·`seed`로 채운다. 관리자가 한 명도 없고 사용자가 정확히 한 명이면 그 사용자를 `admin`으로 만든다(custom 데이터 이동, 0.1.1의 귀속 규칙과 같은 방식).
- 새 외부 로그인 사용자(`source.action = 'create-user'`):
  - `closed`: 거절한다. 오류 코드는 `SIGNUP_CLOSED`이고, 사용자 행은 생기지 않는다.
  - `approval`: `pending`으로 만든다.
  - `rules`: 규칙에 맞으면 `active`·`rule`로 만들고, 맞지 않으면 `NOT_ALLOWED`로 거절한다.
  - 규칙끼리는 OR다(group·org·domain·email 중 하나라도 맞으면 된다). 규칙이 비어 있으면 아무도 맞지 않는다.
- 기존 사용자의 로그인(`source.action = 'sign-in'`): `admission = 'rule'`인 사용자는 새 profile로 규칙을 다시 본다. 맞지 않으면 `NOT_ALLOWED`로 거절한다. 관리자가 만들거나 승인한 사용자는 규칙을 다시 보지 않는다.
- `pending` 사용자: `session.create.before`가 `PENDING_APPROVAL`로 거절하므로 세션을 받지 못한다. 로그인 화면이 오류 코드를 보고 "관리자 승인을 기다리고 있어요"를 보여준다. 데이터 API 미들웨어도 `status ≠ active`나 `banned`이면 403을 돌려준다(두 번째 겹).
- 초기 관리자(S-4):
  - 서버가 시작할 때 `ADMIN_EMAIL` 사용자가 있으면 `role = admin`, `status = active`로 둔다.
  - `ADMIN_OIDC_SUBJECT`(지금 OIDC issuer의 subject)로 처음 로그인하면, 가입 정책과 관계없이 `admin`·`active`·`bootstrap`으로 만들어진다.
  - env가 사라져도 관리자를 내리지 않는다.

### 관리자 (S-3, S-8)
- Better Auth `admin` 플러그인을 쓴다. 정책 훅은 `server/auth.ts`의 `hooks.before`와 `databaseHooks`에 둔다.
- 쓰는 엔드포인트: `list-users`, `create-user`, `update-user`(승인 = `status: active`, `admission: approval`), `ban-user`(세션도 지운다)·`unban-user`, `set-role`, `set-user-password`(비밀번호 재설정), `revoke-user-sessions`.
- 막는 엔드포인트: `impersonate-user`·`stop-impersonating`·`remove-user`를 `disabledPaths`로 닫는다. `hooks.before`에서도 던져서 `auth.api` 호출까지 막는다.
  - `remove-user`를 막는 이유: 세션과 계정을 먼저 지운 뒤 사용자 삭제가 데이터의 restrict 외래 키에 걸려 반쯤 지워진 채로 끝난다.
- 계정 만들기: 이메일·이름. 비밀번호 로그인이 켜져 있으면 임시 비밀번호를 받는다. 비워 두면 "연결 대기" 계정이 되고, 처음 외부 로그인할 때 연결된다(위). `admission = admin`, `status = active`.
- 마지막 관리자 보호: 남은 활성 관리자가 한 명이면 그 사람을 강등·정지·삭제할 수 없다(409). 자기 자신도 정지·삭제할 수 없다.
- 완전 삭제 `DELETE /api/admin/users/:id`(본문 `{ confirmEmail }`이 그 사용자 이메일과 같아야 한다):
  1. 한 트랜잭션 안에서 그 사용자로 `set_config`(RLS)를 한다.
  2. 데이터 표 12개와 `change_log`·`change_set`, 데이터 키(`user_key`)를 자식부터 지운다(`server/db/owned.ts`의 순서를 거꾸로).
  3. `user`를 지운다. `session`·`account`는 외래 키 연쇄로 함께 지워진다.
- 관리자 API(`/api/admin/*`, zod 검증): 제공자 설정 읽기·쓰기, 완전 삭제. 응답에는 `auth_provider`와 `user`의 계정 열만 나간다.
  - 클라이언트 시크릿은 읽기 응답에 `{ set: true|false }`로만 나온다. 쓰기는 바꾸기·지우기만 된다.
  - 관리자가 다른 사용자의 데이터 표를 읽는 경로는 없다. 0.1.1의 앱 조건 + RLS가 그대로 남는다.
- 비밀번호 재설정 메일은 없다(intent). 관리자가 임시 비밀번호를 정하고 그 사용자의 세션을 끊는다.

### 암호화 모듈 (S-5)
- `server/crypto/envelope.ts`: Node `crypto`, AES-256-GCM, 12바이트 nonce.
  - 포맷: `v1.<kid>.<nonce>.<ciphertext>.<tag>`(base64url).
  - AAD: `table:column:row_id:owner`(owner는 user id 또는 `system`). 암호문을 다른 행이나 열로 옮기면 풀리지 않는다.
- 키:
  - `ALLOT_MASTER_KEY`: base64 32바이트, **필수**. 없거나 길이가 틀리면 서버가 이유를 출력하고 시작하지 않는다.
  - `kid`: 마스터 키의 SHA-256 앞 8자.
  - `ALLOT_MASTER_KEY_PREVIOUS`(선택, 쉼표 구분): 키를 교체하는 동안 옛 키로 포장된 데이터 키를 풀 때 쓴다.
- 데이터 키:
  - 사용자별: `user_key(user_id pk, kid, wrapped, created_at)`. `user_id`가 있으므로 RLS를 걸고 FORCE한다(0.1.1 규칙, 시작 검사 대상).
  - 시스템용(클라이언트 시크릿): `system_key(id, kid, wrapped)`. 처음 쓸 때 만든다.
- 교체: `pnpm keys:rotate`가 모든 데이터 키를 지금 마스터 키로 다시 포장한다. 데이터는 다시 암호화하지 않는다.
- 쓰는 곳:
  - `account`의 `access_token`·`refresh_token`·`id_token`: `databaseHooks.account.create.before`가 암호화한다. 0.1.2에는 읽는 곳이 없다. 0.1.7(Gmail)이 처음 읽는다.
    - 구현 중 정정(W-3): `update.before`는 바뀌는 열만 받고 어느 행인지 몰라 소유자 키를 고를 수 없다. 그래서 토큰 갱신은 평문으로 쓰지 않고 버린다. 로그인할 때의 토큰 갱신은 `account.updateAccountOnSignIn: false`로 끈다. 저장된 토큰은 연결할 때 암호화한 값으로 남는다. 갱신 방식은 0.1.7이 정한다.
  - `auth_provider.client_secret_enc`: 시스템 키로 암호화한다. 인증 인스턴스를 만들 때만 푼다.
- 로그: 평문 시크릿·토큰·마스터 키를 로그나 오류 응답에 쓰지 않는다. 오류는 "복호화 실패(kid …)"까지만 쓴다.
- 마스터 키를 잃으면 암호화된 토큰과 화면에서 넣은 시크릿만 못 쓴다. 다시 로그인하고 시크릿을 다시 넣으면 된다(README).

### 모바일 대비 (S-6)
- `bearer` 플러그인: 로그인 응답의 `set-auth-token` 헤더를 받아 `Authorization: Bearer`로 `/api/*`를 부를 수 있다. 데이터 API의 세션 확인도 같은 `getSession`을 쓰므로 따로 바꿀 것이 없다.
- 외부 로그인 뒤 앱으로 돌아오기(`oneTimeToken` 플러그인):
  1. 앱이 시스템 브라우저로 `https://<앱>/#app-login?return=<앱 주소>`를 연다.
  2. 이 페이지가 브라우저에서 `signIn.social`을 시작한다(state 쿠키가 브라우저에 있게 하려는 것; 조사 결과 앱이 직접 시작하면 `state_mismatch`).
  3. 로그인이 끝나면 페이지가 `/one-time-token/generate`로 3분짜리 일회용 토큰을 받는다. `return`이 `ALLOT_APP_RETURN_URLS`(env, 쉼표 구분, 기본 비어 있음 = 기능 꺼짐) 목록과 정확히 같을 때만 `<앱 주소>?ott=…`로 보낸다.
  4. 앱이 `/one-time-token/verify`로 토큰을 bearer 세션으로 바꾼다.
- 목록에 있는 앱 주소의 scheme은 `trustedOrigins`에도 더해서, 앱이 `callbackURL`로 직접 넘길 때도 검증을 통과하게 한다. 목록에 없는 scheme과 다른 사이트 주소는 거절된다.
- 요청 제한: `/one-time-token/verify` 10회/분, `/sign-in/social` 10회/분.

### 시드와 새 사용자 (S-7)
- `pnpm db:admin`: 데이터 파일 없이 `ADMIN_EMAIL`·`ADMIN_PASSWORD`로 관리자 계정만 만들거나 갱신한다(`role = admin`). 새 클론은 이 명령으로 시작한다(README).
- `pnpm db:seed [file]`: 지금처럼 관리자 계정 + 데이터. 다른 계정이 있으면 실패하던 규칙은 없앤다(이제 여러 사용자가 정상이다).
  - `--replace-admin`은 `--replace-admin <옛 이메일>`로 바꾼다. 옮길 계정을 명시해야 하고, 그 계정의 데이터를 새 관리자에게 옮긴 뒤 옛 계정을 지운다.
- 새 사용자의 빈 데이터: `/api/state`에 `settings`·`living` 행이 없으면 409 대신 기본값으로 답한다. 기본값은 공유 상수 하나(`src/data/defaults.ts`)이고, 서버와 화면이 같이 쓴다. 읽기에서는 쓰지 않는다. 처음 저장할 때 행이 생긴다(지금의 upsert 그대로).

### 화면
- 로그인:
  - `/api/auth-methods`로 켜진 방식만 보여준다(비밀번호 폼, 제공자 버튼).
  - `?error=` 코드(`SIGNUP_CLOSED`·`NOT_ALLOWED`·`PENDING_APPROVAL`·`BANNED_USER`·`account_not_linked`)마다 한국어 안내를 보여준다.
- "계정" 페이지(모든 사용자): 내 이메일·역할, 연결된 로그인 방식(연결·해제), 비밀번호 바꾸기(비밀번호가 켜져 있고 credential이 있을 때).
- "관리" 페이지(관리자만 메뉴가 보이고, API는 서버에서 다시 막는다):
  - 사용자 탭: 목록(이메일·이름·역할·상태·들어온 방식·만든 날), 만들기, 승인, 정지·해제, 역할, 비밀번호 재설정, 세션 끊기, 완전 삭제(이메일을 입력해 확인).
  - 로그인 방식 탭: 제공자별 켜기, 가입 정책, 규칙, OIDC 설정, 시크릿 바꾸기. env 항목은 잠금 표시와 함께 보여준다.
  - 목록 편집은 `EditSheet` + `useEditor`를 쓴다.
- 앱 로그인 중계 페이지(`#app-login`): 화면 요소 없이 진행 안내만 보여준다.

### 개발·테스트 스택 (S-9, S-10)
- `docker/compose.dev.yaml`에 `dex` 서비스를 더한다(공식 이미지, 정확한 버전 고정). 포트는 공개하지 않는다.
  - Vite 프록시가 `/dex`를 `dex:5556`으로 넘긴다. 이 프록시는 `DEX_URL`이 있을 때만, 즉 개발 compose에서만 켜진다.
  - Dex issuer는 `${BETTER_AUTH_URL}/dex`이다. 브라우저와 api 둘 다 15173 하나로 닿는다.
- Dex 설정은 `docker/dex/config.yaml`에 커밋한다. 테스트 사용자·client·secret은 모두 가짜 값이고 env로 덮는다.
  - group 클레임 테스트에는 Dex의 mock 커넥터를 쓴다(우려 3).
- GitHub·Google 테스트 앱 값은 사용자가 `docker/.env.dev`에 넣는다(`AUTH_GITHUB_*`, `AUTH_GOOGLE_*`). 콜백 주소는 `${BETTER_AUTH_URL}/api/auth/callback/<github|google>`이다.

### 문서
- `.env.example`: 새 env 전부(자리표시자만).
- README:
  - 로그인 방식 설정. Dex·Authentik·Keycloak의 discovery URL과 group 클레임 예시를 싣되 "검사함"이라고 쓰지 않는다.
  - 마스터 키 만들기·교체·분실.
  - 새 클론 시작(`pnpm db:admin`).
  - 앱 주소 등록.
- CHANGELOG: 업그레이드 주의(`ALLOT_MASTER_KEY` 필수, 기존 계정이 관리자가 됨).
- `docker/compose.yaml`: 새 env를 넘긴다.

## 작업 단위
- [x] W-1 암호화 모듈: `server/crypto/envelope.ts`, `user_key`(+RLS·FORCE)·`system_key` 스키마와 마이그레이션, 마스터 키 필수 검사, `pnpm keys:rotate`, 단위 테스트(`tests/unit/` 또는 `tests/api/crypto.mjs`). (S-5)
- [x] W-2 설정 계층: `auth_provider` 스키마, `loadAuthConfig()`(기본 ← DB ← env, 출처), `getAuth()`/`reloadAuth()`, `hooks.before` 제공자·비밀번호 게이트, `/api/auth-methods`, 비밀번호 끄기 안전장치, 기존 `auth` 사용처를 `getAuth()`로 바꾸기. (S-1, S-11)
- [x] W-3 제공자: genericOAuth(OIDC, issuer+subject 키, idToken 로그인 차단), GitHub(org 조회 `getUserInfo`), Google, 토큰 암호화 훅, 토큰 엔드포인트 닫기, 연결 규칙(`validateUserInfo` link-account), 요청 제한 규칙. (S-1, S-10, S-11)
- [x] W-4 가입 정책: `status`·`admission` 열과 마이그레이션(기존 사용자 active·seed, 유일 사용자 admin), `validateUserInfo` create·sign-in 규칙, `session.create.before` 승인 대기 거절, 데이터 API 상태 검사, 초기 관리자(시작 시 `ADMIN_EMAIL`, `ADMIN_OIDC_SUBJECT`). (S-2, S-4)
- [x] W-5 관리자 서버: admin 플러그인, impersonation·remove-user 닫기, 마지막 관리자·자기 자신 보호, 계정 만들기(연결 대기), `/api/admin/*`(제공자 설정, 시크릿 암호화 저장, 완전 삭제). (S-3, S-5, S-8)
- [x] W-6 화면: 로그인(방식 목록, 오류 안내), 계정 페이지, 관리 페이지(사용자·로그인 방식), 메뉴, 저장소 연결, E2E. (S-1~S-3, S-8)
- [x] W-7 모바일 대비: bearer, oneTimeToken, `#app-login` 중계 페이지, `ALLOT_APP_RETURN_URLS`와 trustedOrigins scheme. (S-6)
- [x] W-8 시드·새 사용자: `pnpm db:admin`, `db:seed` 규칙 변경과 `--replace-admin <email>`, `/api/state` 기본값과 `src/data/defaults.ts`, 기존 테스트(`isolation.mjs`의 409 기대 등) 갱신. (S-7)
- [x] W-9 개발 Dex와 문서: compose.dev `dex`, `docker/dex/config.yaml`, Vite `/dex` 프록시, `.env.example`, `docker/compose.yaml` env, README, CHANGELOG. (S-9, S-10)

순서: W-1 → W-2 → W-3 → W-4 → W-5 → W-6. W-7은 W-2 뒤면 언제든 된다. W-8은 독립이다. W-9의 Dex 부분은 W-3 검사 전에 먼저 한다. 각 W는 게이트를 통과하는 커밋으로 끝나고, 커밋 메시지에 W 번호를 적는다.

## 검증 기준
모든 원본은 `.loctx/reports/0.1.2/test/`에 명령, 대상 rev, 종료 코드와 함께 남긴다(지식 2026-11-12 check-evidence). 기대와 다르거나 종료 코드가 없으면 실패다. 기준을 바꿔야 하면 판정 전에 spec 변경 승인을 받는다. 로그인 요청 제한(5회/분)은 테스트마다 계정을 나누거나 간격을 둔다(지식 2026-11-12 login-rate-limit).

- V-1 게이트: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build && pnpm build:server` 모두 exit 0.
- V-2 업그레이드 동등성: v0.1.1(마이그레이션 0000~0012)에 로컬 시드를 넣은 DB를 만들고 `/api/state`와 36개월 분배를 저장한다. 새 마이그레이션을 적용하고 같은 것을 다시 저장한다. 기대: 두 JSON 차이 0, 기존 계정이 `role = admin`·`status = active`, 비밀번호 로그인 200.
- V-3 암호화 단위 테스트: (a) 암호화 → 복호화가 원문과 같다. (b) 암호문·nonce·tag·AAD(행 id, 열, 소유자) 중 하나를 바꾸면 복호화 실패. (c) 모르는 kid는 실패. (d) `ALLOT_MASTER_KEY_PREVIOUS`에 옛 키, 새 키로 `keys:rotate` → 모든 `user_key`·`system_key`의 kid가 새 키, 기존 암호문이 풀린다. (e) 마스터 키가 없거나 32바이트가 아니면 서버가 non-zero로 끝나고 이유를 출력한다.
- V-4 설정: (a) env 없음·DB 없음 → `/api/auth-methods`가 비밀번호만. (b) DB로 OIDC를 켠다 → 재시작 없이 목록에 나오고 로그인 시작 302. (c) 끈다 → 목록에서 빠지고 `/sign-in/social`·`/callback/oidc`가 403. (d) env로 정한 항목을 관리자 API로 바꾸려 하면 409, DB는 그대로. (e) 잘못된 discovery URL 저장 → 400, 이전 설정 그대로 동작. (f) `/api/auth-methods` 응답에 client id·URL·규칙·시크릿이 없다.
- V-5 OIDC(Dex, E2E): (a) `closed` → 새 Dex 사용자 로그인이 `SIGNUP_CLOSED`로 거절, `user` 행 없음. (b) `approval` → 사용자 `pending`, 세션 없음, 로그인 화면에 승인 대기 안내. 관리자가 승인 → 다시 로그인하면 앱이 열린다. (c) `rules` + 맞는 group → `active`·`rule`. 맞지 않는 group → `NOT_ALLOWED`. (d) 규칙을 바꿔 그 group을 뺀다 → 그 사용자의 다음 로그인이 `NOT_ALLOWED`. (e) 저장된 계정 키에 Dex issuer와 subject가 들어 있다. client가 보낸 `idToken`으로 `/sign-in/social` → 거절.
- V-6 연결: (a) 관리자가 비밀번호 없이 만든 계정(이메일 = Dex 사용자, 확인된 이메일) → 첫 OIDC 로그인으로 연결되고 그 계정으로 로그인된다. (b) 연결 대기가 아닌 기존 계정과 이메일만 같은 Dex 사용자 → `account_not_linked`. (c) 내 계정 화면에서 연결한 뒤 해제할 수 있다. 마지막 방식 해제는 거절. (d) discovery URL을 다른 issuer(두 번째 Dex 설정 또는 issuer만 바꾼 Dex)로 바꾸면 예전 연결로는 그 계정에 로그인되지 않는다.
- V-7 관리자 권한: (a) 일반 사용자 세션으로 `/api/admin/*`와 `/api/auth/admin/*` 각각 → 403. (b) `impersonate-user`·`stop-impersonating`·`remove-user`는 관리자도 404 또는 403. (c) 관리자 API 응답 전체에 데이터 표 열 이름(`net_pay`, `amount` 등)이 없다. (d) 관리자 세션의 `/api/state`는 관리자 자신의 데이터만 준다(0.1.1 V-5 방식으로 B의 데이터가 안 보임).
- V-8 관리자 동작: (a) 계정 만들기·승인·역할·비밀번호 재설정 → 각각 기대 상태. 재설정 뒤 그 사용자의 기존 세션은 401. (b) 정지 → 세션 401, 로그인 `BANNED_USER`. 해제 → 로그인 200. (c) 마지막 관리자 강등·정지·삭제 → 409. 자기 자신 정지·삭제 → 409. (d) 완전 삭제: 확인 이메일이 틀리면 400. 맞으면 그 사용자의 행이 데이터 표 12개·`change_set`·`change_log`·`user_key`·`session`·`account`·`user` 모두 0. 다른 사용자의 행 수는 그대로.
- V-9 비밀번호 안전장치: (a) 외부 연결이 있는 관리자가 없을 때 비밀번호 끄기 → 409. (b) 관리자가 OIDC를 연결한 뒤 끄기 → 성공, `/sign-in/email` 403. (c) `AUTH_PASSWORD_ENABLED=true`로 재시작 → 비밀번호 로그인 200, 화면에 잠금.
- V-10 초기 관리자: (a) `ADMIN_EMAIL` 사용자가 `role = user`인 상태로 시작 → 시작 뒤 `admin`. (b) `ADMIN_OIDC_SUBJECT` = Dex 사용자 subject, 정책 `closed` → 첫 로그인으로 `admin`·`bootstrap`. (c) env를 지우고 재시작 → 여전히 `admin`.
- V-11 비밀 저장: (a) 관리자 화면으로 넣은 클라이언트 시크릿의 DB 값이 `v1.`로 시작하고 원문을 포함하지 않는다. 읽기 API는 `{ set: true }`만. (b) 외부 로그인 뒤 `account`의 세 토큰 열이 모두 `v1.`로 시작하거나 null이다. 복호화하면 제공자가 준 값과 같다(테스트에서만). (c) 이 검사 동안의 api 로그와 HTTP 응답에서 시크릿 원문과 마스터 키를 찾으면 0건.
- V-12 모바일: (a) `/sign-in/email` 응답에 `set-auth-token`. 그 토큰을 `Authorization: Bearer`로 `/api/state` → 200, 헤더 없이 → 401. (b) `ALLOT_APP_RETURN_URLS=allot://auth`에서 `#app-login?return=allot://auth` 흐름(Dex) → `allot://auth?ott=…`로 이동. 그 토큰을 verify → bearer 토큰, 두 번째 verify → 실패. (c) `return=evil://x`나 `https://evil.example` → 이동하지 않고 오류. 목록이 비어 있으면 기능이 꺼진다.
- V-13 GitHub·Google(사용자 값 필요): 사용자가 `docker/.env.dev`에 테스트 앱 값을 넣은 뒤에 한다.
  - 자동: 각 제공자의 로그인 시작이 그 제공자의 authorize 주소로 302하고, `client_id`와 `redirect_uri`가 기대와 같다.
  - 사용자가 각 제공자로 한 번 로그인한다. Google은 `http://localhost:15173`으로 연다(우려 4).
  - PM이 결과를 검사한다: `account` 행(제공자, 계정 키, 암호화된 토큰), 정책대로의 `status`. GitHub는 org 규칙 맞음·안 맞음 한 번씩.
  - 값이 없거나 사용자 로그인이 없으면 **막힘**으로 기록하고 통과로 치지 않는다.
- V-14 새 클론: 빈 DB, 데이터 파일 없이 `pnpm db:admin` exit 0 → 로그인 200 → `/api/state` 200, 기본값과 빈 목록. 관리자가 만든 새 사용자도 같은 빈 상태. 새 사용자가 설정을 처음 저장하면 행이 생긴다.
- V-15 회귀: `node tests/api/crud.mjs create` → api 재시작 → `verify` → `cleanup`, `tests/api/isolation.mjs`, `tests/api/changes.mjs` 모두 exit 0(바뀐 기대는 W-8 커밋에 이유와 함께). `pnpm e2e` 전부 통과.
- V-16 RLS 시작 검사: 새 표 `user_key`가 RLS·FORCE이고, 시작 검사 경고 0줄. `auth_provider`·`system_key`는 `user_id`가 없어 대상 밖이다.
- V-17 운영 compose와 이미지: `docker compose -f docker/compose.yaml --env-file docker/.env.example config --no-env-resolution` exit 0, 새 env가 출력에 있다. 로컬에서 빌드한 이미지를 `read_only`·`cap_drop` 그대로 테스트 DB에 붙여 시작 → `/healthz` 200, 로그인 200. 마스터 키 없이 시작 → 실패하고 이유를 출력한다.
- V-18 공개 저장소 검사: 0.1.1 V-13과 같은 방법(`banned.txt`, `grep -w -F`, diff와 커밋 메시지). 실제 제공자 도메인·계정·client id가 없어야 한다.

## 우려
1. **인증 인스턴스 다시 만들기**: Better Auth가 지원하는 API가 아니라, 인스턴스를 통째로 바꿔 끼우는 방식이다. 진행 중인 요청은 옛 인스턴스로 끝난다. 그런데 OAuth state가 DB(`verification`)에 있으므로, 로그인 도중에 설정이 바뀌면 그 로그인은 실패할 수 있다. 설정 변경이 드물어서 받아들인다. 대안은 제공자를 늘 등록해 두고 hook으로만 막는 것인데, client id·시크릿을 바꾸면 재시작해야 해서 "화면에서 설정"을 못 지킨다.
2. **`ALLOT_MASTER_KEY` 필수**: 0.1.1에서 올리는 사람은 env를 하나 더해야 시작된다. CHANGELOG와 시작 오류 문구로 알린다. 대안(외부 제공자를 켤 때만 필수)은 나중에 켤 때 키 없이 쌓인 데이터가 생길 수 있어 고르지 않았다.
3. **Dex 테스트 사용자와 group**: Dex의 정적 비밀번호 사용자에게는 group이 없다. group 규칙 검사에는 mock 커넥터(고정된 group)를 쓴다. Dex의 env 치환과 issuer 경로가 기대대로 되지 않으면 W-9에서 시작 스크립트로 설정을 만들고 history에 적는다.
4. **Google 콜백 제약**: Google은 http 리디렉션 주소로 `localhost`만 허용한다. LAN 주소(`http://<host>:15173`)로는 등록할 수 없다. V-13의 Google 확인은 그 호스트에서 `http://localhost:15173`으로 열거나 SSH 터널로 한다. 그동안 `BETTER_AUTH_URL`도 localhost로 맞춘다. 이때 api 컨테이너는 localhost의 Dex issuer에 닿지 못하므로 Dex 검사(V-5)와 같은 시간에 하지 않는다.
5. **Google ID 토큰**: 내장 Google 제공자는 code flow에서 받은 ID 토큰을 JWKS로 검증하지 않고 풀기만 한다. 토큰 엔드포인트에서 TLS로 직접 받은 토큰이라 OIDC 표준상 허용된다. 일반 OIDC는 JWKS 검증을 강제한다.
6. **관리자 동작의 기록**: 사용자 관리(만들기, 정지, 삭제)는 0.1.1의 변경 묶음(사용자 데이터 단위)에 들어가지 않는다. 0.1.2에서는 api 로그에 한 줄씩 남긴다(행위자, 대상 id, 동작; 비밀 없음). 관리자 감사 로그 화면은 범위 밖이다.
7. **`--replace-admin` 의미 변경**: 옮길 계정을 이메일로 명시하게 바꾼다. 0.1.1 V-4의 명령 형태는 더 이상 쓰지 않는다.
8. **intent 표현 정정**: intent 열린 질문 3의 "PM이 한 번 수동으로 로그인해 확인"은 사용자 계정이 있어야 가능하다. 그래서 "사용자가 로그인하고 PM이 결과를 검사"로 적었다(S-9). 이 정정은 사용자 요약에 밝힌다.

## 범위 밖
- 일반 OIDC 제공자 여러 개(0.1.2는 하나). 2단계 인증, 패스키, 메일 발송(초대·재설정).
- 관리자 감사 로그 화면, 사용자 스스로 탈퇴.
- 데이터 표·변경 기록의 컬럼 암호화, 0.1.7 전의 토큰 사용.
- 모바일 앱 자체, Expo·Capacitor 플러그인.
- Authentik·Keycloak을 띄워 하는 E2E(문서 예시만).
- `scripts/guard-env.mjs` 오탐 개선(별도 `chore:`).

검토: 계획 검토 역할(pl/plan-reviewer, pl/qa-plan-reviewer)이 위임 표에 없어 PM이 직접 검토했다. 사용자 말·intent·제품 경계에 비추어 본 결과는 우려 8과 S-9 정정 하나다.
