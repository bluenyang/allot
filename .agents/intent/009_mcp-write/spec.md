---
intent: "009"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-18"
    words: "진행"
    rev: f93a538
    note: "요약의 PM 결정(만료 24시간/15분, 제안 20개·작업 20개, 첫 화면 +15kB, 전체 데이터 지문)은 이 진행으로 받아들임."
  - role: user
    kind: decision
    by: BlueNyang
    at: "2026-11-18"
    words: "둘 다 받음"
    rev: d10f43e
    note: "첫 감사 F-1: A-6(무변경 제안 거부)와 A-13(MCP 입력 strict)을 사후 승인. 구현 전에는 승인이 없었다. 같은 말로 재발 방지 두 가지(AGENTS.md 규칙, 리뷰 요청에 표시)도 받음 — PM 해석."
summary_for_user: |
  쓰기 로직을 "작업(op)" 함수로 빼서 화면 API와 MCP가 같은 규칙으로 씁니다. AI의 변경은 저장되는 "제안"이 되고, 미리보기는 실제로 적용해 본 뒤 되돌리는(rollback) 방식으로 계산해 적용 결과와 어긋나지 않게 합니다(행 전후 + 이번 달·다음 달 이체·분배 전후).
  키를 만들 때 쓰기 범위와 확인 방식(기본 "Allot 화면에서 확인", 또는 "대화 안에서 확인")을 고르고 바꿀 수 없습니다. 화면 확인 키의 제안은 새 "대기 중인 변경" 화면에서만 확인·거절됩니다. 제안 뒤 데이터가 바뀌었거나 만료(화면 24시간, 대화 15분)됐거나 키가 폐기되면 적용을 거절합니다.
  MCP 도구 4개 추가(제안, 되돌리기 제안, 제안 조회, 적용 — 적용은 대화 확인 키만). 읽기 키에는 쓰기 도구가 보이지도 않습니다. AI가 바꾼 변경 묶음은 변경 내역에 "AI · 키 이름"으로 남고 되돌릴 수 있습니다.
  AI가 바꿀 수 있는 것: 구독, 플랜 전환, 분배(단계·금액·대상·나머지), 기준 설정·생활비, 일정·확인 항목 — 삭제 포함. 계좌·부채·공휴일 세트·표시 설정은 제외(제가 정함: intent 목록에 없음).
  작업 단위 6개(W-1~W-6), 검사 12개(V-1~V-12). 모든 검사 로그는 실행기로, check:logs 통과분만 증거.
---
## 요구 해석
- S-1 같은 규칙 (intent "에이전트가 정한 것" — 쓰기 로직 한 곳): 지금 `server/routes.ts`의 쓰기(`crud()`의 만들기·바꾸기·지우기, `PUT /settings`·`/living`, 단계 금액)를 **작업(op)** 함수로 뺀다. 작업 = `{ resource, action: create|update|delete, id?, data? }`. 화면 API는 작업 하나를, AI 제안은 작업 목록을 같은 함수로 적용한다. 검증(zod), 잠금, 겹침 검사, 변경 묶음 기록이 같다. 동작은 바뀌지 않는다.
- S-2 AI가 바꿀 수 있는 것 (intent 바라는 결과 1, 질의서 2 "그게 맞고, 삭제도 허가받고"): `subscriptions`, `plan-changes`, `phases`(단계 금액 포함), `targets`, `remainder-split`, `events`, `checks`의 만들기·바꾸기·지우기와 `settings`, `living`의 바꾸기. `accounts`, `debts`, `holiday-sets`, `preferences`는 제외(PM 판단: intent 목록에 없음 — 계좌는 0.1.6).
- S-3 제안과 미리보기 (intent 바라는 결과 2, 에이전트가 정한 것 — 저장되는 제안):
  - AI의 변경은 바로 적용되지 않고 **제안**으로 저장된다: 작업 목록(최대 20개), 만든 키, 확인 방식, 기준 데이터 지문, 미리보기, 만료, 상태(`pending|applied|rejected|expired|stale`).
  - 미리보기는 **실제로 적용해 보고 롤백**해서 만든다(같은 트랜잭션 안에서 적용 → 상태 읽기 → ROLLBACK). 그래서 미리보기와 실제 적용이 같은 코드로 계산된다. 담는 것: 행마다 전후(만들기·바꾸기·지우기), 이번 달·다음 달의 이체 금액(`transferAt`)과 분배(`distributionAt`) 전후. 적용해 보다 규칙 위반(400 사유)이 나면 제안은 만들어지지 않고 그 사유를 돌려준다.
  - 기준 지문: 제안할 때 사용자 데이터(`readState`)의 해시. 적용할 때 다시 계산해 다르면 `stale`로 거절하고 "다시 제안하세요"를 돌려준다(낡은 미리보기로 적용 금지).
  - 만료: 화면 확인 키 24시간, 대화 확인 키 15분(PM 결정). 사용자당 대기 중 제안 최대 20개.
