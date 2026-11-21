---
intent: "011"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-21"
    words: "그렇게 하자 그럼. a방식으로. 진행"
    rev: 12c33d0
    note: "요약의 PM 결정(USD 환산에 버퍼 포함, 삭제는 수정 창 안, 버퍼 사용·CSV는 준비 중)과 달력 달 기준 반영을 이 진행으로 받음. \"a방식\" = 해시 주소를 vue-router(history)로 바꾸는 일은 0.1.5에 넣지 않고 0.1.5와 0.1.6 사이의 작은 패치로 함 → 이 spec은 해시 주소(#spend) 그대로."
summary_for_user: |
  "구독" 메뉴가 "지출"(#spend, 예전 #subs는 그대로 연결)이 되고, 탭은 일반·할부·구독입니다. 구독 탭은 지금 화면 그대로이고, 위에 세 탭 공통 "이번 달 지출 반영" 카드를 둡니다.
  일회성 지출은 지출 1건 + 회차 행으로 저장합니다. 회차는 calc가 채웁니다: 회당 = (원금+수수료)÷회차를 10원 단위로 내림, 끝전은 마지막 회차. 카드는 다음 달 카드 결제일에 청구합니다. 저장 뒤에는 회차마다 날짜·금액·냄을 고칠 수 있습니다.
  회차는 그 날짜가 속한 달에 반영합니다. 구독 통장이면 그 달 구독 이체(올림 전 합계)에 더하고, 급여 통장·카드면 그 달 나머지에서 뺍니다. 일회성 지출이 없으면 숫자는 지금과 한 원도 다르지 않습니다.
  PM 결정 3가지: USD는 저장할 때 환율×(1+환율 버퍼)로 원화를 고정합니다(캔버스 숫자 ₩67,620은 버퍼 없는 값이지만, 문구 "환율과 버퍼로"를 따름). 삭제는 수정 창 안에(구독과 같이). 버퍼 사용은 '준비 중'입니다(0.1.6).
  작업 단위 9개(W-1~W-9), 검사 11개(V-1~V-11). MCP에 읽기 도구 1개를 더하고, 쓰기는 기존 제안 도구의 대상에 spendings를 넣습니다.
---
## 요구 해석
- S-1 메뉴와 주소 (intent 바라는 결과 1; 질의서 "구독 이라는 메뉴를 아예 \"지출\"이라는 메뉴로 개편"):
  - 사이드바·휴대폰 메뉴의 "구독"을 "지출"로 바꾸고, 아이콘은 캔버스의 영수증 아이콘으로 한다.
  - 주소는 `#spend/general|inst|subs`이고 기본은 general이다. `#subs`는 `#spend/subs`로, `#subs?add`는 구독 추가 창으로 이어 준다(제약: 예전 주소 유지).
  - 구독 탭은 지금 `Subscriptions.vue` 내용을 그대로 쓴다(목록, 전환 미리보기, 변경 일정, 이체액 계산, 구독 추가·수정·삭제, 플랜 전환). 필드·검증·보기는 하나도 빼지 않는다.
- S-2 데이터 (intent "에이전트가 정한 것 — 지출 1건 + 회차 행"):
  - `spending`: 내용(`name`), 메모(`note`), 분류(`category`, 자유 글. 화면 기본값은 생활·가전·여행·경조사·의료·보험이고 "기타"는 직접 입력), 결제일(`bought`, 산 날), 금액(`amount`)과 통화(`currency` KRW|USD), 원화 환산에 쓴 환율(`fxRate`, USD일 때만), 내는 방식(`how`: lump|installment|split), 결제 수단(`payBy`: card|salary|subs), 회차 수(`count`), 수수료 합계(`fee`, 원, 0이면 무이자), 나눠 내기 간격(`interval`: monthly|biweekly|custom, split만), 취소 여부(`cancelled`)
  - `spending_round`: 지출 id, 순번(`no`), 날짜(`date`), 금액(`amount`, 원 정수), 상태(`state`: left|paid|merged), 고침 여부(`edited`)
  - 회차는 지출 본문의 `rounds` 배열로 함께 쓴다(단계 금액과 같은 방식: 지출을 저장하면 그 지출의 회차가 통째로 바뀜). 회차 하나를 고치는 것도 지출 하나를 저장하는 일이다.
  - 0.1.6을 위해 `how`에 값 하나(buffer)와 열(버퍼 통장·채울 개월)을 더할 자리를 남긴다. 0.1.5 검증은 buffer를 받지 않는다.
- S-3 원화 환산 (intent 바라는 결과 5 "적용 환율(구독과 같은 환율과 버퍼)"):
  - USD 금액은 저장할 때 `금액 × 환율 × (1 + 환율 버퍼%)`를 원 단위로 반올림해 회차 원금으로 고정한다. 쓴 환율은 `fxRate`에 남긴다.
  - 나중에 설정의 환율이 바뀌어도 저장된 회차는 그대로다(실제 청구 금액은 회차에서 고침: 캔버스 "실제 청구 금액을 알면 회차에서 고칠 수 있어요").
  - PM 결정: 캔버스 예시 숫자(USD 49 → ₩67,620)는 버퍼를 넣지 않은 값이지만, 문구 "환율과 버퍼(3%)로 원화 환산"을 따랐다.
- S-4 회차 계산 (intent 바라는 결과 6) — `calc.ts`, 순수 함수:
  - 총액 = 원화 원금 + 수수료. 회당 = ⌊총액 ÷ 회차 ÷ 10⌋ × 10이고, 마지막 회차 = 총액 − 회당 × (회차 − 1).
  - 일시불은 1회차 = 총액이다.
  - **카드**(일시불·할부): 1회차는 결제일 다음 달의 카드 결제일(`settings.billingDay`)이고, 그 뒤 달마다 같은 결제일이다. 결제일은 주말·공휴일 조정(`dayShift`)을 다른 월 날짜와 같이 따른다(`monthDay`).
  - **급여·구독 통장**: 일시불은 결제일 그대로다. 나눠 내기는 1회차 날짜를 사용자가 정하고(기본 결제일), 간격은 매달 같은 날(그 달에 그 날이 없으면 말일) / 14일마다 / 회차마다 직접 정하기 중 하나다.
  - 카드 할부의 개월 선택지는 3·6·12와 직접 입력(2~60), 나눠 내기는 2·3·4와 직접 입력(2~60)이다.
  - 저장한 뒤 사용자가 고친 회차는 `edited`가 되고 다시 계산하지 않는다. 회차 합이 총액과 다르면 목록에 차이를 보여 준다. 금액·회차 수·방식을 바꿔 다시 계산하면 고친 회차가 사라진다고 창에서 먼저 알린다.
- S-5 달 반영 (질의서 "결제 수단별 반영"; intent 바라는 결과 2):
  - 회차는 날짜가 속한 달(YYYY-MM)에 반영한다.
  - `payBy = subs`이면 그 달 구독 이체 계산의 올림 전 합계에 더한다. `transferAt`의 `raw`에 더한 뒤 1,000원 올림과 올림 단위를 그대로 적용한다(캔버스 ₩160,000 → ₩230,000).
  - `payBy = salary | card`이면 그 달 분배의 나머지에서 뺀다(`distributionAt`의 `remainder`). 나머지 대상(remainder 종류)이 있으면 그 대상이 받는 금액이 그만큼 준다.
  - 반영에서 빼는 회차: 취소된 지출의 `left` 회차와 `merged` 회차. `paid` 회차는 취소된 지출에서도 그 달에 남는다(이미 나간 돈).
  - 나머지가 음수면 "모자라요"와 "월급 분배에서 조정 →" 링크를 보여 준다. 다른 금액은 바꾸지 않는다(intent 에이전트가 정한 것).
  - 일회성 지출이 없으면 `transferAt`·`distributionAt` 결과는 지금과 같다(intent 제약).
- S-6 상태 (intent 바라는 결과 3·4, 질의서 "회차 상태"; 열린 질문 3):
  - 일반 탭의 상태는 계산해서 보여 준다. 취소 → **취소**, 회차가 paid → **냄**, 카드이고 오늘이 결제일 이후·청구일 전 → **청구 예정**, 그 밖 → **예정**.
  - 할부의 진행 중/완료: 남은(left) 회차가 없으면 완료다. 회차 표의 상태는 냄 / 다음(첫 left) / 남음이다.
  - **중도 완납**: 날짜(기본 오늘)를 고르면 남은 회차가 모두 `merged`가 되고, 그 합을 금액으로 한 새 회차 하나(left, 그 날짜)가 생긴다. 금액은 바꿀 수 있다(남은 수수료 줄이기). 합친 회차는 회차 표에 "중도 완납으로 합침"으로 남는다.
  - **취소**: `cancelled = true`. 남은 회차는 반영에서 빠지고 낸 회차는 남는다. 다시 켤 수 있다.
  - **삭제**: 수정 창 안의 삭제(구독과 같은 확인 창). PM 결정: 캔버스 일회성 창에는 삭제가 없지만, 다른 편집기가 모두 갖고 있고 변경 내역에서 되돌릴 수 있다.
  - "냄"은 사람이 표시한다(intent 에이전트가 정한 것).
- S-7 화면 (intent 바라는 결과 2~5; 캔버스 AppSubs 1795255777-33ed, 사본 `.loctx/reports/0.1.5/canvas/`):
  - 이번 달 지출 반영 카드(S-5)
  - 일반 탭: 열, 거르기, KPI 3, 휴대폰 카드 목록, 빈 상태
  - 할부 탭: 목록·상세, 회차 표, 수정·중도 완납·취소, KPI 3
  - 3단계 추가·수정 창과 회차 수정 창
  - 캔버스 값과 문구는 대조표(W-4에서 `.loctx/reports/0.1.5/canvas/delta.md`)로 항목마다 맞춘다. 캔버스의 가짜 숫자는 실제 계산값으로 바꾼다(0.1.4 D-8과 같음).
  - "버퍼 사용"(내는 방식 버튼, 할부 거르기)과 "CSV 내보내기"는 `Soon`(누를 수 없음, '준비 중')으로 둔다.
- S-8 홈과 일정 (intent 열린 질문 4; 영향 범위):
  - 기록 추가 › 일회성 지출을 켠다. "다음"을 누르면 `#spend/general?add`로 가서 3단계 창이 열린다(구독의 `#subs?add`와 같은 방식). 홈 보드의 예전 2단계 창은 쓰지 않는다.
  - 홈의 다가오는 결제와 일정 달력에 회차(left, 취소 아님)를 지출 이름과 "n/N회"로 함께 보여 준다.
  - 월급 분배 화면의 나머지 줄에 "일회성 지출 −₩…" 근거를 붙이고, 구독 탭 이체액 계산에 "일회성 지출(구독 통장) +₩…" 줄을 둔다.
- S-9 기록과 AI (intent 바라는 결과 7):
  - 지출 쓰기는 `server/ops.ts`의 리소스 `spendings`(자식 표 `spending_round`)로 하고, 변경 묶음과 되돌리기는 기존 방식을 그대로 쓴다.
  - MCP 읽기: 새 도구 `list_spendings`(지출과 회차, 상태). `get_overview`·`get_allocation`·`get_schedule`에 반영 금액과 회차를 넣는다.
  - MCP 쓰기: `AI_LISTS`에 `spendings`를 더해 `propose_changes`로 만들기·바꾸기·지우기를 한다. 미리보기의 이체·분배 전후에 반영이 들어간다.
  - 도구 설명은 영어다(0.1.3 S-10).
- S-10 언어와 문서: 새 문구는 ko·en 모두. CHANGELOG, README(지출), `DESIGN.md`(지출 화면, 메뉴 이름), `docs/ROADMAP.md` 상태 줄.

## 설계
### 계산 (W-1, `src/lib/calc.ts`)
- 타입(`src/data/types.ts`): `Spending`, `SpendingRound`, `SpendHow`, `PayBy`, `RoundState`
- `spendingKrw(amount, currency, s)`: 원화 원금(S-3)
- `planRounds(input, s, off)`: 방식·수단·회차·수수료·간격·첫 날짜(·직접 날짜)로 회차 배열(S-4)
- `payOffEarly(rounds, date, amount?)`: 중도 완납 회차 배열(S-6)
- `spendingIn(spendings, ym)` → `{ subs, remainder, general, installment, items }`(S-5): 그 달 구독 통장 몫, 나머지에서 빠지는 몫(일반/할부 나눔), 근거 항목
- `spendState(sp, today, s, off)`: 일반 탭 상태(S-6)
- `transferAt(subs, changes, s, ym, extra = 0)`: `raw += extra`. `distributionAt(…, spendRemainder = 0)`: `remainder -= spendRemainder`. 기본값이 0이라 지금 호출은 결과가 같다.
- `leftoverAfterTransfer`: 창 안의 구독 통장 회차도 "나간 돈"에 넣는다(이체에 더했으니 함께 뺌).

### 저장과 API (W-2)
- `server/db/schema.ts`
  - `spending`: `seq`, `userScoped`, `unique(user_id,id)`, check(`amount >= 0`, `fee >= 0`, `count between 1 and 60`)
  - `spending_round`: 복합 FK → `spending` on delete cascade, `unique(user_id, spending_id, no)`
  - `pnpm db:generate`로 마이그레이션을 만들고 RLS 정책과 FORCE도 같이 둔다(기존 표와 같은 방식, `rls-check.ts` 목록에 추가).
- `server/validation.ts`: `spending` zod
  - 새 표라 예전에 받던 입력을 거부하는 일은 없다.
  - `rounds` 1~60개, 금액은 0 이상 정수, 날짜 형식, `no`는 1부터 이어짐, 회차 수 = `count` + merged 수 + 중도 완납 1
  - `interval`은 split만, `fee`는 card installment만(그 밖은 0), `how` lump이면 회차 1개
- `server/ops.ts`: `spendings` 리소스(회차를 함께 쓰고 지움, `deleteChildren`이 회차를 기록하며 지움). 잠금은 `data`(기존 목록과 같음).
- `server/changes.ts`: `CHILDREN`에 `spending_round`를 넣어 되돌리기가 회차까지 되돌리게 한다.
- `server/state.ts` `readState`·`src/lib/store.ts`: `spendings`(회차 포함)
- `tests/api/crud.mjs`에 spendings를 넣는다.

### 반영 연결 (W-3)
- `distributionAt`·`transferAt`을 부르는 곳 모두(`Payroll.vue`, `Dashboard.vue`, `Subscriptions.vue`, `PlanChangeEditor.vue`, `SettingsTheme.vue`의 미리보기, `server/mcp/views.ts`, 제안 미리보기)가 `spendingIn`의 값을 넘긴다.
- 도우미 하나(`monthMoney(state, ym)`)로 묶어서 한 곳에서 빠뜨리는 일이 없게 한다.

### 화면 (W-4~W-7)
- `src/pages/Spending.vue`: 탭과 반영 카드를 둔다. 구독 탭은 지금 `Subscriptions.vue`를 자식으로 넣는다(파일은 옮기기만 하고 내용은 그대로).
- 일반 탭 `SpendGeneral.vue`, 할부 탭 `SpendInstallments.vue`
- 창은 `SpendEditor.vue`(3단계, `EditSheet` + `useEditor`)와 `RoundEditor.vue`
- 모양과 모달 규칙은 `DESIGN.md`와 캔버스를 따른다(입력 44px, 단계 표시, `?` 말풍선).
- `App.vue` 메뉴·주소, `AddRecordModal.vue`(일회성 켜기), `Dashboard.vue`·`ScheduleCalendar.vue`(회차)

### MCP (W-8)
- `server/mcp/tools.ts`·`views.ts`: `list_spendings`와 기존 읽기 도구의 반영
- `AI_LISTS`에 `spendings`를 넣는다. `tests/api/mcp.mjs`에 읽기와 제안 → 확인 → 되돌리기를 넣는다.

## 작업 단위
- [x] W-1 계산: 타입, `spendingKrw`·`planRounds`·`payOffEarly`·`spendingIn`·`spendState`, `transferAt`·`distributionAt`·`leftoverAfterTransfer`의 반영 인자, 단위 테스트(V-2·V-3). 화면 변화 없음. (1282e2b)
- [x] W-2 저장과 API: 스키마·마이그레이션(RLS), zod, ops 리소스, 변경 묶음 자식, readState·store, crud 검사(V-4·V-5). (6718a94)
- [x] W-3 반영 연결: `monthMoney`와 모든 호출 자리, 월급 분배 근거 줄, 구독 이체액 계산 줄(V-3 화면 숫자). (e334214)
- [ ] W-4 지출 메뉴: 메뉴 이름·아이콘, `#spend` 주소와 `#subs` 연결, 탭 3개, 구독 탭 이동(내용 그대로), 반영 카드, 캔버스 대조표 `delta.md`(V-6의 구독 보존 E2E).
- [ ] W-5 일반 탭: 목록·거르기·KPI·휴대폰 카드·빈 상태.
- [ ] W-6 할부 탭: 목록·상세·회차 표·KPI, 회차 수정 창, 중도 완납, 취소.
- [ ] W-7 3단계 창: 추가·수정·삭제, 방식 4개(버퍼 사용 Soon), USD 환산, 수수료, 간격, 회차 확인, 다시 계산 경고. 기록 추가 연결, 홈·일정 회차.
- [ ] W-8 MCP: `list_spendings`, 읽기 도구 반영, AI 쓰기 대상(V-9).
- [ ] W-9 문서: CHANGELOG, README, `DESIGN.md`, `docs/ROADMAP.md`.
- 화면 단위(W-4~W-7)마다 ko·en 문구와 그 단위의 E2E를 같이 넣는다.

## 검증 기준
모든 검사는 `scripts/check-run.sh`로 돌리고, 로그는 `.loctx/reports/0.1.5/test/`에 둔다. `pnpm check:logs`를 통과한 로그만 증거로 쓴다. 서버가 필요한 검사는 :15174(`allot-rc`, 이 브랜치 이미지)에서만 한다.
- V-1 게이트: `pnpm typecheck`, `pnpm build`, `pnpm test:unit`이 모두 exit 0. 실패하면 첫 실패에서 멈춘다.
- V-2 회차 계산 단위 테스트, 각 경우의 기대값을 테스트에 적는다:
  - 1,290,000 + 35,000 ÷ 6 → 회당 220,830, 마지막 220,850
  - 1,899,000 ÷ 12 → 158,250 × 11 + 마지막 158,250
  - 카드 11/18 구입 → 12/16. 12/02 → 1/16. 결제일이 토요일이고 `dayShift = before`이면 금요일
  - 나눠 내기: 매달 31일 → 2월 말일, 14일마다, 직접 날짜
  - 중도 완납 합계 = 남은 회차 합, 취소된 지출의 반영
  - USD 49, 환율 1,380, 버퍼 3% → 69,649
  - 실패: 기대값과 하나라도 다르면.
- V-3 반영과 같음:
  - (a) 일회성 지출이 없을 때 `transferAt`·`distributionAt`이 바뀌기 전 함수와 같다(무작위 데이터 200개로 비교하는 단위 테스트).
  - (b) 캔버스 예시(구독 155,400 + 구독 통장 67,620 → 230,000, 올림 단위 10,000)
  - (c) 나머지 대상이 있을 때 그 대상 금액이 준다.
  - 실패: 한 원이라도 다르면.
- V-4 API(`node tests/api/crud.mjs create|verify|cleanup`, create와 verify 사이에 api 재시작): 회차 포함 지출이 재시작 뒤에도 같다. 다른 사용자로 읽기·쓰기·지우기를 하면 404, RLS 검사(`rls-check`)에 새 표 2개가 FORCE로 나온다. 지출 변경 묶음을 되돌리면 회차까지 전과 같다. 실패: 하나라도 다르거나 다른 사용자 행이 보이면.
- V-5 마이그레이션: `pnpm check:migrations`가 변화 없음을 보고한다. :15174의 기존 DB(0.1.4 데이터)에 이 브랜치 이미지를 올려 마이그레이션이 되고, 기존 행 수와 분배·이체 값이 올리기 전과 같다(`get_allocation` 출력 비교). 실패: 오류, 또는 값이 다르면.
- V-6 E2E(:15174, `pnpm e2e`) — 지출:
  - 기본 흐름:
    - 탭 3개, `#subs`·`#subs?add`가 구독 탭과 구독 추가 창으로 간다.
    - 일반: 카드 일시불을 저장하면 청구 달의 반영 카드와 월급 분배 나머지에 같은 금액이 빠지고, 상태가 청구 예정에서 냄으로 바뀐다.
    - 할부: 유이자 6개월 회차 6개와 끝전, 회차 하나를 고치면 "고침", 중도 완납, 취소
    - 나눠 내기 2주 간격
    - 구독 통장 USD 지출이 그 달 구독 이체를 올림 단위로 올린다.
    - 버퍼 사용은 누를 수 없다.
    - 홈 기록 추가 → 3단계 창
    - en 화면 한 번
  - 보존(AGENTS.md "reshaped input"): 0.1.4 구독 편집기가 받던 값(USD+VAT, 연간, 회사 지원, 해지, 날짜 미정 플랜 전환, 메모)을 저장했다 다시 읽어 같다. 구독 탭의 보기 4개가 그대로 있다.
  - 실패: 하나라도 실패하거나 건너뛰면. 건너뛴 E2E는 통과가 아니다.
- V-7 휴대폰 너비: 390px에서 지출 세 탭, 3단계 창, 회차 수정 창이 가로 스크롤 없이 보인다(E2E에서 `scrollWidth <= clientWidth`). 스크린샷은 사용자 확인용으로 둔다. 실패: 넘치면.
- V-8 크기: 첫 화면 JS(`dist/index.html`의 script+modulepreload)가 master보다 +15 kB 이하. 실패: 넘으면.
- V-9 MCP(`tests/api/mcp.mjs`, :15174):
  - `list_spendings`가 지출과 회차를 준다. 읽기 키로는 쓰기 도구가 안 보인다.
  - 쓰기 키로 `propose_changes`(지출 만들기)를 하면 미리보기에 그 달 나머지 또는 구독 이체의 전후가 나온다. 화면(대기 중인 변경)에서 확인하면 적용되고, 변경 내역에서 되돌리면 사라진다.
  - 실패: 하나라도 다르면.
- V-10 릴리스 서버: rc 이미지를 :15174에 DB를 유지한 채 올리고 V-4·V-9의 서버 부분을 다시 돌린다. 끝나면 :15174를 내리고 :15173을 이 커밋으로 최신화한다(시험 데이터 없음). 실패: 오류, 또는 데이터가 남지 않으면.
- V-11 캔버스 대조: `delta.md`의 항목마다 상태(같음 / 다름-사유 / 범위 밖)가 있다. 사유 없는 "다름"은 실패다. 사용자가 :15173에서 확인한다.

## 조정 기록
- A-1 (2026-11-21, W-2) 회차 수 규칙을 "회차 수 − count가 0 이상, merged 회차 수 이하"로 구현하고 최대를 120개로 함(spec 문구는 `count` + merged 수 + 중도 완납 1, 1~60개). 중도 완납은 남은 회차를 merged로 두고 새 회차를 하나 더하므로 count 60의 지출은 61개가 되고 완납을 거듭하면 더 늘어, 1~60개로는 정상 저장이 거부됨 · 6718a94
- A-2 (2026-11-21, W-2) 방식별 회차 수: 일시불은 count 1·회차 1개(합침 없음), 할부·나눠 내기는 count 2~60(S-4의 "직접 입력 2~60"). `spending_round`의 기본 키는 (spending_id, no)이고 변경 기록의 키는 `{spendingId, no}`(phase_amount와 같은 방식) · 6718a94
- A-3 (2026-11-21, W-3) `distributionAt`에 마지막 인자 `spendSubs = 0`을 더함: 구독 통장 지출이 이체액을 올리면 분배의 구독 행과 나머지도 같이 움직여야 하는데 W-1의 `spendRemainder`만으로는 구독 행이 그대로였음. 기본값 0이라 지금 호출 결과는 같음. `monthMoney`가 `spendSubs`와 `spendRemainder`를 같이 넘김 · e334214

## 우려
- 회차가 반영되는 달은 날짜의 달력 달이다. 급여일(예: 25일) 전후로 나누지 않는다. 캔버스 표기 "12/16 청구 · 12월 나머지"를 따랐다. 급여일 기준으로 나누려면 spec을 바꿔야 한다.
- USD 환산에 버퍼를 넣은 것(S-3)은 캔버스 숫자와 다르다. 요약에 적어 사용자 답을 받는다.
- 구독 화면 이동은 큰 화면 파일을 옮기는 일이라 E2E 선택자가 깨질 수 있다. W-4에서 구독 E2E를 먼저 통과시킨 뒤 새 탭을 붙인다.
- 회차를 통째로 바꾸는 저장은 회차 행을 지우고 다시 만든다(seq가 바뀜, 0.1.4 F-2와 같은 모양). 내용 필드만 비교하는 되돌리기 검사에는 문제가 없다.
- 홈 보드의 2단계 창과 앱이 달라진다(열린 질문 4 승인). 캔버스는 사용자가 디자인 세션에서 맞춘다.

## 범위 밖
- 버퍼 사용, 통장·버퍼, 생활·저축·투자 화면(0.1.6)
- 명세서·거래와 자동 대조(0.1.7)
- CSV 내보내기(준비 중으로 둠), 수수료율 자동 계산, USD 말고 다른 외화
- 홈 캔버스 보드 수정
