---
id: 2026-11-16_limits-are-spec-changes
kind: decision
status: active
supersedes: null
topics: [spec, review, approval]
decisions: [limits-need-approval]
symptoms: ["audit: support narrowed without approval", "a review fix adds a refusal, a range limit or a cut-off date"]
applies_to: all
source: retro 0.1.2 (audit 0.1.2 A-3, supplement B-2)
approved: { by: user, at: 2026-11-16, words: "1~5, 8, 9 승격 허가 함." }
---
## 결정
리뷰 수정이나 구현 중에 생기는 제한 — 새로 거부하는 입력, 범위·횟수 한도, 날짜 하한 — 은 spec이 정한 지원 범위를 줄이므로 spec 변경이다. 커밋 전에 사용자에게 무엇을 왜 줄이는지 묻고, 답을 spec 승인에 적는다. 답을 기다리는 동안은 "열린 질문"으로 spec에 적어 둔다.
## 이유
두 번 반복됐다: 0.1.2 토큰 갱신 폐기(A-3), 공휴일 규칙의 INTERVAL·SKIP 거부, 31일 한도, 1990년 하한(B-2). 둘 다 리뷰 지적을 고치다 생겼고, spec에는 나중에 정정 메모로만 들어가 사후 수용이 됐다.
## 적용
review·implement 단계. 안전을 위한 한도라도 사용자가 볼 수 있는 동작을 바꾸면 해당한다. 사용자에게 안 보이는 내부 상수(재시도 횟수 등)는 해당하지 않는다.
## 바뀌면
reins 0.3의 adjustment(A-n) 기록과 함께 쓴다: 작업 단위 범위를 바꾸지 않는 작은 조정은 A-n으로 기록하고, 지원 범위를 줄이는 것은 이 항목대로 묻는다.
