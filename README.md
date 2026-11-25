# Allot (0.1.8)

> Self-hosted personal money management: split your monthly salary across accounts, track subscriptions, one-off and installment payments, and see what is left each month. The documentation below is in Korean.

통장 잔액을 맞춰 보는 앱이 아니라, 매달 들어올 돈과 나갈 돈(생활·구독·저축·투자·지출)을 정하고 남는 돈(여유)을 어디에 둘지 보는 앱이다. 잔액 기록과 예상도 있지만 그 계획을 돕는 용도다. 월급 분배·구독·일회성 지출·플랜 전환 일정을 관리한다. 직접 띄워 쓰는 웹앱으로, 지인 몇 명이 계정을 나눠 쓸 수 있다(데이터는 사용자마다 따로). AI 클라이언트는 MCP로 데이터를 읽고 변경을 제안할 수 있다.
Vue 3.5 + Vite 8 + TypeScript 6 / Hono API / PostgreSQL 16 (Drizzle ORM) / Better Auth 로그인(비밀번호·OIDC·GitHub·Google).

계획은 [`docs/ROADMAP.md`](docs/ROADMAP.md), 버전별 변경은 [`CHANGELOG.md`](CHANGELOG.md)에 있다.

## 개발 서버 (Docker, 기본)

모든 버전은 Docker로 개발 서버를 띄운다. 브라우저에서 `http://<이 컴퓨터 IP>:15173`으로 연다(같은 네트워크의 폰에서도 열린다).

```bash
cp docker/.env.example docker/.env.dev  # 테스트 값 채우기 (비밀번호·BETTER_AUTH_SECRET·ALLOT_MASTER_KEY 등)
docker compose -f docker/compose.dev.yaml build          # 이미지는 node·pnpm만 준다 (처음 한 번, Dockerfile이 바뀔 때)
bash scripts/test-server/stage.sh [<커밋>]               # 그 커밋을 빌드해 올린다 (기본 origin/master)
docker compose -f docker/compose.dev.yaml exec api pnpm db:admin  # 관리자 계정만 (데이터 없이)
# 또는: … exec api pnpm db:seed [데이터 파일]                     # 관리자 계정 + 처음 데이터
```

- 서비스: `web`(빌드한 화면을 `vite preview`로, 15173 공개), `api`(빌드한 서버를 `node`로, 내부 3000), `db`(PostgreSQL 16, 내부), `dex`(테스트용 OIDC 제공자, 내부). 외부에 열리는 포트는 15173 하나다.
- 작업 트리를 띄우지 않는다: `stage.sh`가 커밋 하나를 꺼내(`git archive`) `~/.local/share/allot/staging/<sha>/`에서 dev 이미지로 빌드하고, DB를 `.loctx/backup/`에 백업한 뒤 `.loctx/staging/current`를 그 스냅숏으로 돌리고 api·web을 다시 띄운다. 지금 것보다 앞이 아닌 커밋은 `STAGE_BACK=1` 없이 거부한다. 메인 체크아웃을 고쳐도 15173은 그대로다.
- `/api`는 Vite가 api 컨테이너로, `/dex`는 dex 컨테이너로 넘긴다(같은 출처라 쿠키·CORS 설정이 필요 없다).
- `BETTER_AUTH_URL`은 이 컴퓨터의 LAN 주소로 둔다(`http://<IP>:15173`). Dex의 issuer가 이 주소 + `/dex`이고, api 컨테이너도 그 주소로 Dex에 닿기 때문이다(`localhost`면 api가 닿지 못한다).
- Dex 테스트 사용자는 `docker/dex/config.yaml`에 있다(가짜 값, 비밀번호 `dex-password`). group 규칙 확인용으로 mock 커넥터(고정 group `authors`)도 있다. api의 OIDC 설정은 관리 화면(또는 테스트)에서 넣고, client 값은 `.env.dev`의 `DEX_CLIENT_ID`·`DEX_CLIENT_SECRET`과 맞춘다.
- 의존성은 스냅숏마다 그 커밋의 lockfile로 새로 깐다(pnpm 저장소는 볼륨 `allot-stage-pnpm-store`에 남는다).
- 마이그레이션은 api가 시작할 때 자동으로 적용된다.
- `pnpm db:seed [파일]`은 데이터 파일(기본 `.loctx/scripts/seed-data.ts`, 로컬 전용)을 id 기준으로 upsert하고, `ADMIN_EMAIL`/`ADMIN_PASSWORD`로 로그인 계정을 만든다(이미 있으면 비밀번호를 바꾸고 기존 세션을 끊는다). 회원가입은 막혀 있다.
- `pnpm db:admin`은 데이터 파일 없이 관리자 계정만 만든다(새로 클론했을 때). 새 계정은 기본 설정과 빈 목록으로 시작한다.
- 관리자 이메일을 바꾸려면 `pnpm db:seed --replace-admin <예전 이메일>`(또는 `db:admin`) — 그 계정의 데이터와 변경 내역을 새 계정으로 옮긴 뒤 예전 계정과 그 세션을 지운다. 다른 계정은 건드리지 않는다.
- web 컨테이너에는 프론트 파일(`index.html`, `vite.config.ts`, `tsconfig.json`, `src/`)만 마운트한다. Vite는 LAN의 누구에게나 root 아래 파일을 보여 주기 때문이다.
- 개발은 이 스택으로 한다. E2E·API 검사는 데이터를 만들고 지우므로, 실제로 쓰는 데이터가 든 스택이 아니라 버려도 되는 스택(새 DB)에서 돌린다. `docker/compose.yaml`은 운영 예시다(아래).

## 운영 배포 (이미지)

릴리스 이미지는 `ghcr.io/bluenyang/allot:<버전>`(정식 버전은 `latest`도)이고, linux/amd64용이다. Node 프로세스 하나가 화면과 API를 함께 서빙하며 포트는 3000이다. 시작할 때 마이그레이션을 적용한다. DB(PostgreSQL 16)는 따로 둔다.

```bash
cp docker/.env.example docker/.env   # DATABASE_URL, BETTER_AUTH_SECRET/URL, ALLOT_MASTER_KEY, TRUSTED_ORIGINS, 운영 항목
docker compose -f docker/compose.yaml up -d
```

