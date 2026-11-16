---
id: 2026-11-16_login-rate-limit-in-tests
kind: failure
status: active
supersedes: 2026-11-12_login-rate-limit-in-tests
topics: [test, auth, rate-limit, e2e]
decisions: []
symptoms: ["sign-in → 429 in an API test", "FAIL sign-in A 200, B 429", "E2E: a second user's login waits 15 s and fails ('로그인 시도가 너무 많아요')", "E2E global setup times out at the login"]
applies_to: all
source: 0.1.1 test (V-5 rerun); retro 0.1.2 (E2E runs 2026-11-15/16: V-6 b/c, V-14 a/b, auth tests, setup)
approved: { by: user, at: 2026-11-16, words: "1~5, 8, 9 승격 허가 함." }
---
## 결정
로그인 시도 제한은 분당 5회(`/sign-in/email`)다. 같은 계정으로 API 검사를 연달아 돌릴 때는 그 사이에 60초를 둔다. 전체 E2E는 직전 1분 동안 로그인이 없을 때(70초 쉰 뒤) 시작하고, E2E나 로그인하는 검사를 동시에 두 개 돌리지 않는다. 429나 로그인 대기 초과로 끝난 실행은 결과가 아니라 "실행 안 됨"으로 기록하고, 기다린 뒤 다시 돌린다.
## 이유
0.1.1 V-5 재실행이 로그인 단계에서 429로 끝났다. 0.1.2에서는 E2E가 여러 번 같은 이유로 흔들렸다: 연달아 돌린 실행의 V-6 b/c(두 번째 사용자 로그인), 단일 테스트를 겹쳐 돌린 실행의 V-14 a/b, auth 테스트, global setup. 단독으로 다시 돌리면 매번 통과했다. 검사 자체의 실패와 섞이면 판정을 흐린다.
## 적용
한 번의 검사 안에서는 로그인을 한 번만 하고 세션을 재사용한다(E2E의 global-setup처럼). 연속 실행 사이에는 `sleep 60`, 전체 E2E 앞에는 `sleep 70`. 수정 확인용 단일 테스트를 몇 번 돌린 뒤의 전체 실행도 같다.
## 바뀌면
제한 값이 바뀌거나 개발 스택 전용으로 완화되면(로드맵 로컬 후보) 이 항목의 수치를 고친다.
