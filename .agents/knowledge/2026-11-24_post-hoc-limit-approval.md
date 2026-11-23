---
id: 2026-11-24_post-hoc-limit-approval
kind: accepted-finding
status: active
supersedes: null
topics: [spec, approval, audit]
decisions: [post-hoc-limit-approval-accepted]
symptoms: ["audit: a limit or refusal was implemented before the user was asked", "audit: an adjustment line's 예전 입력 거부·새 제한 field was written after its commit"]
applies_to: all
source: retro 0.1.7 (accepted six times — see below)
approved: { by: user, at: 2026-11-24, words: "사후 승인 accepted-finding" }
---
## 결정
무엇을 수용하나: 새 제한·새 거부(또는 그 판별 필드 `예전 입력 거부·새 제한`)가 구현 커밋보다 늦게 물어지거나 적힌 것. 감사는 아래 조건을 모두 갖춘 경우 이것을 위반이 아니라 **알려진 수용**으로 적는다.
- 사용자가 그 동작을 **그 작업의 머지 전에** 자기 말로 받았고, spec `approvals:`에 그 말이 인용됐다.
- 기록이 사후임을 밝힌다(A-n·approvals note에 "구현 커밋 <sha> 뒤, 머지 전 — 사후 승인"). 앞서 받은 것처럼 적지 않는다.
- 판별 필드가 머지 전에 채워져 있다.
## 이유
같은 지적을 여섯 번 받아들였다: 0.1.3 F-1("F-1. 수용함", `.agents/audit/0.1.3.md`), 0.1.5 F-1(회고 "네가 제안한대로 수용."), 0.1.6 F-3(사후 승인, `.agents/audit/0.1.6.md`), 0.1.7 rc.1 F-2·rc.2 F-2("이번 건 수용, 회고에서 (Recommended)"), rc.3 F-1("기록 정정 + 이번 건 수용 (Recommended)")·F-2("이번 건 수용, 회고에서 (Recommended)") — `.agents/audit/0.1.7.md`. 매번 사용자는 최종 동작을 받았고 고친 것은 기록뿐이었다.
## 적용
감사(첫·둘째). 수용이 끝나는 곳 — 이것은 위반이다: 사용자 말이 머지 뒤에야 있거나 없는 것, 사후임을 숨긴 기록(사전 승인으로 적은 것), 판별 필드가 머지 때도 비어 있는 것, 사용자가 받지 않은 제한이 남은 것. 규칙 자체(`2026-11-16_limits-are-spec-changes.md`: 커밋 전에 묻는다)는 그대로다 — 이 항목은 감사의 판정만 바꾼다.
## 바뀌면
커밋 전에 판별을 강제하는 장치(하네스 후보로 회고 0.1.7에 넘김)가 생기면 다시 본다.
