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
---
## 결정
커밋은 원인별로 나눈다. 리뷰 한 회차가 서로 무관한 결함 N개를 찾으면 커밋도 N개다. 한 작업 단위 안에서도, 다른 단위가 일으킨 문제의 수정(예: 넓어진 사이드바 때문에 꺾인 헤더)은 따로 커밋한다.
## 이유
네 번째 반복이다. 0.1.2에서 리뷰 회차 단위로 묶은 커밋(61f677a, 5d69816, 27ceb06, ed96a58 등)은 하나만 되돌릴 수 없었다. rc.2·rc.3 작업에서 원인별로 나눠 커밋하니(8271ca8 / 16f643b / 1737836, aaeb641 / 1e69271, b96a0a6 / a3fb421) 각각 되돌릴 수 있었다.
## 이유 (0.1.4에 더함)
0.1.4에서도 되풀이됐다: 리뷰 회차 단위로 묶은 0598f9f·60324e5·4ed7f2c(010 첫 감사 F-3), c338e28·18ffa22(보충 감사 F-1), PM이 감사 보완을 문서와 시험 한 커밋에 묶었다가 push 전에 나눈 일(497b2bb·22792fc). 같은 W-n이나 같은 A-n, 같은 리뷰 회차라는 것은 묶을 이유가 아니다.
## 적용
implement·review 수정 커밋. 작업 트리에 두 원인이 섞여 있으면 파일을 원인별 상태로 나눠 차례로 커밋한다(대화형 git 없이).
## 바뀌면
—
