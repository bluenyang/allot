---
intent: "003"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-10"
    words: "아니면 혹시 bare-repo 하나 만들고 rebase 이용해서 이력을 지우는 건 힘들어? 복잡하면 그냥 진행해"
    rev: 0187f4e
    note: "rebase 방식은 복잡하다고 답한 뒤 진행. 사용자 제안을 반영해 이력 정리는 .loctx/rewrite/의 새 복제본에서 하고, 검사 통과 후에만 작업 저장소로 가져온다(절차 세부 사항, 작업 단위 변경 없음)."
  - role: user
    kind: change
    by: BlueNyang
    at: "2026-11-10"
    words: "야, 아니면 그냥 .git을 새로 만들래? 그게 나을 수도 있어. / (선택) 새 .git으로 (Recommended)"
    rev: 4354edd
    note: "W-4 방식 변경: filter-repo 대신 새 .git(커밋 하나) + 옛 이력 로컬 번들. V-8·V-9를 그에 맞게 수정."
summary_for_user: |
  분배 구조를 데이터로 바꿉니다: '분배 대상'(이름 + 종류: 생활비 합계/구독 이체액/구간별 고정/나머지)과 구간별 금액 표, '나머지 분배'(옛 ISA 분배), 설정 '구독 이체 올림 단위'.
  기존 데이터는 마이그레이션으로 옮기고, 화면 값이 바뀌지 않았는지 36개월 분배를 전후 비교로 확인합니다. 은행 이름·개인 수치가 든 문구는 일반 설명으로 바꿉니다.
  그다음 리뷰·테스트·머지·감사를 마치고, 백업 번들을 만든 뒤 새 .git에서 현재 트리를 커밋 하나로 시작합니다(옛 이력은 로컬 번들에만).
  금지어 목록은 시드 데이터에서 자동으로 뽑아 .loctx에만 둡니다. 새 이력에서 금지어 0건인지 확인한 뒤 rc.3 태그를 만들고, 최종 확인을 받고 푸시합니다.
---
## 요구 해석
- S-1 "은행 이름까지" + intent 계획 1 → 코드·화면에 은행·상품 이름이 없도록, 분배 구조를 데이터로 둔다.
  - **분배 대상**(`allocation_target`): `id`, `name`, `kind`(`living` 생활비 합계 / `subscriptions` 구독 필요 이체액 / `fixed` 구간별 고정 / `remainder` 나머지 전부), `note`. `living`·`subscriptions`·`remainder`는 각각 최대 하나, `remainder`는 정확히 하나여야 분배가 계산된다.
  - **구간별 금액**(`phase_amount`): (`phase_id`, `target_id`) → `amount`. `fixed` 대상에만 둔다. 구간의 옛 열 네 개는 없앤다.
  - **나머지 분배**(`remainder_split`, 옛 `isa_split`): 나머지 금액을 비율로 나눈다(규칙은 지금과 같음: 마지막 항목이 남는 금액, 나머지는 만 원 단위 반올림).
  - 설정 `roundUnit` → `subRound`(구독 이체 올림 단위).
- S-2 intent 계획 2 → 화면 안내문에서 개인 수치·사정과 은행 이름을 지우고, 분배 대상의 이름을 데이터에서 가져와 쓴다. 현황의 고정 비율(나머지의 70%)도 나머지 분배 데이터에서 계산한다.
- S-3 intent 바라는 결과 2 "앱은 지금처럼 동작" → 같은 데이터에서 업그레이드 전과 후의 월별 분배(대상별 금액)가 같다.
- S-4 intent 계획 5·6, 제약 → 이력 정리: 백업 번들, 새 .git(현재 트리 커밋 하나), 재검사. HEAD의 금지어는 같은 규칙으로 먼저 정리한다(4354edd). 금지어 목록은 `.loctx/`에만 둔다. (2026-11-10 W-4 변경에 맞춰 정리: 처음 문구는 filter-repo·커밋 id 대응표였다.)
- S-5 intent 계획 7 → rc.3 태그, 사용자 최종 확인 뒤 `master`와 태그를 origin에 푸시한다.

