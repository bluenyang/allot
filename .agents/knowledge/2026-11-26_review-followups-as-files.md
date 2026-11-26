---
id: 2026-11-26_review-followups-as-files
kind: decision
status: active
supersedes: null
topics: [review, delegation, records]
decisions: [review-followups-as-files]
symptoms: ["audit: a review request is not kept as a file", "a brief reconstructed from the conversation after the audit"]
applies_to: all
source: retro 0.1.9 (first audit rc.3 F-3: review 2 sent as messages only; first audit rc.1 F-4: briefs 2–6 reconstructed — .agents/audit/0.1.9.md; 0.1.2 audit)
approved: { by: user, at: 2026-11-26, words: "후속 리뷰 요청도 파일로 (추천)" }
---
## 결정
리뷰어(또는 다른 역할)에게 보내는 요청은 첫 요청이든 후속 확인이든 먼저 파일로 쓰고, 그 파일을 읽으라고 보낸다: `.loctx/reports/<version>/<review dir>/<n>-brief.md`, 후속은 `<n>-followup-<m>.md`. 메시지(SendMessage)에는 파일 경로와 한두 줄만.
## 이유
0.1.9에서 리뷰 2(rc.3)를 메시지로만 맡겨 brief 파일이 없었고(rc.3 F-3), rc.1에서도 리뷰 2~6 요청을 나중에 대화에서 옮겨 '재구성'으로 남겼다(F-4). 감사는 대화를 받지 않으므로 파일이 없으면 무엇을 맡겼는지 확인할 수 없다(AGENTS.md: 브리프와 보고를 남김).
## 적용
review·test·audit 위임 전부. 같은 서브에이전트를 이어 쓸 때도.
## 바뀌면
위임 도구가 보낸 메시지를 스스로 파일로 남기게 되면 다시 본다.
