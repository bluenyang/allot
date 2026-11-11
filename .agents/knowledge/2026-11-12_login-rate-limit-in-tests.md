---
id: 2026-11-12_login-rate-limit-in-tests
kind: failure
status: active
supersedes: null
topics: [test, auth, rate-limit]
decisions: []
symptoms: ["sign-in → 429 in an API test", "FAIL sign-in A 200, B 429"]
applies_to: all
source: 0.1.1 test (V-5 rerun)
approved: { by: user, at: 2026-11-12, words: "AGENTS.md는 너무 쉽게 수정하지마. 1, 2, 4, 5 인용한다." }
---
## 결정
로그인 시도 제한은 분당 5회(`/sign-in/email`)다. 같은 계정으로 API 검사를 연달아 돌릴 때는 그 사이에 60초를 둔다. 429로 끝난 실행은 결과가 아니라 "실행 안 됨"으로 기록하고, 기다린 뒤 다시 돌린다.
## 이유
0.1.1 V-5 재실행 중 두 번째 실행이 로그인 단계에서 429로 끝났다. 검사 자체의 실패와 섞이면 판정을 흐린다.
## 적용
한 번의 검사 안에서는 로그인을 한 번만 하고 세션을 재사용한다(E2E의 global-setup처럼). 연속 실행 사이에는 `sleep 60`.
## 바뀌면
제한 값이 바뀌면 이 항목의 수치를 고친다.