## 설계
**DB (drizzle)**
- `0002`(generate): `allocation_kind` enum, `allocation_target`, `phase_amount`(FK cascade 양쪽), `remainder_split` 테이블 추가, `settings.sub_round` 추가.
- `0003`(custom, `drizzle-kit generate --custom`): 데이터 이동. 기존 DB에 대상이 없을 때만 일반 이름의 대상 7개를 만든다. 이름은 은행·상품명이 아닌 일반 표현이다(생활비, 구독 이체, 청약, 비상금, 적금, 예비, 나머지). 구간의 네 열 값을 `phase_amount`로, `isa_split`을 `remainder_split`으로, `round_unit`를 `sub_round`로 옮긴다. 사용자의 실제 이름은 로컬 시드로 다시 넣는다.
- `0004`(generate): `phase`의 네 열, `isa_split`, `settings.round_unit` 삭제.
- 이 구조 변경은 생성된 마이그레이션으로만 한다(AGENTS.md 규칙). 데이터 이동만 custom 마이그레이션이다.

**API**
- `/api/state`에 `targets`, `phases[].amounts`(`{ [targetId]: amount }`), `remainderSplit`이 들어간다.
- `/api/targets` CRUD. 규칙 위반(두 번째 `remainder`, 마지막 `remainder` 삭제, `living`/`subscriptions` 중복)은 400이다.
- 구간 PUT/POST는 `amounts`를 함께 받는다. 구간과 금액을 한 트랜잭션에서 쓰고, 기존 겹침 잠금을 유지한다.
- `/api/isa-split` → `/api/remainder-split`.

**계산 (`src/lib/calc.ts`)**
- `distributionAt(ym, netPay, phases, targets, living, subs, changes, settings)`가 대상 순서대로 행을 만든다. 행은 `{ key: target.id, name: target.name, kind, amount, detail }`이다. `Distribution`의 `isa`·`livingTotal`·`subTransfer`는 `remainder`·`living`·`subscriptions`로 바꾼다.
- `TransferCalc.subTransfer` → `transfer`, `Settings.roundUnit` → `subRound`.
- 차트 색은 대상 순서대로 c1~c6, `remainder`는 c1로 고정한다.

**화면**
- 분배 화면에 "분배 대상" 편집기(이름·종류·메모, 추가·수정·삭제)를 둔다. 구간 편집기는 `fixed` 대상마다 금액 입력란을 보여 준다.
- 현황·구독 화면의 "구독 이체"·"이번 달 ISA" 같은 표시는 대상 이름으로 바꾼다.
- 안내문은 일반 설명으로 바꾼다. 개인 사정을 다룬 callout(비정기 수입, 조기 상환 이유, 의무상환, 교통·카드)은 지운다. 개발 탭의 낡은 설계 문서(초기 DDL, API 초안, 배포 메모)는 지우고 "현재 데이터"만 남긴다.

**로컬 (커밋하지 않음)**
- `.loctx/scripts/seed-data.ts`를 새 구조로 바꾼다. 실제 대상 이름과 구간별 금액이 들어간다.
- `make-seed-sql.ts`도 새 구조로 바꾼다.
- `.loctx/public-cleanup/`:
  - `make-banned.ts`: 시드 데이터의 모든 문자열 값(이름·제목·메모·플랜)과 1만 원 이상 금액(숫자, `_`·`,` 구분 표기, 만 단위 표기)을 금지어 후보로 뽑는다. 사람이 추가한 은행·상품 이름과 개인 사정 표현을 더한다.
  - `banned.txt`: 금지어 목록.
  - `replacements.txt`: filter-repo `--replace-text` 규칙. 단어 경계나 문맥이 필요한 것(예: 은행 이름과 같은 일반어)은 `regex:` 규칙으로 쓴다.

**이력 정리 (머지·감사 뒤) — 새 .git** (2026-11-10 변경, 아래 approvals)
1. `git bundle create .loctx/backup/allot-before-public-<날짜>.bundle --all`, `git bundle verify`. 옛 이력은 이 번들로 로컬에만 둔다. 기록(intent·spec·감사)의 커밋 id는 이 번들에서 찾는다.
2. 정리 전 HEAD 트리 해시를 기록한다.
3. 새 저장소를 `.loctx/rewrite/allot`에 만든다(`git init -b master`). 현재 트리(`git archive HEAD`)를 풀고 `.agents/history-archive.md`(마지막 옛 커밋 id, 번들 파일 이름, 이유)를 더해 커밋 하나("Allot 0.1.0-rc.3")로 올린다. 검사(V-8)를 통과하면 작업 저장소의 `.git`을 그 저장소의 `.git`으로 바꾸고, origin 원격을 다시 설정한다. 작업 트리 파일과 `.loctx/`는 그대로다.
4. `v0.1.0-rc.3` 태그.