- **`ALLOT_MASTER_KEY`는 필수다**(0.1.2부터). 없거나 32바이트 base64가 아니면 앱이 이유를 출력하고 시작하지 않는다. `openssl rand -base64 32`로 만들고, DB 백업과 다른 곳에 보관한다(아래 "암호화 키").
- `BETTER_AUTH_URL`은 브라우저로 여는 실제 주소다(예: `https://allot.example.com`).
- `TRUSTED_ORIGINS`에 같은 주소를 적는다(쉼표로 여러 개). 운영에서는 반드시 설정한다. 비워 두면 요청이 온 주소를 믿는 개발용 동작이다.
- **HTTPS(Traefik):** 예시 compose는 이미 떠 있는 Traefik(docker provider) 뒤에 앱을 둔다. 앱은 포트를 열지 않고 Traefik 네트워크(`TRAEFIK_NETWORK`)에 붙고, `ALLOT_HOST`·`TRAEFIK_ENTRYPOINT`·`TRAEFIK_CERTRESOLVER`를 그 Traefik의 이름에 맞춘다. 컨테이너는 읽기 전용, Linux capability 없이 돈다. Traefik을 쓰지 않으면 compose 파일의 주석대로 포트를 연다.
- 변경 내역은 기본으로 계속 쌓인다. `CHANGE_LOG_RETENTION_DAYS`(일)를 정하면 그보다 오래된 변경 묶음을 시작할 때와 하루 한 번 지운다.
- 환율 자동 갱신(0.1.7): 설정 > 통화에서 '자동'을 켠 통화만, 시작하고 1분 뒤와 그 뒤 하루 한 번 공개 환율(ECB 기준, Frankfurter)을 받아 바꾼다. 아무도 켜지 않았으면 밖으로 요청하지 않는다. 바뀐 환율은 변경 내역에 '자동 갱신'으로 남고 되돌릴 수 있다. 받지 못하면 환율은 그대로 두고 화면에 마지막 실패를 보인다.
  - `ALLOT_FX_URL`: 환율 서비스 주소(기본 `https://api.frankfurter.app`). 같은 API(`/latest?from=<코드>&to=KRW`)를 내는 다른 주소(예: 직접 띄운 Frankfurter)를 쓸 때.
  - `ALLOT_FX_REFRESH=off`: 서버 전체에서 자동 갱신을 끈다(밖으로 나가는 요청이 없다). 화면의 '지금 갱신'도 받지 않는다.
- 로그인 시도 제한은 클라이언트 IP로 센다.
  - **Traefik 뒤:** `TRUSTED_PROXY_IP_HEADER=X-Real-IP`. Traefik이 클라이언트 주소로 이 헤더를 채운다. 앱 포트를 열지 않아 Traefik만 앱에 닿을 때만 안전하다.
  - **다른 리버스 프록시 뒤:** `APP_BIND=127.0.0.1`(기본값)로 두어 프록시만 앱에 닿게 하고, `TRUSTED_PROXY_IP_HEADER`에 그 프록시가 덮어쓰는 헤더(예: `X-Real-IP`)를 적는다. 프록시가 컨테이너라면 앱 포트를 공개하지 말고 같은 내부 네트워크로 연결한다.
  - **직접 접속:** `APP_BIND=0.0.0.0`으로 열고 `TRUSTED_PROXY_IP_HEADER`는 **비워 둔다**. 소켓 주소를 쓰고, 클라이언트가 보낸 헤더는 무시한다. 헤더를 믿도록 설정한 채 포트를 열면 누구나 헤더를 바꿔 제한을 피할 수 있다.
  - 프록시 뒤인데 헤더를 비워 두면 모든 접속이 프록시 IP 하나로 묶여 제한이 함께 걸린다(안전한 쪽).
- 첫 데이터: 스키마는 앱이 시작할 때 만들어진다. 그다음 시드 SQL(`targets`, `phases`, 계정 등)을 `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <파일>`로 넣는다. 또는 개발 환경에서 `DATABASE_URL`을 운영 DB로 두고 `pnpm db:seed <데이터 파일>`을 실행한다.
- 패키지가 비공개로 만들어졌다면, 서버에서 `docker login ghcr.io`를 하거나 GitHub 패키지 설정에서 공개로 바꾼다.

### 로그인 방식

비밀번호, 일반 OIDC(하나), GitHub, Google. 각각 관리 화면(관리 → 로그인 방식)이나 env(`AUTH_<P>_*`, `docker/.env.example` 참고)로 켜고 끈다. 같은 항목을 둘 다 정하면 env가 이기고 화면에서는 잠긴다. 화면에서 저장하면 재시작 없이 적용된다. 아무것도 정하지 않으면 비밀번호만 켜지고 가입은 닫혀 있다.

- **가입 정책**(제공자마다): `closed` 관리자가 만든 계정만 / `approval` 처음 로그인하면 승인 대기, 관리자가 승인 / `rules` 규칙에 맞으면 바로 사용(이메일 목록, OIDC group, GitHub organization, Google 도메인 중 하나라도 맞으면). 규칙으로 들어온 계정은 로그인할 때마다 규칙을 다시 확인한다.
- **연결**: 외부 계정은 이메일이 아니라 제공자의 계정 식별자(OIDC는 issuer + subject)로 연결된다. 이메일만 같은 다른 계정에 자동으로 붙지 않는다. 예외는 관리자가 비밀번호 없이 만든 계정 — 그 이메일(확인된 이메일)로 처음 외부 로그인하면 연결된다. 그 밖의 연결은 사용자가 계정 화면에서 한다.
- **비밀번호 끄기**: 활성 관리자 중 누군가에게 다른 로그인 방식이 연결되어 있어야 끌 수 있다. `AUTH_PASSWORD_ENABLED=true`는 언제든 다시 켠다.
- **콜백 주소**(제공자에 등록): `<BETTER_AUTH_URL>/api/auth/callback/oidc`, `…/github`, `…/google`.
- **일반 OIDC**는 표준만 쓴다(discovery, authorization code + PKCE, JWKS로 ID 토큰 검증). 제공자별 코드는 없다. 예시(검사는 Dex로만 했다):
  - Dex: discovery `https://<dex>/.well-known/openid-configuration`, scope `openid email profile groups`, group 클레임 `groups`.
  - Authentik: discovery `https://<authentik>/application/o/<slug>/.well-known/openid-configuration`, group 클레임 `groups`(기본 `profile` scope에 들어 있다).
  - Keycloak: discovery `https://<keycloak>/realms/<realm>/.well-known/openid-configuration`, client에 "Group Membership" 매퍼(클레임 이름 `groups`, full path 끔)를 더한다.