- S-4 확인 방식 (질의서 1 "c가 좋겠다. 기본값 b"):
  - 키를 만들 때 고른다: "Allot 화면에서 확인"(기본) / "대화 안에서 확인". 쓰기 범위가 없는 키는 고르지 않는다.
  - 화면 확인 키: 제안은 "대기 중인 변경" 화면에서 사용자가 확인하거나 거절한다. MCP의 적용 도구는 거절한다("Allot에서 확인하세요").
  - 대화 확인 키: AI가 적용 도구에 제안 id를 넘겨 적용한다. 화면에서도 확인·거절할 수 있다.
  - 두 방식 모두 제안 → 적용 두 단계(intent 에이전트가 정한 것). 미리보기 없이 바로 쓰는 도구는 없다.
- S-5 키 범위 (intent 바라는 결과 4, 에이전트가 정한 것): 키를 만들 때 "쓰기 허용"을 고르면 `permissions = { mcp: ['read','write'] }`, 확인 방식은 키의 `metadata.confirm = 'ui'|'chat'`. 만든 뒤 바꿀 수 없다(바꾸는 API 없음). 목록에 범위와 확인 방식이 보인다. 0.1.3의 읽기 키는 그대로.
- S-6 MCP 도구 (intent 바라는 결과 1~3, 질의서 3 "AI도 허용"): 쓰기 범위 키에만 보이고 쓸 수 있다(읽기 키의 `tools/list`에는 없음).
  - `propose_changes { changes: [...], note? }` → `{ proposalId, confirm, expiresAt, preview }`.
  - `propose_revert { changeSetId, note? }` → 같은 모양. 되돌리기도 제안 → 확인(PM 해석, intent 질의서 3).
  - `get_proposal { proposalId }` → 상태와 미리보기(AI가 화면 확인 여부를 알 수 있게). 그 키가 만든 제안만.
  - `apply_proposal { proposalId }` → 대화 확인 키만. 적용된 변경 묶음 id를 돌려준다.
  - 도구 설명·오류는 영어(0.1.3 S-10). 주석(annotations): propose·get은 데이터를 안 바꿈, apply는 `destructiveHint: true`.
- S-7 변경 묶음과 행위자 (intent 바라는 결과 3, 에이전트가 정한 것 — 행위자 표시): 적용된 제안은 변경 묶음 하나(커밋 단위). `actor_kind = api_key`, `actor_id = 키 id`, 새 열 `actor_label`(적용 때의 키 이름, 키가 지워져도 남음)과 `proposal_id`. 화면에서 확인해 적용해도 행위자는 제안한 키이고, 확인한 사람은 제안 기록에 남는다. 변경 내역에 "AI · <키 이름>"으로 보이고, 0.1.1 되돌리기를 그대로 쓴다.
- S-8 안전 (intent 제약):
  - 적용할 때 모든 작업을 다시 검증한다(zod + 규칙). 제안 때 통과했다고 건너뛰지 않는다.
  - 키가 폐기·만료됐거나, 쓰기 범위가 없거나, 계정이 활성이 아니면 그 키의 제안은 적용할 수 없다(화면 확인 포함).
  - 제안·미리보기·적용은 모두 RLS 아래, 그 사용자만. 다른 사용자의 제안 id는 404.
  - 키로 키·로그인·관리자 기능은 여전히 못 바꾼다(0.1.3 그대로).
- S-9 화면 (질의서 1): 새 "대기 중인 변경" 화면(사이드바에 대기 개수 배지): 제안 목록, 각 제안의 작업·행 전후·이체/분배 전후, 확인·거절. 설정 › AI·연동: 키 만들기에 "쓰기 허용"과 확인 방식, 목록에 범위·확인 방식. 변경 내역: 행위자 표시. 새 문구는 한국어·영어 모두(0.1.3 i18n).

