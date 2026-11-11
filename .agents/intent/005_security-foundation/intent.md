---
id: "005"
slug: security-foundation
version: 0.1.1
status: approved
origin: user
approvals:
  - role: user
    by: BlueNyang
    at: "2026-11-11"
    words: "승인"
    rev: 4e772c9
  - role: user
    kind: change
    by: BlueNyang
    at: "2026-11-11"
    words: "RLS는 A안으로 갈까 … 진행"
    rev: cbefcd8
    note: "제약 변경: FORCE RLS 구문만 --custom 마이그레이션에 손 SQL로 둔다."
  - role: user
    kind: permission
    by: BlueNyang
    at: "2026-11-11"
    words: "시작해. 내 승인은 intent와 spec이야. 이후 구현, 테스트, PR, CI는 연속 동작으로 보고 진행해."
    rev: 574da7e
    note: "범위: 구현·리뷰·테스트, 브랜치 푸시, PR 생성, CI 확인까지. 머지·감사·rc·릴리스는 포함하지 않는다."
  - role: user
    kind: permission
    by: BlueNyang
    at: "2026-11-11"
    words: "머지하고, flow 따라서 진행해봐"
    rev: 885454d
    note: "범위: PR #4 머지, 감사, rc(태그·워크플로·이미지). stable 릴리스는 포함하지 않는다(AGENTS.md: stable은 사용자의 명시 지시)."
  - role: user
    kind: permission
    by: BlueNyang
    at: "2026-11-12"
    words: "stable로 진행."
    rev: d8b1c86
    note: "범위: stable 릴리스 노트 PR·머지, 워크플로 v0.1.1(dry run 먼저), 받은 이미지 확인, Release 공개(v0.1.1이 Latest)."
waivers: []
supersedes: null
---
## 문제
사용자 말 (2026-11-11):
> 회계재무에 개인 정보가 많다. 이러면 보안문제도 다뤄야 함. 어떻게 할지 고민해봐
> v0.2에서 multi-user 플랫폼으로 사용할 설계해놔. … 사용자는 유지하고.
> Claude Code나 Desktop에서 쓰기는 하는데, LAN이 아니라 인터넷으로 쓸거다.
> (되돌리기) 일반적인 커밋 단위라고 생각해라.
> (로드맵 확정) 흠... 일단 알겠어. 그렇게 가자

지금 Allot은 사용자 한 명을 전제로 한다. 테이블에 사용자 구분이 없고(`settings`·`living`은 `id = 1` 한 행), 모든 쿼리가 `server/routes.ts`의 `crud()` 하나에서 나간다. 다음 패치들(0.1.2 로그인·관리자, 0.1.3~0.1.4 MCP 읽기·쓰기)은 여러 사용자와 AI의 쓰기 경로를 연다. 그 전에 사용자별 격리, 변경 기록과 되돌리기, 인터넷 노출에 맞는 출처·HTTPS 설정이 있어야 한다. 위원회 권고(`.loctx/context/committee-v0.1.x-20261111.md`)가 이 순서를 제안했고 사용자가 로드맵으로 확정했다.

## 바라는 결과
- 모든 사용자 데이터 테이블에 `user_id`가 있고, 기존 데이터는 지금 계정의 것으로 그대로 남는다. 화면과 계산 결과는 바뀌지 않는다.
- 다른 사용자의 데이터는 앱 코드(쿼리 조건)와 PostgreSQL 행 수준 보안(RLS) 두 겹으로 막힌다. 조건 하나를 빠뜨려도 DB가 막는다.
- 모든 변경이 **변경 묶음(change set)** 으로 기록된다: 누가(사용자·나중에는 API 키), 언제, 어떤 행을, 전후 값. 웹에 변경 내역 화면이 있고, 묶음 하나를 커밋 되돌리기처럼 되돌릴 수 있다.
- 운영에서 신뢰하는 출처(origin)를 env로 명시한다. Host 헤더에서 유도하지 않는다(개발은 지금처럼).
- 운영 compose 예시에 HTTPS 리버스 프록시 예시가 있고, 컨테이너가 더 좁은 권한으로 돈다.

