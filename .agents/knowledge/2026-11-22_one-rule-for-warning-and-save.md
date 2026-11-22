---
id: 2026-11-22_one-rule-for-warning-and-save
kind: failure
status: active
supersedes: null
topics: [code, review, ui]
decisions: [one-rule-for-warning-and-save]
symptoms: ["a confirm or preview says one thing and the save does another", "review after review finds a new case of the same rule", "the warning counts rounds/rows with its own exceptions"]
applies_to: all
source: retro 0.1.5 (spec 011 A-22, A-38, A-39, A-40, A-41; reviews r14–r18 in .loctx/history/0.1.5.md)
approved: { by: user, at: 2026-11-22, words: "네가 제안한대로 수용." }
---
## 결정
화면이 사용자에게 "무엇이 바뀌는지"를 말하는 경고·확인 창·미리보기와 실제 저장은 같은 순수 함수의 결과 하나만 쓴다. 남는 것과 사라지는 것을 정하는 규칙은 그 함수 안에만 두고, 화면 코드에 방식별 예외를 따로 두지 않는다. 경고가 결과를 정확히 약속할 수 없으면 지금 있는 상태(예: 냄 n개·고침 n개)만 말하고 결과는 그 함수가 만든 목록으로 보여 준다.
## 이유
0.1.5 지출 편집기의 "다시 계산" 규칙에서 리뷰 지적이 네 번 연달아 나왔다(lump 취소 + 냄, 할부 → 일시불, 6회 → 3회, 일시불로 합칠 때의 개수). 원인은 경고(`losing`)와 저장(`keepPaid`)을 서로 다른 곳에서 각자의 예외로 계산한 것이었고, 한쪽을 고칠 때마다 다른 쪽과 어긋났다. 순수 함수 `replan()` 하나로 합치고(A-40) 경고를 현재 표시만 세게 바꾼 뒤(A-41) 지적이 멈췄다.
## 적용
미리보기·확인 창·경고가 저장 결과를 설명하는 모든 화면과 MCP 제안 미리보기. 같은 규칙에서 지적이 두 번 나오면 고치기 전에 이 구조인지 본다(AGENTS.md "two failures → find the cause").
## 바뀌면
저장 쪽 규칙이 서버로 옮겨 가면 서버의 같은 함수를 미리보기도 쓴다(0.1.4 제안 미리보기처럼 적용해 보고 롤백).