## 설계
### 작업 함수 (W-1)
- `server/ops.ts`: `RESOURCES` 표(테이블, zod, 옵션 — 지금 `crud()`의 인자 그대로), `applyOp(q, uid, rec, op)`(만들기·바꾸기·지우기·단일 행 바꾸기), `applyOps(q, uid, rec, ops)`(순서대로, 하나라도 실패하면 예외 → 트랜잭션 전체 롤백). 잠금 순서는 `changes.ts`에 적힌 순서를 지킨다(한 제안의 작업들이 여러 표를 건드릴 때 같은 순서로 잠금을 미리 잡는다).
- `routes.ts`의 `crud()`와 `PUT /settings`·`/living`은 `applyOp`를 부르게 바꾼다. HTTP 응답 모양·상태 코드·오류 문구는 그대로(V-2).
- AI 허용 목록은 `AI_RESOURCES`로 따로(S-2).

### 제안 (W-3)
- 표 `mcp_proposal`(RLS `userScoped`): `user_id`, `id`, `key_id`, `confirm`(`ui|chat`), `ops` jsonb, `note`, `base_hash`, `preview` jsonb, `status`, `created_at`, `expires_at`, `decided_at`, `decided_by`(`user|key`), `change_set_id`, `revert_of`(되돌리기 제안이면 그 묶음 id). `pnpm db:generate`, `OWNED`에 추가, 관리자 완전 삭제·계정 이동에도 포함.
- `change_set`에 `actor_label` text, `proposal_id` text 열.
- `server/proposals.ts`:
  - `propose(uid, key, ops|revert, note)`: 트랜잭션 → `readState` 전 + 해시 → `applyOps`(또는 `revert`) → `readState` 후 → 미리보기 계산 → **ROLLBACK**(예외로 끝냄) → 새 트랜잭션에서 제안 저장. 규칙 위반은 사유를 돌려주고 저장하지 않음.
  - 미리보기: 행 전후는 기록기(`Recorder`)를 메모리 모드로 돌려 모은다(실제 `change_set`을 쓰지 않음). 월 계산은 `server/mcp/views.ts`의 `overview`를 전·후 상태로 이번 달·다음 달.
  - `apply(uid, proposalId, by)`: 상태·만료·키(존재, 쓰기 범위, 계정 활성)·지문 확인 → 같은 트랜잭션에서 `applyOps`(행위자 = 키, `actor_label`, `proposal_id`) → 상태 `applied`, `change_set_id`. 실패 사유: `expired`, `stale`, `key_revoked`, `not_pending`, 규칙 위반.
  - `reject(uid, id)`, 만료 처리(읽을 때 `expires_at`이 지났으면 `expired`로).
- 지문: `readState` JSON을 키 순서 정렬 후 SHA-256.

### MCP (W-4)
- `buildMcpServer(uid, key)`: 키의 범위·확인 방식을 받아 쓰기 범위가 있을 때만 쓰기 도구 4개 등록.
- `propose_changes`의 입력: 자원별 판별 유니언(zod) — `{ resource, action, id?, data? }`, `data`는 그 자원의 zod 스키마. 최대 20개.
- 오류는 0.1.3의 `guarded`로(내부 메시지 숨김), 규칙 위반 사유는 영어 문구로 돌려준다.

### API와 화면 (W-2, W-5)
- `POST /api/keys`에 `write: boolean`, `confirm: 'ui'|'chat'`(write일 때만, 기본 `ui`). 플러그인 `enableMetadata: true`(서버만 씀).
- `GET /api/proposals?status=pending`, `GET /api/proposals/:id`, `POST /api/proposals/:id/apply`, `POST /api/proposals/:id/reject` — 세션에서만.
- `src/pages/Pending.vue`(지연 로드), 사이드바 "대기 중인 변경"과 배지(대기 개수, `/api/state`에 `pendingProposals` 개수 추가), 변경 내역의 행위자.

### 문서 (W-6)
- CHANGELOG 0.1.4, README의 MCP 절(쓰기 키, 확인 방식, 도구), `docs/ROADMAP.md` 상태.

