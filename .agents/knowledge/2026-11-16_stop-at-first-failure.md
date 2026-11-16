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
---
## 결정
준비든 검사든 한 단계가 실패하면 다음 단계로 가지 않는다. 멈추고, 원인을 찾고, 원인을 기록한 뒤 처음부터(또는 원인이 닿지 않는 지점부터) 다시 돌린다. 실행 스크립트는 첫 실패에서 멈추게 쓴다(`ok() { …; [ "$1" = 0 ] || exit 1; }`).
## 이유
세 번 반복됐다: 0.1.2 V-10 password-guard(준비 실패 뒤 검사 계속), 보충 감사 B-5(같은 일과 멈추지 않는 `fresh.sh`), rc.1 테스트 서버(create 실패 뒤 restart·verify·cleanup까지 진행 — 원인은 시드 없는 계정이었다). 실패 위에서 이어 간 단계는 결과가 아니고, 테스트 데이터를 꼬이게 해 원인 찾기를 어렵게 했다.
## 적용
모든 검사 실행과 보완 실행. 띄운 서버·컨테이너는 실패해도 정리하되, 정리 성공 여부도 로그에 남긴다(포트가 닫혔는지 등).
## 바뀌면
공용 검사 스크립트가 생기면 이 동작을 그 스크립트가 맡는다.
