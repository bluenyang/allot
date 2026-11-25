---
id: 2026-11-16_commit-per-cause
kind: decision
status: active
supersedes: null
topics: [commit, review]
decisions: [commit-per-cause]
symptoms: ["audit: a commit mixes unrelated work", "one review round's fixes in one commit"]
applies_to: all
source: retro 0.1.2 (audit 0.1.2 A-1, supplement B-1; earlier: 0.1.1 retro "커밋 혼합 3회째")
approved: { by: user, at: 2026-11-16, words: "1~5, 8, 9 승격 허가 함." }
updated: { by: user, at: 2026-11-21, words: "D11. 인용", source: "retro 0.1.4 (audit 0.1.4 intent 010 F-3, supplementary F-1)" }
updated_2: { by: user, at: 2026-11-22, words: "네가 제안한대로 수용.", source: "retro 0.1.5 (first audit F-2: 478090c, a5f656d, 7344b00; second audit: 6d7d4dc after the acceptance)" }
updated_3: { by: user, at: 2026-11-25, words: "고침은 하나씩 커밋", source: "retro 0.1.8 (first audit F-3: bf38a5f, df3ac8a, 2bc9a43, 1de031c; 18 commits with worktree: dirty gates, .loctx/history/0.1.8.md; 0.1.7: 14)" }
---
## 결정
커밋은 원인별로 나눈다. 리뷰 한 회차가 서로 무관한 결함 N개를 찾으면 커밋도 N개다. 한 작업 단위 안에서도, 다른 단위가 일으킨 문제의 수정(예: 넓어진 사이드바 때문에 꺾인 헤더)은 따로 커밋한다.
## 이유
네 번째 반복이다. 0.1.2에서 리뷰 회차 단위로 묶은 커밋(61f677a, 5d69816, 27ceb06, ed96a58 등)은 하나만 되돌릴 수 없었다. rc.2·rc.3 작업에서 원인별로 나눠 커밋하니(8271ca8 / 16f643b / 1737836, aaeb641 / 1e69271, b96a0a6 / a3fb421) 각각 되돌릴 수 있었다.
## 이유 (0.1.4에 더함)
0.1.4에서도 되풀이됐다: 리뷰 회차 단위로 묶은 0598f9f·60324e5·4ed7f2c(010 첫 감사 F-3), c338e28·18ffa22(보충 감사 F-1), PM이 감사 보완을 문서와 시험 한 커밋에 묶었다가 push 전에 나눈 일(497b2bb·22792fc). 같은 W-n이나 같은 A-n, 같은 리뷰 회차라는 것은 묶을 이유가 아니다.
## 적용
위임 브리프에 "지적 하나(원인 하나)에 커밋 하나"를 적는다(AGENTS.md). 한 리뷰 회차에 지적이 둘이면 커밋도 둘이다 — 0.1.5에서 리뷰 지적 두 개를 한 커밋으로 낸 일이 첫 감사 뒤에도 다시 나왔다. implement·review 수정 커밋. 작업 트리에 두 원인이 섞여 있으면 파일을 원인별 상태로 나눠 차례로 커밋한다(대화형 git 없이).
## 적용 (0.1.8에 더함)
지적이 여럿이면 **고침 하나 → 그 커밋 → 다음 고침** 순서로 한다. 여러 고침을 한꺼번에 해 두고 파일을 골라 하나씩 커밋하면, 커밋할 때 다른 고침이 작업 트리에 남아 게이트가 `worktree: dirty`로 돌고(그 커밋만의 검사가 아님 — 감사 전에 `stage: audit`로 다시 돌려야 함) 같은 파일에 걸친 고침은 한 커밋에 섞인다. 0.1.8에서 18개 커밋의 게이트를 다시 돌렸고 섞인 커밋 넷이 첫 감사 F-3이 됐다(0.1.7에서는 14개).
## 바뀌면
pre-commit이 스테이지 안 된 변경을 거부하거나 커밋 트리로만 게이트를 돌리게 되면(reins 후보, 회고 0.1.8) 순서는 장치가 지킨다.