## 계획
1. 스키마: 모든 데이터 테이블에 `user_id`(Better Auth `user.id` 참조). `settings`·`living`은 사용자당 한 행으로 바꾼다. 유일 제약·잠금도 사용자 단위로. 기존 행을 지금 계정에 귀속시키는 데이터 이동은 `drizzle-kit generate --custom` 마이그레이션으로.
2. 서버: `crud()`와 `/api/state`가 세션 사용자로 범위를 좁힌다. 트랜잭션마다 DB에 현재 사용자를 알리고(`set_config`), RLS 정책이 그 값으로 행을 거른다.
3. RLS: 정책을 스키마(Drizzle `pgPolicy`)로 관리하고, 테이블 소유자에게도 적용되게 한다. 앱 DB 롤이 RLS를 우회할 수 없는 조건(슈퍼유저·BYPASSRLS 아님)을 문서와 시작 검사로 지킨다.
4. 변경 기록: `change_set`(묶음)과 `change_log`(행별 전후 값)를 같은 트랜잭션에서 쓴다. 되돌리기는 새 변경 묶음으로 반대 변경을 적용한다. 그 뒤에 같은 행이 다시 바뀌었으면 충돌로 거부한다.
5. 화면: 변경 내역 목록(묶음별, 내용 펼치기)과 되돌리기 버튼.
6. 출처·HTTPS: 운영 `TRUSTED_ORIGINS` env, 운영 compose에 Traefik 예시(HTTPS), 변경 기록 보관 기간 옵션(기본 끔), 컨테이너 `read_only`·`cap_drop`. 시드 스크립트(`pnpm db:seed`)와 로컬 SQL 시드가 `user_id`를 채우게 한다.
7. 리뷰 → 테스트(기존 데이터 업그레이드 동등성, 사용자 두 명으로 격리 검사, RLS 음성 대조, 되돌리기·충돌) → PR → 머지 → 감사 → rc.

## 영향 범위
`server/db/schema.ts`, `drizzle/`(새 마이그레이션), `server/routes.ts`, `server/auth.ts`, `server/app.ts`·`app-env.ts`, `server/validation.ts`, `server/db/seed.ts`, `src/lib/store.ts`, `src/pages/`(변경 내역), `docker/compose.prod.yaml`, `docker/.env.example`, `tests/`(API·E2E), README·CHANGELOG. 로컬: `.loctx/scripts/`(SQL 시드 생성기).

## 제약
- 기존 데이터와 계산 결과가 그대로여야 한다(업그레이드 전후 동등성, rc.3의 V-2와 같은 방식).
- `src/lib/calc.ts`는 순수하게 둔다. 사용자 구분은 서버와 저장소 계층에서만.
- 스키마 변경은 `pnpm db:generate`, 데이터 이동은 `--custom` 마이그레이션. RLS 정책도 스키마에서 생성한다. 손으로 쓴 SQL은 Drizzle이 만들지 못하는 FORCE RLS 구문만, `--custom` 마이그레이션에 둔다(2026-11-11 변경, 사용자 "RLS는 A안으로 갈까" → "진행").
- 운영 DB는 다른 앱과 같이 쓰는 PostgreSQL일 수 있다. Allot은 전용 database와 전용 롤을 쓴다고 가정하고 문서에 적는다.
- 아직 로그인 방식·사용자 생성 화면은 바꾸지 않는다(0.1.2).

## 열린 질문
없음. 2026-11-11 사용자 답: "1. 경고해. 2. traefik 쓰고 있어. 3. 응."
1. 운영 DB 롤: 앱 롤이 슈퍼유저이거나 `BYPASSRLS`이면 앱은 시작하되 **경고**를 남긴다(로그, 그리고 PM 해석: 관리 화면이 생기면 거기에도). 전용 롤을 쓰는 방법은 문서에 적는다.
2. 리버스 프록시: **Traefik**. 운영 compose 예시를 Traefik 라벨(HTTPS 라우터, 신뢰 헤더) 기준으로 쓴다.
3. 변경 기록 보관: 기본은 기간 제한 없이 보관하고, 보관 기간 정리 옵션을 둔다(PM 해석: 0.1.1에 env 설정 하나로 넣는다. 기본값은 끔).

## 질의서 기록
—
### 에이전트가 정한 것
- 격리는 앱 조건 + RLS 두 겹(위원회 권고). 대안은 앱 조건만인데, AI 쓰기 경로에서 조건 하나가 빠지면 남의 데이터가 바뀐다.
- RLS는 별도 비소유자 롤 대신 `FORCE ROW LEVEL SECURITY`로 소유자에게도 적용하는 안을 먼저 본다. 대안(마이그레이션용 소유자 롤 + 앱 전용 롤, `DATABASE_URL` 두 개)은 더 엄격하지만 운영 설정이 늘어난다. spec에서 두 안을 비교해 정한다.
- 되돌리기는 git revert처럼 반대 변경을 새 묶음으로 남긴다. 대안(기록을 지우고 이전 상태로 되감기)은 기록이 사라져 감사할 수 없다.
- 변경 묶음 하나 = API 요청 하나(웹의 저장 한 번). MCP 도구 호출도 0.1.3 이후 같은 단위.
- 0.1.1에서 사용자는 여전히 한 명이다. 두 번째 사용자는 테스트에서만 만든다.

## 하지 않을 것
- OIDC·GitHub·Google 로그인, 관리자 메뉴, 사용자 생성(0.1.2).
- 컬럼 암호화(0.1.2에서 모듈 도입).
- MCP(0.1.3~).
- 백업 스크립트: 운영 백업은 앱 밖에서 이미 하고 있다.
- 호스트 디스크 암호화(앱 범위 밖).
