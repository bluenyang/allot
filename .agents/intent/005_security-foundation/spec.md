---
intent: "005"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-11"
    words: "진행"
    rev: cbefcd8
    note: "RLS 결정 \"RLS는 A안으로 갈까\" 포함. 승인 대상 rev는 A안·V-6b 반영 커밋."
summary_for_user: |
  0.1.1은 화면이 거의 그대로이고 안쪽만 바뀝니다. 모든 데이터에 user_id가 붙고 지금 데이터는 지금 계정 것으로 남습니다.
  격리는 두 겹입니다. 앱이 세션 사용자로 거르고, PostgreSQL RLS가 다시 거릅니다. 테이블 사이 참조도 같은 사용자끼리만 됩니다.
  저장 한 번이 변경 묶음 하나로 기록되고, 변경 내역 화면에서 커밋 되돌리기처럼 되돌릴 수 있습니다(뒤에 같은 행이 바뀌었으면 거부).
  운영은 TRUSTED_ORIGINS env, Traefik HTTPS 예시, 읽기 전용 컨테이너. RLS 우회 롤이면 시작할 때 경고합니다.
  RLS 정책은 스키마(userScoped 헬퍼)에 두고, Drizzle이 못 만드는 FORCE 구문만 --custom 마이그레이션에 둡니다. 시작 검사와 테스트가 빠진 테이블을 잡습니다.