- **초기 관리자**: `ADMIN_EMAIL`의 계정, 또는 `ADMIN_OIDC_SUBJECT`(지금 OIDC issuer에서의 subject)로 처음 로그인한 계정. env를 지워도 관리자에서 내려가지 않는다. 기존 0.1.1 계정은 업그레이드 때 관리자가 된다.
- **관리자**는 계정 정보(이메일·이름·역할·상태)만 다룬다. 다른 사용자의 금융 데이터는 보지 못하고, 다른 사용자로 로그인하기(impersonation)도 없다. 마지막 관리자와 자기 자신은 정지·삭제할 수 없다. 완전 삭제는 그 사용자의 데이터·변경 내역·로그인을 모두 지운다. 메일 발송은 없어서 비밀번호 재설정은 관리자가 한다. 관리자 동작은 api 로그에 한 줄씩 남는다.

### 암호화 키

외부 로그인 토큰과 관리 화면에서 넣은 client secret은 AES-256-GCM으로 암호화해 저장한다. 사용자마다 데이터 키가 있고, 데이터 키는 `ALLOT_MASTER_KEY`로 포장된다.

- **교체**: 예전 키를 `ALLOT_MASTER_KEY_PREVIOUS`에, 새 키를 `ALLOT_MASTER_KEY`에 두고 `pnpm keys:rotate`(이미지에서는 `node dist-server/index.mjs keys:rotate`)를 실행한 뒤 예전 키를 지운다. 데이터 키만 다시 포장하고 데이터는 다시 암호화하지 않는다.
- **분실**: 암호화된 것(외부 로그인 토큰, 화면에서 넣은 client secret)만 못 쓴다. 금액·이름 같은 데이터는 암호화 대상이 아니라 영향이 없다. 새 키로 바꾸면 앱은 그대로 뜨고, 저장된 secret을 풀 수 없는 제공자만 "쓸 수 없음"으로 보인다(비밀번호 로그인과 관리 화면은 그대로).
  1. 예전 키를 찾을 수 있으면 `ALLOT_MASTER_KEY_PREVIOUS`에 넣고 위의 교체 순서를 따른다.
  2. 영영 잃었으면 `pnpm keys:forget-lost`(이미지: `node dist-server/index.mjs keys:forget-lost`)로 지금 키로 열 수 없는 데이터 키를 버린다. 그 키로 암호화된 로그인 토큰과 저장된 client secret이 비워진다. 그다음 관리 화면에서 secret을 다시 넣고, 사용자는 외부 로그인을 한 번 다시 하면 된다. env로 준 secret은 저장된 것보다 우선하므로 env로 다시 넣어도 된다.

### 모바일 앱

앞으로 만들 앱을 위한 서버 쪽 준비다. API는 쿠키 대신 `Authorization: Bearer <토큰>`으로도 부를 수 있다(로그인 응답의 `set-auth-token` 헤더). 외부 로그인 뒤 앱으로 돌아오려면 `ALLOT_APP_RETURN_URLS`에 앱 주소(예: `allot://auth`)를 정확히 적는다. 앱은 `<앱 서버>/#app-login?return=allot://auth`를 시스템 브라우저로 열고, 로그인이 끝나면 `allot://auth?ott=…`로 돌아온 일회용 토큰(3분, 한 번)을 `POST /api/auth/one-time-token/verify`로 bearer 세션과 바꾼다. 목록에 없는 주소로는 돌아가지 않는다. 비워 두면 이 경로는 꺼져 있다.

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

## AI 연결

Allot은 MCP 서버(Streamable HTTP)다. AI 앱이 내 월급 분배·수입·예산·통장·구독·일정·변경 내역을 읽고, 쓰기 권한이 있으면 변경을 "제안"한다(아래). 제안은 내가 확인하기 전에는 아무것도 바꾸지 않는다. 도구는 연결한 사람의 권한으로만 돈다(다른 사용자의 데이터는 보이지 않는다).

- **MCP 주소**: `https://<your-host>/mcp`(0.1.9). API 키와 OAuth 둘 다 받는다. 예전 주소 `https://<your-host>/api/mcp`는 API 키만 받고 그대로 된다.
- **두 가지 연결 방법**
  - **OAuth(외부 앱 연결)**: 앱에 주소만 넣으면 Allot 로그인 화면과 동의 화면이 열린다. 동의 화면에서 권한 셋 중 하나를 고른다: 읽기 / 쓰기 제안·화면에서 확인 / 쓰기 제안·대화에서 확인(키를 만들 때의 세 경우와 같다). 키가 필요 없다.
  - **API 키**: **설정 › AI·연동**(Settings › AI & integrations)에서 키를 만든다. 이름·만료일(1~365일)·권한을 정하면 키가 한 번만 보인다.
