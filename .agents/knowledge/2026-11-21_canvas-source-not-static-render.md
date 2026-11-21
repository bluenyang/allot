---
id: 2026-11-21_canvas-source-not-static-render
kind: failure
status: active
supersedes: null
topics: [design, test]
decisions: [canvas-source-not-static-render]
symptoms: ["a canvas comparison finds a difference that only exists in a full-page screenshot", "the canvas 'shows' a sidebar or bar that ends mid-page", "a fix moves the app away from the canvas source"]
applies_to: all
source: retro 0.1.4 (spec 010 A-26, A-33, A-34; review a33-review; user 2026-11-20 "계정 정보랑 설정은 하단에 붙는거 아니야?")
approved: { by: user, at: 2026-11-21, words: "D10. 인용" }
---
## 결정
캔버스와 앱을 대조할 때 기준은 캔버스 원본(`*.dc.html`의 CSS와 구조)이다. 정적 렌더 스크린샷은 길잡이로만 쓴다. 둘이 다르면 원본이 이긴다. sticky·fixed 요소, 창 높이 기준 배치, 한 장에 겹쳐 그려진 탭·상태, 풀리지 않은 템플릿 값 때문에 생긴 차이는 차이가 아니다.
## 이유
0.1.4 V-11에서 캔버스를 정적으로 그려 비교했고, 8건을 잘못 읽어 앱을 캔버스와 다르게 "고쳤다": 사이드바 아래 묶음을 AI 묶음 밑으로 올림(U-20 — 정적 렌더의 사이드바가 내용 높이에서 끝나서), 달력 카드 높이·대기 중 달 상자·휴대폰 로그인·확인 대기 테두리·구간 머리·설정 저장 줄(U-1·2·3·7·13·14), 카드 메모 정렬(R-5). 사용자가 사이드바를 보고 지적한 뒤 원본 CSS로 다시 대조해 되돌렸다(A-33, A-34).
## 적용
V-11 같은 캔버스 대조, 디자인 리뷰, 대조를 맡기는 브리프. 휴대폰 아트보드는 루트의 템플릿 class(`{{rootAll}}`, `{{rootCls}}`)를 `is-phone`으로 바꿔 그린다.
## 바뀌면
캔버스를 실제 런타임으로 렌더할 수 있게 되면 그 렌더를 기준으로 삼는다.
