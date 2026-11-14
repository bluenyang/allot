---
id: "006"
slug: login-admin
version: 0.1.2
status: approved
origin: user
approvals:
  - role: user
    by: BlueNyang
    at: "2026-11-13"
    words: "승ㅇ;ㄴ"
    rev: 2750bd5
    note: "\"승인\"의 오타(두벌식에서 ㅣ 자리 옆 ;)로 읽었다."
  - role: user
    kind: permission
    by: BlueNyang
    at: "2026-11-15"
    words: "잘된다. 이제 진행하자"
    rev: 2abf3de
    note: "test(V-1~V-18) 뒤. 범위: 브랜치 푸시와 PR 생성. 머지·감사·rc·릴리스는 포함하지 않는다(머지는 따로 지시)."
  - role: user
    kind: permission
    by: BlueNyang
    at: "2026-11-15"
    words: "응 머지"
    rev: e3a3d45
    note: "범위: PR #10 머지(머지 커밋 ba7ba13). master에 직접 커밋할 수 없어 머지 뒤 감사 브랜치에서 기록한다. 감사는 flow의 필수 단계로 이어서 하고, 감사 기록의 푸시·PR은 따로 지시."
  - role: user
    kind: permission
    by: BlueNyang
    at: "2026-11-15"
    words: "푸시랑 pr하고, 머지해봐. rc.1 이전에 변경할것 있거든? 근데 새 세션에서 할거야."
    rev: ffa302c
    note: "범위: 브랜치 docs/audit-0.1.2의 푸시·PR·머지. rc.1은 포함하지 않는다(사용자가 rc.1 전에 바꿀 것이 있고, 새 세션에서 한다)."
waivers:
  - step: "spec 006 V-13 Google 실제 로그인 확인(사용자 로그인 뒤 계정 행·토큰·정책 검사)"
    words: "google은 그냥 넘겨도 될까? 귀찮아서."
    at: "2026-11-15"
    scope: once
    note: "자동 부분(authorize 주소, client_id, redirect_uri)은 실행함 — reports/0.1.2/test/V-13-google.log. GitHub는 그대로 진행."
supersedes: null
---
## 문제
사용자 말 (2026-11-11):
> OAuth는 OIDC 붙여그냥. GitHub, Dex, Authentik, logto 중 하나라고 상정해.
> OIDC 호환 + GitHub + Google 3가지하고, ON/OFF 가능하게 해버려. 시스템 내의 설정이나 env로 설정되게끔
> 비밀번호 로그인을 막지는 않는다. 다만 설정에서 끌 수는 있음
> 지인 정도임. 아직까지는. 어차피 오픈소스로 풀거라, 필요하면 알아서 올려서 쓰겠지
> (multi-user) admin이 계정 생성, admin이면 관리자 메뉴, env로 초기 관리자 email/id 또는 OIDC 계정 식별자, 사용자는 유지하고.
> OIDC 회원은 계정 추가 없이 승인 또는 group 등으로 바로 사용
> 휴대폰은 … 아예 앱으로 만들어버리게.
> (로드맵 확정) 흠... 일단 알겠어. 그렇게 가자

지금 Allot의 로그인은 이메일·비밀번호 하나이고, 가입은 막혀 있으며, 계정은 시드 스크립트(`pnpm db:seed`)가 만드는 하나뿐이다. 0.1.1에서 데이터가 사용자별로 나뉘었지만(`user_id`, RLS) 두 번째 사용자를 만들 길이 없다. 인터넷에 노출해서 쓸 예정이라(MCP, 휴대폰) 외부 로그인과 계정 관리가 MCP보다 먼저 있어야 한다. 또 새로 클론한 사람은 비공개 데이터 파일이 없어 계정을 만들 수 없다(0.1.1 리뷰 4).