### 에이전트가 정한 것
- 업그레이드 경로를 남긴다: 생성 → 데이터 이동(custom) → 생성. 대안은 마이그레이션을 처음부터 다시 만드는 것인데, 이미 마이그레이션이 적용된 DB(테스트 스택)가 깨지고 AGENTS.md의 "생성된 마이그레이션만" 규칙과도 어긋나서 고르지 않았다.
- 금지어는 시드 데이터에서 자동으로 뽑는다. 사람이 목록을 손으로 만들면 빠뜨리기 쉽다. 새 .git 방식에서는 금지어 목록과 치환 규칙(`rules.py`)을 HEAD 정리에만 쓴다(4354edd).

## 작업 단위
- [x] W-1 DB: 스키마, 마이그레이션 0002–0004, API(`targets`, 구간 `amounts`, `remainder-split`, `subRound`), 검증·규칙, 서버 시드 실행기(새 SeedData 형식). (S-1)
- [x] W-2 계산·화면: `calc.ts`·`types.ts`·`store.ts`, 분배 대상 편집기, 구간 편집기 금액, 이름·문구 일반화, 개발 탭 정리. (S-1, S-2, S-3)
- [x] W-3 테스트·문서: API 검사·E2E를 새 구조에 맞추고 대상 편집기 E2E 추가, README·AGENTS.md·CHANGELOG(rc.3). (S-1, S-2)
- [ ] W-4 이력 정리: 위 "새 .git" 절차, `.agents/history-archive.md`. (S-4)

## 검증 기준
원본 출력은 `.loctx/reports/0.1.0/rc3/`에 남긴다. 모호하면 실패다. `<dev>`는 `docker compose -f docker/compose.dev.yaml`이다.
- V-1 게이트: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build` exit 0.
- V-2 업그레이드 동등성: 업그레이드 전(rc.2 코드, 현재 테스트 DB)과 후(마이그레이션 적용 + 실제 이름 시드)에 2026-11부터 36개월의 분배를 계산한다(로컬 스크립트, 각 버전의 `calc.ts` 사용). 매달 행의 금액 목록(정렬)과 나머지 금액이 모두 같다. 실패: 한 달이라도 다름.
- V-3 새 DB: 빈 DB에 마이그레이션을 적용하고 새 `.loctx/scripts/seed-data.sql`을 두 번 적용한다. 두 번 다 exit 0이고 행 수가 시드와 같다. 계정을 포함한 판으로 만들면 로그인 200.
- V-4 API: `tests/api/crud.mjs`의 create → api 재시작 → verify → cleanup이 모두 exit 0. 대상 CRUD, 구간 금액 저장, 규칙 위반 400(두 번째 remainder, 마지막 remainder 삭제, living 중복)을 포함한다.
- V-5 E2E: `pnpm e2e` 전부 통과. 대상 추가 → 구간 금액 입력 → 분배에 반영 → 새로고침 유지 → 삭제 테스트를 포함한다.
- V-6 대비: `node tests/contrast.mjs` exit 0.
- V-7 HEAD 금지어: `git grep -niI -f <(.loctx 금지어 고정 문자열)` 결과 0건. 단, 금지어가 아닌 일반어 오탐을 확인해 판정하고 기록한다.
- V-8 새 이력:
  - 새 저장소의 `git rev-list --all --count` → 1(태그 전).
  - 그 커밋 트리와 메시지에 금지어 0건(오탐은 V-7과 같이 판정하고 기록).
  - `src/data/seed.ts` 없음.
  - 그 트리에서 정리 전 HEAD 트리와 다른 파일은 `.agents/history-archive.md`뿐이다.
  - 백업 번들 `git bundle verify` 통과, 번들의 HEAD가 정리 전 HEAD와 같다.
  - 새 저장소에서 V-1 재통과.
- V-9 푸시: `git push --dry-run origin master --tags` 출력에 `master`와 `v0.1.0-rc.3` 태그만 있다. 사용자 확인 뒤 실제 푸시, `git ls-remote origin` 결과가 로컬과 같다.

## 우려
- 공개 저장소에는 커밋 이력이 없다(커밋 하나에서 시작). 옛 흐름 기록의 커밋 id는 로컬 번들에서만 따라갈 수 있다.
- 금지어 자동 추출이 일반어(예: "플러스", "Basic")를 잡을 수 있다. 오탐은 목록에서 빼고 기록한다.
- 이미 공개된 적은 없다(원격이 비어 있음). 그래도 백업 번들과 Syncthing 사본에는 옛 이력이 남는다.

## 범위 밖
- v0.2 기능, 디자인·색, 계산 규칙 변경.
- 원격에 옛 이력을 올리는 일(지금까지 푸시한 적 없음).