---
## 요구 해석
- S-1 "모든 사용자 데이터 테이블에 `user_id`가 있고, 기존 데이터는 지금 계정의 것으로 그대로 남는다. 화면과 계산 결과는 바뀌지 않는다." → 데이터 테이블 12개(settings, living, subscription, plan_change, phase, plan_event, check_item, bank_account, debt, allocation_target, phase_amount, remainder_split) 모두 `user_id`. 업그레이드 전후 `/api/state`와 월별 분배가 같아야 한다.
- S-2 "다른 사용자의 데이터는 앱 코드(쿼리 조건)와 PostgreSQL 행 수준 보안(RLS) 두 겹으로 막힌다. 조건 하나를 빠뜨려도 DB가 막는다." → 모든 쿼리에 사용자 조건 + RLS 정책. PM 해석: 외래 키 검사는 RLS를 거치지 않으므로, 테이블 사이 참조도 같은 사용자끼리만 되게 복합 외래 키로 막는다.
- S-3 "모든 변경이 변경 묶음(change set)으로 기록된다 … 묶음 하나를 커밋 되돌리기처럼 되돌릴 수 있다." + 사용자 "일반적인 커밋 단위라고 생각해라." → 쓰기 요청 하나 = 묶음 하나. 되돌리기는 반대 변경을 새 묶음으로 남긴다(git revert). 연쇄 삭제된 행(구독을 지우면 딸린 요금 변경 등)도 같은 묶음에 기록되어 함께 되돌아온다.
- S-4 "변경 기록 보관: 기본은 기간 제한 없이 보관하고, 보관 기간 정리 옵션을 둔다." → env 하나, 기본 끔.
- S-5 "운영에서 신뢰하는 출처(origin)를 env로 명시한다. Host 헤더에서 유도하지 않는다(개발은 지금처럼)."
- S-6 "운영 compose 예시에 HTTPS 리버스 프록시 예시가 있고, 컨테이너가 더 좁은 권한으로 돈다." + "Traefik" → Traefik 라벨, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`.
- S-7 "앱 롤이 슈퍼유저이거나 `BYPASSRLS`이면 앱은 시작하되 경고를 남긴다." → 시작 시 검사, 로그 경고. 전용 롤 만드는 법은 README.
- S-8 "시드 스크립트(`pnpm db:seed`)와 로컬 SQL 시드가 `user_id`를 채우게 한다."

## 설계
### 스키마 (S-1, S-2)
- 12개 데이터 테이블에 `user_id text not null references "user"(id) on delete restrict`. 사용자를 지워도 데이터가 연쇄로 사라지지 않는다(0.1.2의 사용자 삭제는 그때 따로 다룬다).
- `id`는 지금처럼 text 기본 키(시드 id 유지, 새 행은 UUID). 각 테이블에 `unique (user_id, id)`를 더한다.
- 참조는 복합 외래 키로 바꾼다: `plan_change (user_id, sub_id) → subscription (user_id, id)`, `phase_amount (user_id, phase_id) → phase`, `(user_id, target_id) → allocation_target`. 다른 사용자의 행을 가리키면 23503(400).
- `settings`·`living`: `id = 1` 한 행 제약을 없애고 기본 키를 `user_id`로. 
- `allocation_target_single_kind` 유일 인덱스는 `(user_id, kind) where kind <> 'fixed'`.
- 마이그레이션: `pnpm db:generate`가 만든 스키마 변경 사이에 `--custom` 데이터 이동을 둔다. 순서: 컬럼을 null 허용으로 추가 → (custom) 기존 행에 계정 귀속 → not null·제약·외래 키. 귀속 규칙: 데이터 행이 있고 `user`가 정확히 한 명이면 그 사람. 데이터가 있는데 사용자가 0명이거나 2명 이상이면 마이그레이션이 이유를 적고 실패한다(추측해서 귀속하지 않는다). 데이터가 없으면 아무것도 하지 않는다.

### 사용자 범위와 RLS (S-2, S-7)
- 요청마다 `withUser(userId, fn)`: 트랜잭션을 열고 `select set_config('app.user_id', $1, true)` 뒤에 `fn`. `/api/state`도 이 트랜잭션 안에서 읽는다(지금의 `Promise.all`은 같은 트랜잭션 연결에서 순서대로 실행).
- 앱 조건: `crud()`의 select·update·delete와 검사 함수(구간 겹침, 대상 종류)에 `user_id = 세션 사용자`. insert는 `user_id`를 서버가 채운다(클라이언트 값은 받지 않는다).
- 표 잠금(`lock table`)은 사용자 단위 advisory lock(`pg_advisory_xact_lock(hashtext('allot:<table>:' || user_id))`)으로 바꾼다. 잠금 순서(phase → allocation_target)는 그대로.
- RLS: 각 데이터 테이블에 헬퍼 `userScoped(t)`(정책 정의 하나)로 Drizzle `pgPolicy`(`for all`, `using`·`with check`: `user_id = current_setting('app.user_id', true)`)와 `enableRLS`. 설정값이 없으면 `null`이라 아무 행도 보이지 않는다(닫힌 쪽으로 실패).
- 소유자 적용: 앱이 테이블 소유자 롤로 접속하므로 `alter table … force row level security`가 필요하다. Drizzle 0.45는 이것을 만들지 못한다 → `--custom` 마이그레이션에 FORCE 구문만 둔다(테이블당 한 줄). 정책·ENABLE은 스키마가 만든다. (우려 1, 사용자 결정 A안)
- 시작 검사: (1) `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`. 둘 중 하나가 참이면 `console.warn`으로 "RLS가 적용되지 않는다, README의 전용 롤 절 참고". (2) `user_id` 열이 있는 public 테이블 중 `pg_class.relrowsecurity`나 `relforcerowsecurity`가 거짓인 것이 있으면 테이블 이름과 함께 경고. 둘 다 경고만 하고 계속 시작한다.
- Better Auth 테이블(`user`, `session`, `account`, `verification`)에는 RLS를 걸지 않는다. 로그인 전(사용자를 모를 때) 읽어야 한다.

### 변경 묶음 (S-3, S-4)
- 표:
  - `change_set(id uuid, user_id, at timestamptz, actor_kind 'user'|'api_key', actor_id text, method text, path text, revert_of uuid null, reverted_by uuid null)`
  - `change_log(id bigint identity, set_id → change_set, user_id, table_name text, row_key jsonb, op 'insert'|'update'|'delete', before jsonb null, after jsonb null)` — `row_key`는 `{id}` 또는 `phase_amount`의 `{phase_id, target_id}`.
  - 두 표 모두 `user_id` + RLS(같은 정책).
- 기록은 앱에서 한다(트리거 아님): `withUser` 안에 묶음 하나를 열고, 쓰기마다 바뀌기 전 행을 읽은 뒤 쓰고 `returning`으로 바뀐 뒤 행을 받아 `change_log`에 넣는다. 아무것도 바뀌지 않은 요청(404, 400)은 롤백되어 묶음이 남지 않는다.
- 연쇄 삭제: 외래 키의 `on delete cascade`는 그대로 두되, 앱이 먼저 딸린 행(구독의 요금 변경, 구간·대상의 구간 금액)을 직접 지우고 기록한다. 그러면 DB 연쇄는 실제로 일어나지 않고, 되돌리면 딸린 행도 돌아온다.
- 되돌리기 `POST /api/changes/:id/revert`:
  1. 묶음의 로그를 거꾸로 돌며, 각 행의 현재 값이 그 로그의 `after`와 같은지 본다(insert면 현재 행 = after, delete면 현재 행 없음). 하나라도 다르면 409 "이후에 바뀐 항목이 있어 되돌릴 수 없어요"와 해당 항목.
  2. 반대 변경을 적용한다(insert → delete, delete → insert(seq 포함 원래 값), update → before로). DB 제약과 앱 규칙(구간 겹침, 대상 종류·나머지 대상)을 다시 검사하고, 어기면 400으로 전체 롤백.
  3. 새 묶음(`revert_of` = 원래 묶음)으로 기록하고 원래 묶음의 `reverted_by`를 채운다. 되돌린 묶음을 다시 되돌리면 다시 적용된다.
- 읽기 `GET /api/changes?before=<at>&limit=50`(최신순, 로그 포함), `GET /api/changes/:id`.
- 보관: `CHANGE_LOG_RETENTION_DAYS`(비어 있으면 끔). 켜면 시작할 때와 하루 한 번, 그보다 오래된 묶음(로그 포함)을 지운다. 지우는 일 자체는 묶음으로 남기지 않는다.

### 화면 (S-3)
- 새 페이지 "변경 내역": 묶음 목록(시각, 무엇을, 행 수, 되돌림 표시), 펼치면 항목별 전후 값, "되돌리기" 버튼(확인 대화상자). 되돌린 뒤 저장소는 `/api/state`를 다시 받는다(서버의 답을 받는다는 규칙 그대로).
- 기존 편집 화면은 바뀌지 않는다.

### 출처·운영 (S-5, S-6)
- `TRUSTED_ORIGINS`(쉼표 구분)가 있으면 그 목록만 믿는다. 없으면 지금처럼 Host에서 유도한다(개발). 운영 예시 `.env`에 이 값을 넣고, README에 "운영에서는 반드시 설정"으로 적는다.
- `docker/compose.prod.yaml`: Traefik 라벨(`websecure` 엔트리포인트, TLS certresolver 이름은 변수, `Host()` 규칙), 외부 네트워크 이름 변수, `TRUSTED_PROXY_IP_HEADER=X-Real-IP`의 조건 설명. `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`. Traefik을 쓰지 않는 경우를 위해 지금의 loopback 포트 바인딩 예시는 주석으로 남긴다.
- README "운영 배포"에 전용 DB 롤 만들기(슈퍼유저 아님, 전용 database의 소유자)를 SQL 예시로.

### 시드 (S-8)
- `pnpm db:seed`: 마이그레이션 → `ensureAdmin`(계정 먼저) → 그 계정의 `user_id`로 `seed(data, userId)` 업서트. 시드 쓰기도 `withUser` 안에서(RLS 통과).
- `--replace-admin`: 옛 계정의 데이터를 새 계정으로 옮긴 뒤(같은 트랜잭션) 옛 계정을 지운다. 지금은 연쇄로 데이터가 같이 지워질 수 있던 자리다.
- 로컬 SQL 시드(`.loctx/scripts/make-seed-sql.ts`, 저장소 밖): 생성 SQL이 계정 → 데이터 순서로 `user_id`를 넣고 `set_config`를 건다. 커밋하지 않는다.

## 작업 단위
- [x] W-1 사용자 범위 스키마와 앱 조건: 12개 테이블 `user_id`, `unique (user_id, id)`, 복합 외래 키, settings·living 기본 키, 사용자별 유일 인덱스, 마이그레이션(생성 + custom 귀속), `crud()`·`/api/state`·settings·living·검사 함수의 사용자 조건, 사용자 단위 advisory lock, 시드(계정 먼저, `--replace-admin` 데이터 이동). (S-1, S-2, S-8)
- [x] W-2 RLS: `userScoped()` 헬퍼로 `pgPolicy`·`enableRLS`, custom 마이그레이션 `force row level security`(FORCE만), `withUser` + `set_config`, 시작 시 롤·RLS 누락 검사 경고, README 전용 롤 절. (S-2, S-7)
- [ ] W-3 변경 묶음 서버: `change_set`·`change_log`(+RLS), 쓰기 경로 기록, 앱이 먼저 지우는 연쇄 삭제, 되돌리기 API(충돌 409, 규칙 400), 목록·상세 API, 보관 기간 정리. (S-3, S-4)
- [ ] W-4 변경 내역 화면: 페이지, 펼치기, 되돌리기 확인, 저장소 갱신, E2E 하나. (S-3)
- [ ] W-5 출처·운영: `TRUSTED_ORIGINS`, compose.prod Traefik 라벨·권한 축소, `.env.example` 운영 절, README·CHANGELOG. (S-5, S-6)
- [ ] W-6 로컬 SQL 시드 생성기 갱신(저장소 밖, 커밋 없음; 결과를 history에 기록). (S-8)

각 W는 게이트를 통과하는 커밋으로 끝난다. W-2는 W-1 위에, W-3·W-4는 W-2 위에 선다. W-5는 다른 W와 독립.

## 검증 기준
모든 원본은 `.loctx/reports/0.1.1/test/`에 명령, 대상 rev, 종료 코드와 함께 남긴다. 기대와 다르거나 종료 코드가 없으면 실패다. 기준을 바꿔야 하면 판정 전에 spec 변경 승인을 받는다.

- V-1 게이트: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build && pnpm build:server` 모두 exit 0.
- V-2 업그레이드 동등성: v0.1.0(마이그레이션 0000~0004)에 로컬 시드를 넣은 DB를 만들고 `/api/state`와 36개월 분배(`calc.ts`)를 저장 → 새 마이그레이션 적용 → 같은 것을 다시 저장 → 두 JSON 차이 0. 모든 데이터 행의 `user_id`가 그 계정. 실패: 차이가 있거나 null `user_id`.
- V-3 귀속 거부: 데이터 행이 있고 사용자가 0명 / 2명인 DB에서 마이그레이션이 이유를 출력하고 non-zero로 끝난다. 데이터가 없는 새 DB는 통과.
- V-4 새 DB와 시드: 새 DB에 `pnpm db:seed` 2회 exit 0, 행 수 = 시드 파일, 로그인 200, `/api/state` 200. `--replace-admin`으로 다른 이메일 → 데이터 행 수 그대로, 모두 새 계정 소유, 옛 계정 없음.
- V-5 앱 격리(API): 테스트 DB에 사용자 B를 만든다. B의 `/api/state`는 409(설정 없음). B가 A의 id로 PUT·DELETE → 404, A의 데이터 그대로. B가 A의 구독 id로 요금 변경 생성 → 400. B가 만든 행은 A에게 보이지 않는다.
- V-6 RLS(DB): 앱 롤로 `app.user_id` 없이 각 데이터 테이블 select → 0행. A로 설정 → A의 행만. A로 설정하고 `user_id = B` insert → 정책 위반 오류. 음성 대조: `crud()`의 사용자 조건 하나를 지운 임시 빌드로 V-5의 B → A PUT을 다시 하면 여전히 404(RLS가 막음); 같은 임시 빌드에서 RLS를 끈 DB로 하면 A의 행이 바뀐다(검사가 실제로 잡는다는 증거). 임시 변경은 커밋하지 않는다.
- V-6b RLS 누락 검사: 테스트 DB에서 `user_id` 열이 있는 테이블 전부 `relrowsecurity = true`이고 `relforcerowsecurity = true`(질의 결과 0행이 기대). 음성 대조: 한 테이블에 `no force row level security`를 걸고 시작하면 그 테이블 이름으로 경고, 질의는 1행. 
- V-7 롤 경고: 슈퍼유저 롤로 시작하면 경고 한 줄, 슈퍼유저가 아닌 전용 롤로 시작하면 경고 없음. 둘 다 `/healthz` 200.
- V-8 변경 묶음: (a) 생성·수정·삭제 각각 묶음 1개와 맞는 로그(op, before, after). (b) 수정 되돌리기 → 값이 before로, 새 묶음 `revert_of`. (c) 요금 변경이 딸린 구독 삭제를 되돌리기 → 구독과 요금 변경 모두 원래 값·순서로. (d) 묶음 뒤에 같은 행을 다시 바꾼 경우 되돌리기 → 409, 데이터 그대로. (e) 되돌린 묶음을 다시 되돌리기 → 다시 적용. (f) 되돌리면 구간이 겹치게 되는 경우 → 400, 데이터 그대로. (g) 400·404 요청은 묶음을 남기지 않는다. (h) B는 A의 묶음을 보지도 되돌리지도 못한다(404).
- V-9 보관: `CHANGE_LOG_RETENTION_DAYS=1`에서 2일 전으로 만든 묶음이 시작 후 지워지고 최근 묶음은 남는다. 값이 없으면 아무것도 지우지 않는다.
- V-10 회귀: `node tests/api/crud.mjs create` → api 재시작 → `verify` → `cleanup` 모두 exit 0. `pnpm e2e` 전부 통과(변경 내역 테스트 포함).
- V-11 출처: 운영 모드(`TRUSTED_ORIGINS=https://allot.example`)에서 `Origin: https://evil.example`로 sign-in → 거부(403), 목록의 출처 → 200. 개발 스택은 지금처럼 LAN 주소에서 로그인 200.
- V-12 운영 compose: `docker compose -f docker/compose.prod.yaml config` exit 0. 로컬에서 빌드한 이미지를 `read_only`·`cap_drop` 설정 그대로 테스트 DB에 붙여 시작 → 마이그레이션 적용, `/healthz` 200, 로그인 200. Traefik 라벨이 설정 출력에 있다.
- V-13 공개 저장소 검사: 브랜치 전체 diff에 `.loctx/public-cleanup/banned.txt`의 금지어가 없다(grep exit 1). 맞는 줄이 있으면 실패, 판정 근거와 함께 기록.