- **OAuth를 쓰려면** 관리자가 **관리 › 로그인 방식**의 "외부 앱이 OAuth로 연결하게 허용"을 켠다(기본은 꺼짐, 또는 `ALLOT_OAUTH_ENABLED=true`; env 값이 있으면 화면에서는 잠긴다). 서버 주소(`BETTER_AUTH_URL`)가 https여야 한다(localhost의 http는 시험용으로만 된다). 끄면 이미 연결된 앱도 그 순간부터 거절된다.
- **연결된 앱**: 설정 › AI·연동 › 연결된 앱에서 앱마다 권한·연결한 날·마지막 사용을 보고 "끊기"로 끊는다. 끊으면 그 앱의 토큰은 바로 401이고, 다시 쓰려면 앱에서 다시 연결해 동의해야 한다.
- **공개 주소 요건**: claude.ai·휴대폰 앱·ChatGPT는 각 회사의 서버가 내 서버에 접속한다. 인터넷에서 열리는 https 주소(443)가 있어야 하고, 방화벽을 둔다면 Anthropic(`160.79.104.0/21`, `153.61.208.0/20`, https://platform.claude.com/docs/en/api/ip-addresses)과 OpenAI(https://developers.openai.com/api/docs/guides/ip-addresses)의 주소를 연다. LAN에만 있는 서버는 Claude Code·Codex·Gemini CLI에서 API 키로만 쓸 수 있다.

### 앱별 방법 (2026-11 기준, 각 회사의 요금제·화면은 바뀔 수 있다)

- **claude.ai·Claude 데스크톱·휴대폰 앱**: Customize › Connectors › Add custom connector에 `https://<your-host>/mcp`를 넣는다(Team·Enterprise는 조직 소유자가 더한다). 휴대폰 앱은 웹에서 더한 커넥터를 쓴다. 스킬은 아래 "스킬"의 ZIP을 Customize › Skills에 올린다.
- **Claude Code**: 이 저장소가 플러그인 마켓플레이스다.
  - OAuth: `/plugin marketplace add bluenyang/allot` → `/plugin install allot@allot` → MCP 주소를 넣으면 처음 쓸 때 브라우저에서 로그인·동의.
  - API 키: `/plugin install allot-key@allot` → 주소와 키를 넣는다(키는 비밀값으로 저장). 또는 플러그인 없이 `claude mcp add --transport http allot https://<your-host>/mcp --header "Authorization: Bearer <key>"`.
  - 두 플러그인 모두 스킬 7개가 들어 있다. **둘 중 하나만 설치한다**: 같은 주소의 MCP 서버가 둘이면 Claude Code는 하나만 남긴다(2.1.327에서 확인).
- **ChatGPT(웹)**: chatgpt.com의 Plugins › + › Add custom MCP server에 `https://<your-host>/mcp`를 넣고 OAuth로 연결한다. OpenAI 안내로는 쓰기(제안)까지는 Business·Enterprise/Edu, Pro는 읽기만 되고, 만들기는 웹에서만 된다. ChatGPT는 API 키를 받지 않는다.
- **Codex**: `codex plugin marketplace add bluenyang/allot` → `codex plugin add allot@allot`(스킬) → `codex mcp add allot --url https://<your-host>/mcp` → `codex mcp login allot`(브라우저에서 로그인·동의). 키를 쓰려면 `codex mcp add allot --url https://<your-host>/mcp --bearer-token-env-var ALLOT_API_KEY`처럼 키를 담은 환경변수를 지정한다.
- **Gemini CLI**: `gemini extensions install https://github.com/bluenyang/allot`(스킬과 안내) → `gemini mcp add --transport http allot https://<your-host>/mcp`. Gemini CLI는 이제 유료 키나 Code Assist가 있어야 한다. Gemini 앱(웹)의 MCP 연결은 미국·영어에서만 열려 있어 확인하지 않았다.
- **Antigravity CLI(agy)**: `agy plugin install <이 저장소의 plugins/allot 폴더>`로 스킬을 넣고, `agy mcp add allot https://<your-host>/mcp`로 서버를 더한다.

### 스킬

`skills/`의 스킬 7개는 어느 앱에서나 같은 `SKILL.md`다: 월초 점검(`allot-month-start`), 급여 정산(`allot-payday`), 월말 정산(`allot-month-end`), 구독 최적화 제안(`allot-subscriptions`), 영수증 분석(`allot-receipt`), 소비·지출 계획(`allot-spending-plan`), 자산관리(`allot-assets`). 지금 MCP 도구만 쓰고, 바꾸는 것은 모두 제안으로 한다. claude.ai에 올릴 ZIP은 `node scripts/skills-zip.mjs`가 `dist-skills/`에 만든다. 스킬을 고친 뒤에는 `node scripts/plugins-sync.mjs`로 두 플러그인에 복사한다(단위 시험이 다르면 실패한다).

읽기 도구(12개):
- `get_overview`: 한 달 요약. 날짜, 구독 이체 계산, 분배, 나머지 분배, 그달의 결제·일회성 지출 회차와 플랜 전환, 수입(`income`)과 여유(`leftOverKrw`, 0.1.8).
- `get_income`: 그달 수입 줄, 받은 금액, 기타 수입, 합계와 여유(0.1.8).
- `get_budget`: 생활·저축·투자 메뉴의 그달 금액. 화면과 같은 계산이다.
- `list_subscriptions`: 구독과 이번 달 적용 플랜, 월 비용, 다음 결제일.
- `list_spendings`: 일회성 지출과 그 회차, 상태, 진행. `status`·`month`로 거른다.
- `list_plan_changes`: 예정된 플랜 전환.
- `get_allocation`: 분배 대상·구간·나머지 분배·계좌·부채.
- `list_accounts`: 통장과 그 필드, 잔액 기록, 앞으로의 예상.
- `get_schedule`: 여러 달의 일정, 일회성 지출 회차, 점검 항목, 공휴일.
- `list_changes`: 변경 내역, 페이지 단위.
- `search`: 이름·메모로 찾기.
- `list_notifications`: 앱의 종 알림과 같은 목록.

### 쓰기: 제안과 확인 (0.1.4)

키를 만들 때 "쓰기 허용"을 고르면 그 키로 변경을 제안할 수 있다. 확인 방식은 둘이다. OAuth로 연결한 앱은 동의 화면에서 고른 권한이 같은 뜻이다(다시 연결해 바꾸면 전에 받은 토큰도 그 순간 좁아진다).

- **화면에서 확인**(기본): 제안이 **대기 중인 변경** 화면(사이드바에 대기 개수 배지)에 쌓이고, 내가 미리보기를 보고 확인하거나 거절한다. AI는 이 제안을 적용할 수 없다. 24시간 안에 확인하지 않으면 만료된다.
- **대화에서 확인**: 대화에서 내가 동의하면 AI가 `apply_proposal`로 적용한다. 15분 안에 적용하지 않으면 만료된다.

쓰기 도구: `propose_changes`(변경 1~20개를 한꺼번에 제안, 전부 적용되거나 전부 안 된다), `propose_revert`(변경 내역의 한 묶음을 되돌리는 제안), `get_proposal`(제안 상태), `apply_proposal`(대화에서 확인하는 키·연결 전용).

- 제안만으로는 아무것도 바뀌지 않는다. 미리보기는 적용해 본 뒤 되돌려서 만들고, 바뀌는 행의 전후와 이번 달·다음 달의 구독 이체액·월급 분배 전후를 보여 준다.
- AI가 바꿀 수 있는 것: 구독, 일회성 지출(회차를 함께 보냄), 플랜 전환, 단계(고정 금액 포함), 분배 대상, 나머지 분배, 일정 이벤트, 점검 항목, 설정(실수령·급여일·환율), 생활비. 삭제도 된다. 계좌·부채·공휴일 세트·표시 설정, 키·로그인·관리자 기능은 바꿀 수 없다.
- 적용할 때 모든 것을 다시 검사한다. 제안한 뒤 데이터가 바뀌었거나, 만료됐거나, 키가 폐기·만료되었거나 쓰기 범위를 잃었으면(앱은 연결이 끊겼거나 외부 앱 연결이 꺼졌으면) 적용되지 않는다. 대기 중인 제안은 20개까지다.
- 적용된 제안은 변경 내역에 "AI · 키 이름"(OAuth 앱은 "AI · 앱 이름")인 변경 묶음 하나로 남고, 다른 변경처럼 되돌릴 수 있다. AI의 `propose_revert`도 AI가 바꿀 수 있는 자원의 묶음만 되돌린다.
- 한계: 새 분배 대상과 그 대상을 쓰는 단계 금액은 한 제안에 담을 수 없다(서버가 새 대상의 id를 정한다). 제안을 두 번 해야 하고, 도구 설명이 AI에게 그렇게 알려 준다.

- 키는 계정당 10개까지이고, 해시로만 저장한다. 인증에 실패하면 이유와 상관없이 같은 401이다. 같은 주소에서 10분에 20번 실패하면 잠시 막히고(429), 키 하나(OAuth는 사용자와 앱 하나)는 분당 120번까지 쓸 수 있다.
- OAuth의 제한(0.1.9): 돌아갈 주소는 등록한 것과 정확히 같아야 한다(localhost·127.0.0.1·[::1]의 포트만 예외). PKCE는 S256만. 액세스 토큰 1시간, 갱신 토큰 30일(쓸 때마다 새로 주고 예전 것은 다시 못 쓴다), 인가 코드 10분. 클라이언트 등록은 1분에 5번, 토큰 1분에 20번, 인가 1분에 30번. CIMD 메타데이터는 공개 https 주소에서만 가져온다.
- 만료 없는 키는 기본으로 막혀 있다(키 수명 최대 365일). 관리 화면의 "API 키" 탭에서, 또는 `ALLOT_API_KEY_NO_EXPIRY=true`로 허용한다. env 값이 있으면 화면에서는 잠긴다. 끄면 만료 없는 키는 그 시점부터 1년 뒤에 만료된다.
- 인터넷에 열어 둘 때는 `TRUSTED_ORIGINS`를 꼭 설정한다. 이 엔드포인트는 그 호스트(와 `BETTER_AUTH_URL`)가 아닌 요청을 거절한다. 리버스 프록시를 경로로 나눠 두었다면 `/api` 말고도 `/mcp`와 `/.well-known/`을 Allot으로 보내야 한다(예시 `docker/compose.yaml`의 Traefik은 호스트 전체를 보내므로 그대로 된다).

## 화면 언어

설정 › 일반에서 한국어, English, 또는 브라우저 따라가기를 고른다. 메뉴·화면·서버가 돌려주는 오류 문구가 따라 바뀌고, 로그인 화면은 이 브라우저에서 마지막으로 고른 언어를 쓴다.

## 화면 구성

- 사이드바는 묶음으로 나뉜다: 현황 / 예산(수입, 월급 분배, 생활, 지출, 저축, 투자) / 일정·대기 중인 변경·변경 내역 / 설정·관리(관리자만). 아직 없는 기능(명세서 분석, AI 어시스턴트 등)은 목록에 보이지만 "준비 중"으로 비활성이다. 접어서 아이콘만 둘 수 있다.
- 라이트/다크 테마는 설정에서만 바꾼다(헤더에는 버튼이 없다).
- 개발 화면은 메뉴에 없다. 주소 `/dev`로 연다(예전 `#dev`도 된다).
- 폭 760px 이하(휴대폰)에서는 위 막대와 아래 막대(네 칸, 기다리는 AI 제안이 있으면 한 칸 더)가 나오고, 나머지 화면은 아래 막대의 "더보기" 시트에서 연다.
- 디자인 토큰, 다크 규칙, 컴포넌트와 문구 규칙은 `DESIGN.md`, 정적 샘플은 `docs/design/`에 있다.

## 지출

예산 묶음의 **지출** 메뉴(0.1.5, 예전 "구독" 메뉴)는 탭 셋이다: **일반**(일시불), **할부**(카드 할부와 나눠 내기), **구독**(예전 구독 화면 그대로). 주소는 `/spend/general`·`/spend/inst`·`/spend/subs`이고, `#subs`·`#spend/subs` 같은 0.1.5까지의 해시 주소도 새 주소로 이어진다(0.1.6).

- 일회성 지출은 원화나 USD로 적는다. USD는 저장할 때 설정의 환율과 환율 버퍼로 원화를 정하고, 쓴 환율과 버퍼를 지출에 함께 저장한다(설정이 나중에 바뀌어도 저장된 회차는 그대로).
- 내는 방식: 일시불 / 카드 할부(수수료 합계가 있으면 유이자) / 나눠 내기(매달 같은 날, 2주마다, 날짜 직접 정하기). 회당 금액은 (원금 + 수수료) ÷ 회차를 10원 단위로 내린 값이고 끝전은 마지막 회차가 받는다. 카드는 구입한 다음 달의 카드 결제일부터 청구한다. 저장한 뒤 회차마다 날짜·금액을 고치고 "냄"으로 표시할 수 있고, 중도 완납(남은 회차를 한 회차로 합침)과 삭제가 된다. 취소와 다시 켜기는 일시불은 수정 창 3단계의 상태(남음 / 냄 / 취소)에서 한다: 취소는 환불받았거나 내지 않은 지출이라는 뜻이라 회차는 남음이 되고 계산에는 들어가지 않으며("반영 안 함") 지출은 목록에 남는다. 남음이나 냄을 고르면 다시 반영한다. 카드 할부와 나눠 내기는 할부 탭에서 취소하는데, 확인 창을 거치며 낸 회차는 남기고 나머지는 반영에서 뺀다. 다시 켜기는 확인 없이 바로 저장된다.
- 회차는 날짜가 속한 달에 반영한다. 구독 통장으로 내면 그 달 구독 이체(올림 전 합계)에 더하고, 급여 통장이나 카드로 내면 그 달 나머지에서 뺀다. 나머지를 다른 곳에서 자동으로 채우지는 않고, 모자라면 모자라다고 알려 준다. "이번 달 지출 반영" 카드가 이 합계를 보여 준다.
- 홈의 다가오는 결제(31일 안)와 일정 달력에도 회차가 나온다. 기록 추가 › 일회성 지출은 지출 화면의 추가 창을 연다.
- **버퍼 사용**(0.1.7): 카드로 산 것을 그 카드의 결제 통장에 남겨 둔 버퍼로 먼저 내고, 정한 개월(1~60) 동안 급여일마다 (금액 ÷ 개월, 10원 내림, 끝전은 마지막 달)씩 그 통장 이체를 더 넣어 채운다 — 무이자 할부와 같은 효과. 나머지에서는 매달 채우는 돈만 빠진다. 결제 통장이 정해진 카드가 있어야 하고, 버퍼가 모자라면 경고만 한다.
- 카드 지출은 카드를 고를 수 있다(0.1.7). 고르면 그 카드의 결제일로 회차를 잡고, 고르지 않으면 설정의 카드 결제일을 쓴다.
- CSV 내보내기(0.1.7-rc.2): 일반·할부 탭은 회차마다 한 줄, 구독 탭은 보이는 목록. 브라우저에서 만들고 엑셀에서 한글이 깨지지 않게 BOM을 붙인다.

## 현황과 수입 (0.1.8)

- **현황**(홈)은 그달 한 줄로 시작한다: 들어올 돈 − 나갈 돈 = **여유**. 여유(예전 화면의 '나머지')가 가장 큰 숫자이고, 아래에 들어올 돈(월급·정기 수입·기타의 예상과 받은 금액)과 나갈 돈(생활·구독·구간별 고정·저축·투자·그달 지출)이 나란히, 그 아래 '여유 어디에 둘까'(여유 배분)가 있다. 예전 탭(분배 표·AI 제안·예정·확인할 것)은 '자세히' 아래에 있다.
- **수입**(`/income`): 월급(설정의 월 실수령과 월급일, 같은 값)과 정기 수입(매달 n일, 또는 해마다 m월 n일; 예상 금액·받는 통장·메모). 달마다 **받은 금액**을 적으면(한 달에 여러 번 적으면 합) 그 달은 예상 대신 받은 금액으로 계산하고, 차이만큼 그 달 여유가 바뀐다. 생활·구독·저축·투자 이체액은 바뀌지 않는다. 한 번 들어온 돈은 **기타 수입**(날짜·이름·금액)으로 적는다. 정기 수입을 지우면 그 받은 기록도 지워지고, 되돌리면 같이 돌아온다.
- MCP: `get_income`(그달 수입 줄·받은 금액·기타·합·여유), `get_overview`의 `income`·`leftOverKrw`; `propose_changes`는 `incomes`·`income-receipts`·`income-extras`를 받는다.

## 생활·저축·투자 (0.1.7)

- **생활**(`/living`): 생활비 항목 목록. 항목마다 분류·결제 수단·매달 금액·언제부터·구간별 금액을 둔다. 항목 합계가 월급 분배의 '생활비 합계' 대상 값이다. 0.1.6의 식비·교통·용돈 세 값은 같은 금액의 항목 셋으로 옮겨졌다(예전 `PUT /api/living`도 그 세 항목을 바꾼다).
- **저축**(`/saving`)·**투자**(`/invest`): 상품·계좌(= 통장) 목록. 메뉴마다 '금액으로'(항목마다 매달 금액, 구간별 금액) 또는 '비율로'(구간의 총액 × 비율, 천 원 단위 반올림)로 나누고, 항목 합계가 분배 대상 '저축 합계'·'투자 합계'(하나씩)의 값이다. 비율 합이 100%보다 작으면 남는 몫은 나머지로 남는다. 비율 방식의 '총액 수정'은 지금 구간의 그 대상 금액을 바꾼다. 기존 '구간별 고정' 대상은 그대로이고 자동으로 옮기지 않는다.
- **통장**(월급 분배 › 통장·생활비·설정): 은행·끝 4자리·역할·들어오는 돈·나가는 돈, 버퍼·목표·연 납입 한도, 분배 대상의 연결 통장. 통장을 누르면 **잔액 기록**(날짜·금액·이번에 넣은 돈)과 **앞으로 12달 예상**(마지막 기록 + 분배가 그 통장으로 보내는 돈 + 버퍼 채우기 − 그 통장에서 내는 카드값, 이자 없음; 나머지를 받는 통장은 카드값이 이미 빠진 나머지를 받고, 메뉴 대상이 없는 저축·투자 항목에는 들어오는 돈이 없음)이 보인다.
- **목표**: 예상 잔액이 목표에 닿는 달이 오면 대기 중인 변경에 "보내기를 멈출까요?" 카드가 뜬다. 멈추기는 다음 이체 달부터 그 통장으로 가는 금액을 0으로 하고(변경 내역에서 되돌릴 수 있음), 계속 보내기는 그 목표에서는 다시 묻지 않는다. **연 납입 한도**는 그해 예정 납입과 잔액 기록의 '이번에 넣은 돈'(만기금처럼 한 번에 넣은 돈)의 합이 90%를 넘으면 '가까워요', 넘으면 경고만 한다.
- **카드**(같은 탭): 이름·끝 4자리·결제 통장·결제일(비우면 설정의 카드 결제일).
- **이번 달만 조정**(0.1.7-rc.2): 월급 분배 시뮬레이션에서 구간별 고정·저축 합계·투자 합계를 그 달만 바꾼다(한 달·한 대상에 하나). 비율로 나누는 합계는 그 달 총액, 금액으로 나누는 합계는 그 달 항목에 금액 비례로 나눈다.
- **만기 일정**(저축)·**월별 기록**(생활·투자): 기간이 "N개월"·"YYYY-MM까지"인 상품의 만기 달·받을 돈(예상)·만기 후, 이번 달과 그 전 6달의 계획 금액.
- **검색·알림·API 문서**(0.1.7-rc.2): 머리 검색(⌘K), 종 알림(계산한 목록, 읽음은 이 브라우저에만), 바닥 'API 문서'(`/api/docs`).

## 설정·보안 (0.1.7-rc.3)

- **시간대**(설정 › 일반): IANA 시간대(기본 Asia/Seoul). 화면의 "오늘"·"이번 달"과 AI 도구가 이 시간대를 따른다.
- **기준 일정 추가**: 급여일·이체일·카드 결제일 밖에 매달 돌아오는 날(이름·날·통장·들어오는 돈/나가는 돈·메모, 금액 없음). 주말·공휴일 규칙으로 옮긴 이번 달 날짜와 함께 보이고, 일정 달력에도 나온다.
- **통화 목록**: KRW·USD 밖의 외화(코드·환율·버퍼)를 더해 구독·플랜 전환·일회성 지출에 쓴다. USD 환율은 지금처럼 설정에 있다. 쓰는 곳이 있는 통화는 지울 수 없다. 기준 통화는 원화 고정이다.
- **환율 자동 갱신**: 통화마다 '자동'을 켜면 하루 한 번(또는 '지금 갱신') 공개 환율로 바꾼다(위 "운영 배포"). 기본은 꺼짐.
- **비밀번호 정책**(관리 › 로그인 방식 › 비밀번호): 최소 길이(기본 8)와 연속 실패 잠금(기본 꺼짐, 이메일 기준, 관리자가 풂). 정책을 저장하면 관리자의 계정 만들기도 최소 길이를 따른다. 이미 있는 짧은 비밀번호로도 로그인된다. 비밀번호 칸의 '만들기'는 브라우저에서 20자를 만든다.
- **API 키 관리**(설정 › AI·연동): 이름 바꾸기, 범위 바꾸기(읽기 ↔ 쓰기 제안), 만료 연장, 마지막 사용·요청 수. 만료된 키는 되살리지 않고 새로 만든다.

## 분배 구조

월급이 어디로 가는지는 코드가 아니라 데이터로 정한다(월급 분배 화면 → 구간 탭).

- **분배 대상**: 이름과 종류와 연결 통장(선택). 종류는 `생활비 합계`(생활 항목의 합), `구독 이체액`(구독 필요 이체액을 올림 단위로 올림), `구간별 고정`(구간마다 정한 금액), `나머지 전부`(그달 들어올 돈에서 다른 대상을 뺀 금액. 0.1.8부터 들어올 돈은 월급·정기 수입·기타 수입의 합이고, 수입마다 그달 받은 금액을 적었으면 예상 대신 그 금액을 쓴다), `저축 합계`·`투자 합계`(그 메뉴 항목의 합, 0.1.7). 생활비 합계·구독 이체액·나머지·저축 합계·투자 합계는 많아야 하나씩이다. 나머지 대상은 지우거나 다른 종류로 바꿀 수 있고(0.1.4-rc.2), 없으면 들어올 돈에서 대상 합계를 뺀 돈이 "급여 통장에 남음"으로 보인다(모자라면 "모자람").
- **구간**: 기간과, 고정 대상마다의 금액(비율로 나누는 저축·투자 합계 대상은 그 총액). 구간 이름은 시작 월 순서로 자동으로 "N단계"가 붙는다(저장된 기호는 그대로 둔다).
- **올림 단위**: 구독 이체액을 올리는 단위. 1만·5만·10만 또는 "끄기"(1원)를 고른다. 다른 값이 저장돼 있으면 그 값도 선택지로 보인다.
- **나머지 분배**: 나머지 금액을 비율로 나눈다. 마지막 항목이 남는 금액을 받는다.

시드 데이터 파일(`pnpm db:seed [파일]`)은 `targets`, `phases[].amounts`, `remainderSplit`을 포함한다.

## 공휴일 규칙

월급일·분배일·카드 결제일이 주말이나 공휴일이면 앞 영업일로 당기거나 다음 영업일로 미룰 수 있다(설정 › 일반, 기본은 그대로). 공휴일은 규칙 세트로 정한다.

- 대한민국 공휴일이 기본 세트로 들어 있다(`src/data/holidays-kr.ts`, 「관공서의 공휴일에 관한 규정」, 대체공휴일 포함). 끌 수 있다.
- 내 세트: 규칙마다 iCalendar `RRULE`(`FREQ=YEARLY`만) 또는 날짜 목록. 음력은 `RSCALE=DANGI`(예: 설날 `RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1`, 음력 섣달 그믐 `BYMONTHDAY=-1`). 대체 휴일은 "일요일이면" 또는 "토·일요일이면".
- 양력 규칙은 `rrule-temporal`이, 음력은 Temporal의 `dangi` 달력이 계산한다. 음력 날짜는 2025~2050년을 천문연구원 자료와 대조했다(`tests/unit/holidays.test.ts`). 선거일·임시공휴일은 규칙이 없어 내 세트에 날짜로 넣는다.

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
pnpm db:admin      # 관리자 계정만 (ADMIN_EMAIL/ADMIN_PASSWORD)
pnpm db:seed       # 관리자 계정 + 처음 데이터
pnpm keys:rotate   # 데이터 키를 지금 마스터 키로 다시 포장
pnpm keys:forget-lost  # 잃어버린 마스터 키의 데이터 키를 버림 (그 암호문을 비움)
pnpm test:unit     # 단위 테스트 (계산, 암호화, 공휴일·날짜 조정, 테마 대비·표시 형식, 명령 guard)
pnpm e2e           # Playwright E2E (스택이 떠 있어야 함, 아래)
pnpm check:migrations  # 스키마와 drizzle/ 마이그레이션이 맞는지 (db:generate가 바뀐 것이 없다고 해야 함)
pnpm check:logs <파일>  # scripts/check-run.sh가 만든 증거 로그 검사
```

## 테스트

E2E와 `tests/api/*`는 계정 데이터를 만들고 바꾸고 지운다. 실제 데이터가 있는 서버가 아니라 버려도 되는 시험 서버에서 돌린다 — 실제로 쓰는 스택과 다른 DB로 띄운 인스턴스(예: 이 저장소의 관리자는 `docker build -t allot:test .`로 만든 이미지를 별도 DB와 함께 :15174에 띄운다).

```bash
pnpm test:unit                                                                   # DB 없이
BASE=http://<시험 서버> ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm e2e            # UI: 모든 항목 추가·수정·삭제·새로고침
BASE=http://<시험 서버> ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/api/crud.mjs create   # API: create → (api 재시작) → verify → cleanup
```

처음 써 보는 로컬 스택(데이터 없음)이라면 그 스택이 곧 시험 서버다: 위 "개발 서버"대로 `stage.sh`로 올리고 `docker compose -f docker/compose.dev.yaml exec api pnpm db:seed`로 계정을 만든 뒤 `BASE=http://<IP>:15173`으로 돌린다. 실제 데이터를 넣은 뒤에는 그 스택에 돌리지 않는다.

- 시험 서버(:15174)를 띄우고, 남은 시험 행을 지우고, 가짜 시드 데이터를 채우고, 증거 로그로 실행하는 스크립트는 `scripts/test-server/`에 있다 (`README.md` 참고).
- DB에 직접 쓰는 검사(`tests/api/mcp.mjs`의 auth·isolation·tools·write, `tests/api/api-keys.mjs`, `tests/api/isolation.mjs`와 `make-user.ts`)는 `bash scripts/test-server/disposable.sh <로그 이름> <명령…>`으로 돌린다. 실행마다 일회용 PostgreSQL(127.0.0.1:15183, 슈퍼유저가 아닌 롤)과 이 작업 트리의 API(:15184)를 띄우고, 끝나면 실패해도 지운다. 비밀번호와 키는 실행마다 무작위다. :15173·:15174에는 닿지 않는다. API는 앱처럼 모든 인터페이스에서 들으므로, 도는 동안에는 LAN에서도 닿는다(가짜 데이터, 무작위 계정). `tests/api/remainder.mjs`도 `DATABASE_URL`로 DB에 직접 쓰므로, 실제 데이터가 든 스택이 아니라 버려도 되는 DB에서 돌린다.
- `tests/e2e/auth.spec.ts`는 Dex로 승인 대기 흐름을 확인하므로 `DEX_CLIENT_SECRET`도 env로 준다. 관리 API로 OIDC 설정을 바꾸고 계정을 만들고 지우므로 테스트 DB에서 돌린다.
- `tests/e2e/redesign.spec.ts`는 표시 설정·테마·공휴일 세트·날짜 조정을 바꿨다가 되돌리고, 테마 확인용 계정을 하나 만들었다 지운다. 외부 요청 0건과 휴대폰 폭(390)도 확인한다.
- API 검사(`tests/api/`): `preferences.mjs`(표시 설정·공휴일 세트 검증·격리·되돌리기, 두 번째 계정 `B_EMAIL`/`B_PASSWORD` 필요), `admin.mjs`(관리자 권한·동작), `mobile.mjs`(bearer·일회용 토큰, api에 `ALLOT_APP_RETURN_URLS` 필요), `new-account.mjs`(빈 DB에서 `db:admin` 뒤), `isolation.mjs`, `changes.mjs`, `keys.ts`(api 컨테이너 안에서, 키 교체·분실; RLS 검사는 슈퍼유저가 아닌 롤로), `password-guard.mjs`(비밀번호 끄기 안전장치, api 컨테이너 안에서), `rows-of.ts`(계정별 표마다 행 수, 완전 삭제 확인), `mcp.mjs`·`api-keys.mjs`(MCP 도구와 키, 위의 `disposable.sh`로), `income.mjs`·`income-mcp.mjs`(수입과 그 MCP, 0.1.8), `remainder.mjs`(나머지 대상 규칙), `budget-rules.mjs`(생활·저축·투자 쓰기 규칙, 변경 내역 기간). `admin.mjs`와 `new-account.mjs`는 버려도 되는 DB에서 돌린다.

E2E는 시스템 Chrome(`channel: 'chrome'`)을 쓴다. 로그인 시도는 1분에 5번으로 제한된다.

## 구조

- `src/` 프론트. 상태는 `src/lib/store.ts`가 API에서 읽고, 바꿀 때는 API에 먼저 저장한다.
- `src/lib/calc.ts` 순수 계산 함수 (서버와 공유). `src/lib/holidays.ts` 공휴일 규칙(순수, 필요할 때만 불러옴), `src/lib/theme.ts` 사용자 색과 대비 보정, `src/lib/format.ts` 표시 형식.
- `server/` API: `app.ts`(라우팅·세션 확인), `routes.ts`(CRUD), `auth.ts`(Better Auth), `validation.ts`(zod 검증), `mcp/`(MCP 서버와 도구, 제안), `db/`(스키마·마이그레이션·시드).
- `drizzle/` 커밋된 SQL 마이그레이션.
- `scripts/` 개발 도구: `test-server/`(:15173 스테이징을 올리는 `stage.sh`, 시험 서버, 일회용 DB 검사), `check-run.sh`(증거 로그), `guard-*.mjs`(에이전트 명령 guard, `.claude/settings.json`의 PreToolUse 훅).
