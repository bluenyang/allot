---
id: 2026-11-26_roadmap-with-scope
kind: decision
status: active
supersedes: null
topics: [roadmap, intent, audit]
decisions: [roadmap-with-scope]
symptoms: ["audit: the settled scope is not in docs/ROADMAP.md", "an rc added to a version that the public roadmap does not mention"]
applies_to: all
source: retro 0.1.9 (first audit rc.2 F-1, rc.3 F-1 — .agents/audit/0.1.9.md; earlier roadmap findings in .agents/audit/0.1.0.md … 0.1.6.md)
approved: { by: user, at: 2026-11-26, words: "로드맵 규칙 (추천)" }
---
## 결정
버전 안에서 범위를 넓히는 intent(rc를 더함, 항목을 더함)가 승인되면, 그 브랜치의 다음 커밋에서 `docs/ROADMAP.md`의 그 버전 줄에 넓힌 범위와 사용자 말을 적는다(공개 저장소라 실제 이름·금액 없이). 상태 줄("… in work")도 같이.
## 이유
0.1.9에서 rc.2와 rc.3 두 번 모두 1차 감사가 같은 지적(F-1)을 했다: 로컬 로드맵과 intent에는 확정 기록이 있는데 공개 로드맵에는 없었다. 그 전 버전들(0.1.0~0.1.6)의 감사에도 로드맵 반영 지적이 되풀이됐다. 감사 뒤 보완하면 리뷰·마크를 한 번 더 돌려야 한다.
## 적용
intent 승인 기록 커밋 바로 다음. intent 스킬의 승인 뒤 단계로, PM이 한다. 새 버전을 시작하는 intent는 원래대로 roadmap 단계에서.
## 바뀌면
intent 스킬이 이 단계를 품으면(reins 후보) 이 항목은 그쪽을 가리키게 바꾼다.