## 우려
1. **손으로 쓴 SQL** — 결정(사용자 2026-11-11, "RLS는 A안으로 갈까", "진행"): `--custom` 마이그레이션에는 FORCE RLS 구문만 둔다. 정책은 스키마에서 생성한다. 새 테이블을 더할 때 FORCE 한 줄을 빠뜨리는 위험은 시작 검사(2)와 V-6b가 잡는다. 대안(소유자 롤·앱 롤 분리)은 운영자 손 SQL과 `DATABASE_URL` 두 개가 필요해 고르지 않았다.
2. 외래 키 검사와 `on delete cascade`는 RLS를 거치지 않는다. 그래서 복합 외래 키로 같은 사용자 안에서만 참조하게 했다. 연쇄는 앱이 먼저 지워서 실제로는 일어나지 않게 한다.
3. 시드 id(`'p1'` 같은 값)는 전체에서 유일한 기본 키라, 두 번째 사용자에게 같은 시드를 넣을 수 없다. 0.1.1에서는 시드 계정이 하나라 문제없다. 0.1.2에서 사용자별 시드가 필요해지면 다시 본다.
4. 앱 수준 기록이라, 앱을 거치지 않은 DB 직접 변경(관리자 SQL)은 기록되지 않는다. 되돌리기의 충돌 검사가 그런 변경을 "이후에 바뀜"으로 잡아 덮어쓰지 않는다.
5. 변경 기록에는 금액·메모가 평문으로 남는다. 0.1.2 암호화 모듈이 생기면 대상에 넣을지 그때 정한다.

## 범위 밖
- 로그인 방식·사용자 생성·관리자 화면(0.1.2), 컬럼 암호화(0.1.2), MCP와 `actor_kind = 'api_key'`의 실제 사용(0.1.3~).
- 운영 서버에 Traefik을 설치·설정하는 일, 운영 DB 롤을 실제로 만드는 일(사용자가 한다; README에 방법).
- 백업, 호스트 디스크 암호화.
