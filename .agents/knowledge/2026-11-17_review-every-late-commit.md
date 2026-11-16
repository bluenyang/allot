---
id: 2026-11-17_review-every-late-commit
kind: decision
status: active
supersedes: 2026-11-16_review-before-pr-even-when-told
topics: [review, merge, records]
decisions: [late-commits-get-reviewed]
symptoms: ["audit: commits after the last review have no review record", "a PR opened right after the user said 'push PR', with unreviewed commits", "audit: a record or release-notes commit 'not reviewed: one line'"]
applies_to: all
source: retro 0.1.1 (audits 0.1.0-stable, 0.1.1 A-4); retro 0.1.2 (supplement B-6); retro 0.1.3 (second audit R-2: 9e1f6a7, 15ef6d1, 2721b08, 4feabc8)
approved: { by: user, at: 2026-11-17, words: "k2. 수용" }
---
## 결정
마지막 리뷰 뒤에 브랜치에 들어온 커밋은 머지 전에 리뷰를 받는다 — 테스트 수정, 리뷰 지적 수정, 문서·설정 변경, 그리고 기록 커밋(spec의 조정 기록 줄, 감사의 사용자 처리, 릴리스 노트)도. "한 줄이라서", "문서만이라서", "첫 감사가 없는 PR이라서"는 생략 사유가 아니다(첫 감사 면제와 리뷰는 별개). 기록·문서 커밋은 범위를 좁힌 짧은 리뷰로 충분하다. 사용자가 "푸시·PR"이나 "머지"를 지시해도 이 리뷰를 먼저 한다. 생략은 사용자가 그렇게 말했을 때만, intent의 `waivers:`에 그 말로 적는다.
## 이유
세 버전 연속이다. 0.1.1에서 리뷰 없는 커밋이 머지됐고(A-4), 0.1.2에서는 "일단 푸시 PR" 지시에 리뷰 전 커밋으로 PR이 열렸다(B-6). 0.1.3에서는 코드 커밋은 모두 리뷰했지만 spec 한 줄(9e1f6a7), 첫 감사의 사용자 처리(15ef6d1), 릴리스 노트(2721b08, 4feabc8)가 리뷰 없이 머지됐다(2차 감사 R-2).
## 적용
PR을 열기 전과 머지 직전에 `git log <마지막 리뷰 대상 rev>..HEAD`가 비어 있는지 본다. 비어 있지 않으면 그 커밋만 리뷰에 보낸다. 릴리스 노트 PR도 머지 전에 한 번. 사용자에게는 "리뷰를 먼저 받고 PR을 엽니다/머지합니다"라고 한 줄로 알린다.
## 바뀌면
리뷰가 CI(자동 리뷰)로 옮겨 가면 그 결과가 같은 역할을 한다.
