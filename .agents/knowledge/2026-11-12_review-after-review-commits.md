---
id: 2026-11-12_review-after-review-commits
kind: decision
status: active
supersedes: null
topics: [review, merge]
decisions: [late-commits-get-reviewed]
symptoms: ["audit: commits after the last review have no review record"]
applies_to: all
source: retro 0.1.1 (audits 0.1.0-stable, 0.1.1 A-4)
approved: { by: user, at: 2026-11-12, words: "AGENTS.md는 너무 쉽게 수정하지마. 1, 2, 4, 5 인용한다." }
---
## 결정
마지막 리뷰 뒤에 브랜치에 들어온 커밋(테스트 수정, 리뷰 지적 수정, 문서·설정 변경 포함)은 PR을 만들거나 머지하기 전에 리뷰를 받는다. 테스트·문서만 바뀐 커밋은 범위를 좁힌 짧은 리뷰로 충분하다.
## 이유
0.1.1에서 3차 리뷰 뒤의 테스트 커밋과 리뷰 4 지적 수정이 리뷰 없이 머지됐고, 사후 리뷰에서 테스트 약점 3건이 나왔다.
## 적용
PR 직전에 `git log <마지막 리뷰 대상 rev>..HEAD`가 비어 있는지 본다. 비어 있지 않으면 그 커밋만 리뷰에 보낸다.
## 바뀌면
리뷰가 CI(자동 리뷰)로 옮겨 가면 그 결과가 같은 역할을 한다.