## 바라는 결과
- 로그인 방식 네 가지: **일반 OIDC**(Dex·Authentik·logto 등 discovery URL로), **GitHub**, **Google**, **비밀번호**. 각각 켜고 끌 수 있다 — env로, 또는 관리자 화면의 설정으로.
- 제공자마다 **가입 정책**을 고른다: 관리자가 만든 계정만 / 첫 로그인은 승인 대기 → 관리자가 승인 / 규칙에 맞으면 바로 사용(OIDC group, GitHub organization, Google 도메인이나 이메일 목록).
- **관리자 메뉴**: 사용자 목록, 계정 만들기, 승인 대기 처리, 정지·해제, 역할(관리자·사용자), 로그인 방식 설정. 관리자도 다른 사용자의 금융 데이터는 보지 못한다(PM 해석, 아래 "에이전트가 정한 것").
- **초기 관리자를 env로**: 이메일(`ADMIN_EMAIL`, 지금도 있음) 또는 OIDC 계정 식별자(issuer + subject). 지금 계정과 데이터는 그대로이고, 그 계정이 관리자가 된다.
- **암호화 모듈**: AES-256-GCM 봉투 암호화(사용자별 데이터 키를 마스터 키로 포장). 0.1.2에서는 외부 로그인 토큰부터 암호화한다.
- **모바일 앱이 쓸 수 있는 인증**: 쿠키 대신 bearer 토큰으로도 API를 부를 수 있고, 외부 로그인 뒤 앱 주소(deep link)로 돌아올 수 있다. 앱 자체는 0.1.9.
- 새 클론에서 데이터 파일 없이 관리자 계정만 만들 수 있다. 새 사용자는 빈 데이터로 시작한다.

## 계획
1. 설정 모델: 로그인 방식과 가입 정책을 env와 DB 설정으로 읽는 한 곳(`server/auth-config.ts` 가칭). env로 정한 값은 화면에서 바꿀 수 없게 잠긴다.
2. 암호화 모듈(`server/crypto/` 가칭): 마스터 키 env, 사용자별 데이터 키, 포맷 버전과 키 식별자, 키 교체 경로. 단위 테스트.
3. 로그인 제공자: Better Auth `genericOAuth`(discovery, PKCE), GitHub·Google 소셜 로그인, 비밀번호 켜기·끄기. 외부 계정 토큰은 암호화해 저장.
4. 가입 정책과 승인: 새 외부 로그인 사용자를 정책에 따라 막기·승인 대기·바로 사용. 승인 대기 사용자는 데이터 API를 쓸 수 없다.
5. 관리자: Better Auth `admin` 플러그인(역할, 정지), env 초기 관리자 부여, 관리자 API(zod 검증)와 화면. 사용자 대신 로그인하기(impersonation)는 끈다.
6. 내 계정 화면: 연결된 로그인 방식 보기·연결·해제, 비밀번호 바꾸기.
7. 모바일 대비: `bearer` 플러그인, 허용한 앱 주소로만 돌아가는 콜백.
8. 시드: 데이터 파일 없이 계정만 만드는 경로, 공개용 예시 데이터는 넣지 않거나 가짜 값만(spec에서 정함). 새 사용자 기본 `settings`·`living` 행.
9. 개발 compose에 테스트용 Dex 추가(운영과 같은 제공자) — 로그인·가입 정책·group 규칙을 E2E로 확인. GitHub·Google은 사용자가 넣은 테스트 앱으로 수동 확인 한 번.
10. 리뷰 → 테스트 → PR → 머지 → 감사 → rc.

## 영향 범위
`server/auth.ts`, `server/db/auth-schema.ts`·`schema.ts`, `drizzle/`(새 마이그레이션), `server/routes.ts`·`app.ts`·`app-env.ts`, `server/validation.ts`, `server/db/seed.ts`, 새 `server/crypto/`, `src/pages/`(로그인, 관리자, 내 계정), `src/lib/store.ts`, `src/router` 또는 해당 파일, `docker/compose.dev.yaml`(테스트 OIDC), `docker/compose.yaml`·`docker/.env.example`, `tests/`(API·E2E), README·CHANGELOG.

## 제약
- 로그인·접근 기능은 `server/auth.ts`의 Better Auth 플러그인으로(AGENTS.md). 직접 OAuth 흐름을 짜지 않는다.
- 0.1.1의 격리(앱 조건 + RLS)를 약하게 하지 않는다. 관리자 API도 다른 사용자의 데이터 테이블을 읽지 않는다.
- 지금 계정·데이터·계산 결과는 그대로(업그레이드 전후 동등성).
- 비밀(클라이언트 시크릿, 마스터 키)은 저장소와 로그에 남지 않는다. `.env.example`에는 자리표시자만.
- 공개 저장소: 실제 제공자 이름·도메인·계정을 코드·문서·테스트에 넣지 않는다.
- 스키마 변경은 `pnpm db:generate`, 데이터 이동은 `--custom`.
- 일반 OIDC는 표준만 쓴다(discovery, authorization code + PKCE, ID 토큰 검증). Dex·Authentik·Keycloak 어느 것에도 제공자 전용 분기를 두지 않는다. group·subject 클레임 이름은 설정값.

