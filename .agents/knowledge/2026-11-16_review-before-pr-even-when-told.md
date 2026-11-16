---
id: 2026-11-16_review-before-pr-even-when-told
kind: decision
status: active
supersedes: 2026-11-12_review-after-review-commits
topics: [review, merge]
decisions: [late-commits-get-reviewed]
symptoms: ["audit: commits after the last review have no review record", "a PR opened right after the user said 'push PR', with unreviewed commits"]
applies_to: all
source: retro 0.1.1 (audits 0.1.0-stable, 0.1.1 A-4); retro 0.1.2 (supplement B-6)
approved: { by: user, at: 2026-11-16, words: "1~5, 8, 9 승격 허가 함." }
---
## 결정
마지막 리뷰 뒤에 브랜치에 들어온 커밋(테스트 수정, 리뷰 지적 수정, 문서·설정 변경 포함)은 PR을 만들거나 머지하기 전에 리뷰를 받는다. 사용자가 "푸시·PR"을 지시해도 이 리뷰를 먼저 한다 — 그 지시는 원격 작업 허락이지 리뷰 생략이 아니다. 생략은 사용자가 그렇게 말했을 때만, intent의 `waivers:`에 그 말로 적는다. 테스트·문서만 바뀐 커밋은 범위를 좁힌 짧은 리뷰로 충분하다.
## 이유
0.1.1에서 리뷰 없는 커밋이 머지됐고(A-4), 0.1.2에서는 "일단 푸시 PR" 지시에 주말 색 커밋이 리뷰 전인 채 PR이 열렸다(B-6). 뒤 리뷰(14·15)는 그 커밋들에서 실제 결함을 찾았다.
## 적용
PR 직전에 `git log <마지막 리뷰 대상 rev>..HEAD`가 비어 있는지 본다. 비어 있지 않으면 그 커밋만 리뷰에 보낸다. 사용자에게는 "리뷰를 먼저 받고 PR을 엽니다"라고 한 줄로 알린다.
## 바뀌면
리뷰가 CI(자동 리뷰)로 옮겨 가면 그 결과가 같은 역할을 한다.