## 작업 단위
- [x] W-1 작업 함수: `server/ops.ts`, `routes.ts`가 그것을 부르게, 동작 그대로. 단위 테스트(작업 목록 적용·실패 시 전체 롤백). (S-1) — 커밋 de8d4dc
- [x] W-2 키 범위와 확인 방식: `POST /api/keys`의 `write`·`confirm`, 플러그인 metadata, 목록 표시, 설정 › AI·연동 화면(쓰기 허용, 확인 방식, 경고 문구), `tests/api/api-keys.mjs` 확장, i18n. (S-5, S-4 일부) — 커밋 9ebc29b, f251770
- [x] W-3 제안: `mcp_proposal` 표·`change_set` 열·마이그레이션(`pnpm check:migrations`), `server/proposals.ts`(제안·미리보기·지문·만료·적용·거절), `OWNED`·완전 삭제, 단위 테스트(미리보기 = 적용 결과, 지문 불일치, 만료). (S-3, S-7, S-8) — 커밋 61cf536, 2fc7b35
- [x] W-4 MCP 쓰기 도구 4개, 키 범위에 따른 등록, `tests/api/mcp.mjs`에 `write` 모드(제안·적용·확인 방식·격리·되돌리기·폐기된 키). (S-6, S-8) — 커밋 99b70d6
- [x] W-5 화면: `/api/proposals`, "대기 중인 변경" 화면·배지, 변경 내역 행위자, i18n(ko·en), E2E `tests/e2e/proposals.spec.ts`. (S-9, S-7) — 커밋 231baf4, 7ca68d1, 236f98d, fdbc57a
- [x] W-6 문서: CHANGELOG, README, ROADMAP. (intent 영향 범위) — 커밋 ed2d828