## 열린 질문
없음. 2026-11-12 사용자 답: "1. b, 2. b, 3. 1. / 3 번은 테스트 하기 전에 직접 넣어주는 거로. 운영에서는 Dex 쓸건데, 말했다시피, Authentik이든 KeyCloak이든 호환은 다 되어야 한다고."
1. 클라이언트 시크릿: **env 또는 관리자 화면**. 화면에 넣은 시크릿은 암호화 모듈로 암호화해 DB에 저장하고, 화면에는 다시 보여주지 않는다(PM 해석: 바꾸기·지우기만).
2. 사용자 삭제: **정지 + 완전 삭제**(데이터까지, 확인 한 번 더). 관리자 자신과 마지막 관리자는 지울 수 없다(PM 추천, 답 b에 포함).
3. 실제 제공자 확인: **사용자가 테스트 전에 테스트용 GitHub·Google OAuth 앱 값을 `docker/.env.dev`에 직접 넣는다.** 그 뒤 PM이 한 번 수동으로 로그인해 확인한다. 값이 없으면 그 검사는 막힌 것으로 보고하고 넘기지 않는다.
   운영 OIDC는 **Dex**. 그러나 **Authentik·Keycloak 등 표준 OIDC 제공자와 모두 호환**되어야 한다(PM 해석: 제공자 전용 코드 없이 discovery URL·client id·시크릿·scope만으로 붙고, group 클레임 이름과 subject로 쓸 클레임을 설정으로 바꿀 수 있다).

## 질의서 기록
—
### 에이전트가 정한 것
- **기본값은 가장 닫힌 쪽**: env와 설정이 없으면 비밀번호만 켜지고, 외부 제공자는 꺼져 있으며, 가입 정책은 "관리자가 만든 계정만". 대안(기본 승인 대기)은 켜자마자 모르는 사람이 대기열을 채울 수 있다.
- **env가 이긴다**: 같은 항목을 env와 화면이 둘 다 정하면 env 값이 쓰이고 화면에는 잠금으로 보인다. 대안(DB가 이김)은 env를 바꿔도 반영되지 않아 복구가 어렵다.
- **비밀번호 끄기 안전장치**: 관리자가 쓸 수 있는 다른 로그인 방식이 없으면 비밀번호를 끌 수 없다. env(`AUTH_PASSWORD=on` 가칭)로는 언제든 다시 켤 수 있다(위원회의 "관리자 비상구").
- **관리자는 금융 데이터를 보지 않는다**: 관리자 화면은 계정 정보(이메일, 이름, 로그인 방식, 상태, 만든 날)만 다룬다. impersonation도 끈다. 대안(관리자 전체 열람)은 "개인 정보가 많다"는 전제와 RLS 설계에 어긋난다.
- **외부 계정 연결 기준은 issuer + subject**(이메일 아님). 이메일만 같은 다른 제공자 계정이 기존 계정에 자동으로 붙지 않는다. 연결은 로그인한 사용자가 내 계정 화면에서, 또는 관리자가 만든 계정에 처음 로그인할 때 이메일 확인이 된 제공자에 한해서.
- **암호화 범위**: 0.1.2는 외부 로그인 토큰(+ 질문 1이 (b)면 클라이언트 시크릿). 메모·이름·변경 기록은 다음 단계(위원회 2단계), 금액·날짜는 보류. 마스터 키를 잃으면 암호화된 토큰만 못 쓰고 다시 로그인하면 된다 — 문서에 적는다.
- **모바일 대비는 서버 쪽만**: bearer 토큰과 허용된 앱 주소 콜백. 앱 빌드·스토어는 0.1.9.
- 관리자 메뉴의 화면 구성과 API 모양은 spec에서 정한다.
- 호환 확인은 Dex로 E2E, Authentik·Keycloak은 설정 예시를 문서에 적되 "검사함"이라고 쓰지 않는다. 대안(개발 compose에 Keycloak까지 띄워 E2E)은 무겁고, 표준만 쓰면 차이는 클레임 이름 정도라 설정으로 덮는다.

## 하지 않을 것
- MCP·API 키(0.1.3~).
- 패스키(0.1.6 이후, 사용자 결정).
- 2단계 인증, 이메일 발송(초대 메일·비밀번호 재설정 메일) — 메일 서버가 없다. 비밀번호 재설정은 관리자가 한다.
- 모바일 앱 자체(0.1.9).
- 메모·이름·변경 기록의 컬럼 암호화.
- `scripts/guard-env.mjs`의 오탐 개선 — 제품 범위 밖이라 따로 `chore:`로 다룬다.
