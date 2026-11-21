---
id: 2026-11-16_stop-at-first-failure
kind: failure
status: active
supersedes: null
topics: [test, process]
decisions: [stop-at-first-failure]
symptoms: ["a check sequence goes on after a failed step", "preparation failed, the next check ran anyway", "audit: 'failure, then continued'"]
applies_to: all
source: retro 0.1.2 (audit 0.1.2 A-4, supplement B-5; rc.1 test server, 2026-11-16)
approved: { by: user, at: 2026-11-16, words: "1~5, 8, 9 승격 허가 함." }
updated: { by: user, at: 2026-11-21, words: "D12. 인용", source: "retro 0.1.4 (second audit, item 2 handed to the retro)" }
---
## 결정
준비든 검사든 한 단계가 실패하면 다음 단계로 가지 않는다. 멈추고, 원인을 찾고, 원인을 기록한 뒤 처음부터(또는 원인이 닿지 않는 지점부터) 다시 돌린다. 실행 스크립트는 첫 실패에서 멈추게 쓴다(`ok() { …; [ "$1" = 0 ] || exit 1; }`).
## 이유
세 번 반복됐다: 0.1.2 V-10 password-guard(준비 실패 뒤 검사 계속), 보충 감사 B-5(같은 일과 멈추지 않는 `fresh.sh`), rc.1 테스트 서버(create 실패 뒤 restart·verify·cleanup까지 진행 — 원인은 시드 없는 계정이었다). 실패 위에서 이어 간 단계는 결과가 아니고, 테스트 데이터를 꼬이게 해 원인 찾기를 어렵게 했다.
## 이유 (0.1.4에 더함)
실행기는 실패한 단계 뒤에서 멈췄지만, 한 단계(한 Playwright 스크립트) 안에서는 실패 뒤에도 쓰기가 이어졌다: rc.2 테스트 서버 확인에서 "기존 시험 항목 없음" 검사가 FAIL인데 같은 스크립트가 `POST /api/keys`로 키를 만들었다(rc2-check-run2-stale-data.log). rc.3 확인에서는 같은 클릭 실패가 세 번(run3~run5) 반복됐고 그 사이 원인 조사 기록이 없었다.
## 적용
모든 검사 실행과 보완 실행. 한 단계 안의 스크립트(Playwright, node)도 실패한 확인 뒤에는 쓰기를 하지 않고 끝낸다(`ok()`가 실패하면 즉시 종료). 같은 실패가 두 번이면 다음 실행 전에 원인을 기록한다. 띄운 서버·컨테이너는 실패해도 정리하되, 정리 성공 여부도 로그에 남긴다(포트가 닫혔는지 등).
## 바뀌면
공용 검사 스크립트가 생기면 이 동작을 그 스크립트가 맡는다.