## 검증 기준
모든 검사는 `scripts/check-run.sh`로 돌리고, 로그는 `pnpm check:logs`를 통과해야 증거다(AGENTS.md). 로그는 `.loctx/reports/0.1.4/`. 위임한 검사도 같다.
- V-1 게이트: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm build:server`, `pnpm test:unit`, `pnpm check:migrations` 모두 exit 0. 첫 화면 JS gzip을 master(f2e3a9b) 대비 적는다 — 증가 15kB 이하(새 화면은 지연 로드). 넘으면 원인을 적고 묻는다.
- V-2 같은 동작(W-1): 기존 API 검사 전부(`crud.mjs` create → api 재시작 → verify → cleanup, `changes.mjs`, `preferences.mjs`, `isolation.mjs`, `api-keys.mjs`, `mcp.mjs auth|isolation|tools`)와 전체 E2E가 통과. `/api/state`가 W-1 전후로 같다(시드 계정, JSON 비교).
- V-3 키 범위: 쓰기 없는 키 → `tools/list`에 쓰기 도구 없음, 쓰기 도구 호출은 MCP 오류. 쓰기 키는 `confirm` 기본 `ui`. `write: false`에 `confirm`을 주면 400. 키를 바꾸는 경로 없음(PUT/PATCH 404).
- V-4 제안과 미리보기: `propose_changes`(구독 하나 만들기 + 생활비 바꾸기) → 미리보기의 행 전후·이번 달 이체 전후가 있고, DB에는 아무것도 바뀌지 않음(`/api/state` 그대로, `change_set` 수 그대로). 규칙 위반 작업(겹치는 단계) → 제안 없음, 사유 반환. 21개 작업 → 거절.
- V-5 적용 = 미리보기: 대화 확인 키로 제안 → `apply_proposal` → `/api/state`가 미리보기의 "후"와 같고, 변경 묶음 하나(`actor_kind=api_key`, `actor_label` = 키 이름, `proposal_id`). 같은 제안 다시 적용 → 거절(`not_pending`).
- V-6 확인 방식: 화면 확인 키의 제안 → `apply_proposal`은 거절, `POST /api/proposals/:id/apply`(세션)로 적용됨. `reject` → `rejected`, 적용 불가. `get_proposal`이 상태를 돌려줌.
- V-7 낡은 제안·만료·폐기: 제안 뒤 화면 API로 데이터를 바꾸면 적용 → `stale`. DB에서 `expires_at`을 과거로 → `expired`. 키를 폐기한 뒤 그 키의 제안을 화면에서 적용 → 거절. 대기 21번째 제안 → 거절.
- V-8 되돌리기: AI가 적용한 묶음을 `propose_revert` → 적용 → 데이터가 적용 전과 같음(`/api/state` 비교), 새 묶음의 `revert_of`. 화면의 되돌리기 버튼도 AI 묶음에 동작.
- V-9 격리: 사용자 A의 쓰기 키로 B의 제안 id·묶음 id → 404/오류, B의 데이터 불변. 제안 표 RLS(다른 사용자로 select → 0행).
- V-10 화면 E2E: 대기 중인 변경 목록·배지 개수·미리보기 표시, 확인 → 데이터 반영과 변경 내역의 "AI · 키 이름", 거절. 키 만들기에서 쓰기·확인 방식. 영어 화면에서도 같은 흐름. 기존 E2E 전부 통과.
- V-11 실제 클라이언트: dev 스택에서 Claude Code로 화면 확인 키 연결 → 도구 목록 10개(읽기 6 + 쓰기 4), `propose_changes` 성공(값은 적지 않음), 화면에서 확인. 결과를 적는다.
- V-12 테스트 서버: rc 이미지를 `allot-rc`(:15174)로, 비밀값은 `.loctx/rc/allot-rc.secrets`(AGENTS.md 예외)로 띄워 DB를 유지한 채 마이그레이션 적용 → V-11 흐름 한 번(쓰기 키, 제안, 화면 확인, 되돌리기 제안).

## 조정 기록
- A-1 (2026-11-18, W-5) `/api/state`에 `pendingProposals`를 더하면서 `readState()`(지문의 범위)에는 넣지 않았다(제안을 만들면 개수가 바뀌어 스스로 낡게 만들기 때문). E2E "JSON 내보내기 = API"는 이 숫자를 데이터가 아니라고 보고 뺀다 · fdbc57a
- A-2 (2026-11-18, W-1·W-3) 단위 테스트는 DB 없이 도는 `tests/unit/`에 둘 수 없는 것(작업 목록 적용·롤백, 제안·미리보기=적용, 낡음·만료·폐기)을 `tests/api/ops.ts`·`tests/api/proposals.ts`(dev DB, tsx)로 두고, DB 없는 부분(지문·월 미리보기)은 `tests/unit/preview.test.ts` · de8d4dc, 2fc7b35
- A-3 (2026-11-18, W-3) `mcp_proposal`에 `key_name` 열을 더했다(키가 폐기돼도 "누가 제안했나"를 화면에 보이기 위해; 설계 표에 없던 열) · 61cf536
- A-4 (2026-11-18, W-2) 키는 서버 호출(`userId`·`permissions`·`metadata`, 요청 헤더 없음)로 만든다. 플러그인이 헤더가 있는 호출의 `permissions`를 거절하기 때문. 읽기 키도 같은 길(권한 `{mcp:['read']}`을 명시) · 9ebc29b
- A-5 (2026-11-18, W-3) 마이그레이션 0024(FORCE RLS)는 drizzle-kit이 빈 파일로 만든 뒤 채웠고, dev 스택이 그 사이에 빈 파일을 적용해서 dev DB에는 `ALTER TABLE mcp_proposal FORCE ROW LEVEL SECURITY`를 손으로 한 번 실행했다(dev 전용; 새 DB는 0024가 적용됨) · 61cf536
- A-6 (2026-11-18, W-3·W-4) 제안이 아무것도 바꾸지 않으면(`rows` 없음) 만들지 않고 거절한다(`invalid`, "Nothing would change."). `apply_proposal`은 쓰기 키 모두에 등록되고 화면 확인 키가 부르면 `wrong_confirm`으로 거절한다(V-6 문구대로) · 2fc7b35, 99b70d6
- A-7 (2026-11-18, W-5) 폰의 아래 막대에는 "대기 중인 변경"이 기다리는 제안이 있을 때만 들어간다 · 7ca68d1
- A-8 (2026-11-18, W-3·W-4, 코드 리뷰 1) `propose_revert`가 AI 허용 목록을 우회했다. 되돌릴 변경 묶음이 건드린 표를 AI가 바꿀 수 있는 표(허용 자원 + 자식 표 `phase_amount`)와 대조해 하나라도 밖이면 묶음 전체를 거절한다(제안 때와 적용 때 둘 다). 계좌·부채·공휴일 세트·표시 설정·섞인 묶음의 음성 테스트 · 5ecdb7a
- A-9 (2026-11-18, W-1·W-3, 코드 리뷰 2) 사용자별 "데이터 잠금"(`lockFor(q,'data',uid)`)을 잠금 순서 맨 앞(data → phase → allocation_target → settings → living → preference → proposal)에 두고, 사용자 데이터를 쓰는 모든 길(`applyOp`·`applyOps`·되돌리기·미리보기·적용·`moveOwner`·관리자 삭제·시드)이 가장 먼저 잡는다. 지문 확인과 적용 사이에 화면 쓰기가 끼면 적용은 `stale`이 된다(연결 두 개와 장벽으로 검사) · ae26c89
- A-10 (2026-11-18, W-3, 코드 리뷰 3) 적용은 잠금을 잡은 뒤 같은 트랜잭션 안에서 제안 상태·만료, 키(있음·켜짐·만료 전·쓰기 범위; `FOR SHARE`), 계정(활성·정지 아님)을 읽어 확인한다. 잠금을 기다리는 동안 폐기·만료·정지가 되면 거절한다(검사: 키 폐기·키 만료·쓰기 범위 상실·제안 만료·계정 비활성) · b382561
- A-11 (2026-11-18, W-5, 코드 리뷰 4) 대기 화면은 대기 중 제안을 따로 전부 받아(최대 20개) 배지 숫자를 그 길이로 정하고, 처리한 제안은 `status=handled`로 20개씩 쪽 나눠 받는다(`limit`·`before`·`beforeId`) · 6f4124e
- A-12 (2026-11-18, W-3, 코드 리뷰 5) 테스트 보강: RLS는 `relforcerowsecurity`와 소유 역할(NOBYPASSRLS)로 확인(FORCE를 빼면 실패), B의 기준선은 시도 전에, 적용 때 `parseOp`가 없으면 실패하는 "저장된 작업이 깨진" 테스트 · 5fd0cbf
- A-13 (2026-11-18, W-4, 코드 리뷰 6) MCP 도구·작업 봉투를 `.strict()`로 해서 모르는 필드와 단일 행 자원의 `id`를 조용히 버리지 않고 거절한다. `propose_changes` 설명에 "새 대상과 그 금액은 제안 두 번"을 적었다(알려진 한계) · 5938fce, 05a47da
- A-14 (2026-11-18, W-5, 코드 리뷰) 미리보기 표의 필드 이름을 ko/en 문구로 보인다(`netPay` 같은 속성 이름을 그대로 보이지 않음) · 06a5026
- A-15 (2026-11-18, W-3, 재리뷰 1) 계정 교체(seed `--replace-admin`)가 목적 계정 행을 바꾼 뒤에야 데이터 잠금을 잡아, 데이터 잠금을 먼저 잡고 사용자 행을 읽는 적용과 교착이 날 수 있었다. 계정 행을 건드리기 전에 두 사용자의 데이터 잠금을 (정렬해서) 먼저 잡는다. 다른 `moveOwner` 호출은 없고, 사용자·키 행을 쓰는 관리자 경로는 그 뒤에 데이터 잠금을 잡지 않는다(삭제는 데이터 잠금이 먼저). 검사: 적용을 데이터 잠금에 대기시킨 채 교체를 뒤에 세우고 풀면 둘 다 끝난다(옛 순서에서는 교착 오류) · 66e930f
- A-16 (2026-11-18, W-3, 재리뷰 2) 제안 만료 확인을 계정·키 행 `FOR SHARE` 대기 뒤, 적용 직전으로 옮겼다. 검사: 다른 연결이 키 행을 `FOR UPDATE`로 쥐고 `expires_at`이 지난 뒤 놓으면 적용은 `expired`(옛 순서에서는 통과) · 7ace63e

## 우려
- 미리보기를 "적용 후 롤백"으로 만들면 제안 때 잠금을 잡는다. 짧은 트랜잭션이라 화면 쓰기와 잠깐 경합할 뿐이지만, 같은 잠금 순서를 지켜 교착을 막는다(설계 W-1).
- 지문이 `readState` 전체라서 제안과 상관없는 변경(예: 표시 설정)도 `stale`을 만든다. 안전한 쪽으로 틀리는 것이라 그대로 둔다. 불편하면 대상 표만 지문에 넣는 조정(A-n)으로.
- `propose_changes`의 입력 스키마가 크다(자원별 유니언). 클라이언트가 큰 스키마를 잘 다루는지 V-11에서 확인한다.
- 화면 확인 키의 24시간 만료가 짧거나 길 수 있다 — rc에서 사용자 확인.
- 새 분배 대상과 그 대상을 쓰는 금액(단계의 고정 금액)은 한 제안에 함께 담을 수 없다(서버가 새 행의 id를 정한다). 알려진 한계로 두고, `propose_changes` 도구 설명이 AI에게 제안을 두 번(대상 먼저, 금액은 그 뒤) 하라고 알려 준다.

## 범위 밖
- 계좌·부채·공휴일 세트·표시 설정 쓰기(0.1.6 등에서).
- 키의 범위·확인 방식 바꾸기(새 키로).
- 제안 알림(푸시·메일), 여러 사람이 확인하는 흐름.
- OAuth 기반 MCP(0.1.10).
