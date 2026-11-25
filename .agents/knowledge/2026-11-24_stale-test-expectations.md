---
id: 2026-11-24_stale-test-expectations
kind: failure
status: active
supersedes: null
topics: [test, review]
decisions: [grep-tests-for-changed-behaviour]
symptoms: ["a final check run fails on a test that expects the behaviour before a review fix", "a renamed button, a widened rule or a new message breaks an older E2E or API check"]
applies_to: all
source: retro 0.1.7 (rc.3 final runs 3 and 4, review rc3-7 R7-1; .loctx/history/0.1.7.md)
approved: { by: user, at: 2026-11-24, words: "낡은 시험 기대값 찾기" }
updated: { by: user, at: 2026-11-25, words: "낡은 시험 찾기를 합치기 단계에", source: "retro 0.1.8 (final run 1: en-flows.spec.ts:92 after the W-5 rename; e2e-5-home3s: a new test looked for nav.mnav, the app has nav.botnav)" }
---
## 결정
동작을 바꾸는 고침(문구·버튼 이름, 받는 값의 범위나 정밀도, 거부·허용, 계산)은 커밋 전에 `tests/` 전체에서 바뀌기 전 값을 찾아 같은 커밋 묶음에서 고친다. 낱말만이 아니라 값의 모양으로도 찾는다: 버튼 이름의 옛 문구, 옛 한도에 걸리던 숫자(예: 소수 자리 수가 같은 모든 숫자 `[0-9]+\.[0-9]{3,}`), 옛 메시지 키. 찾은 것과 고친 것을 리뷰 요청에 적는다.
## 이유
rc.3에서 세 번 반복됐다: F-9가 연장 버튼 이름을 "30일 · 날짜까지"로 바꿨는데 E2E가 "30일 연장"을 찾음(최종 3회차), A-43이 지출 환율을 소수 여섯째까지 받게 했는데 crud.mjs가 셋째 자리 거부를 기대함(4회차), 같은 것을 mcp.mjs가 기대함(리뷰 rc3-7 R7-1 — 낱말 "decimal"로만 찾아 놓침). 각각 30분 가까운 최종 실행 한 번씩을 버렸다.
## 적용
implement·review의 고침 커밋, 위임 브리프. 시험이 고침보다 늦게 합쳐지는 나란한 작업(시험 단위)에도 그 브리프에 바뀐 동작 목록을 넘긴다.
## 적용 (0.1.8에 더함)
나란한 단위를 합친 뒤(합치기 단계) PM이 이 버전에서 바뀐 화면 문구 전부(`git diff <base>..HEAD -- src/i18n server/messages.ts`의 지운 줄)를 `tests/e2e`·`tests/api`에서 찾는다 — 한 단위가 문구를 바꾸고 자기 시험을 고쳐도, 다른 단위의 시험은 남는다(0.1.8: W-5가 en 문구를 바꿨는데 en-flows가 옛 문구를 찾아 최종 1회차를 버림). 새로 쓴 시험이 찾는 셀렉터(클래스·역할·이름)는 처음 돌리기 전에 앱 코드에서 있는지 본다(0.1.8: 없는 `nav.mnav`를 찾아 30초 시간 초과 두 번).
## 바뀌면
시험이 문구 대신 역할·데이터 속성으로 찾게 되면 문구 부분은 줄어든다.
