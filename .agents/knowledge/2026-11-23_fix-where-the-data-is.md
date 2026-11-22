---
id: 2026-11-23_fix-where-the-data-is
kind: failure
status: active
supersedes: null
topics: [router, review, design]
decisions: [fix-at-the-layer-that-has-the-data]
symptoms: ["each review round finds a new edge case of the same fix", "a guard or hook sees data another layer has already decoded, rebuilt or removed"]
applies_to: all
source: retro 0.1.6 (reviews 3–5 F-1, F-5, F-6, F-7, F-8; spec 012 A-13..A-19; user "일부 포기")
approved: { by: user, at: 2026-11-23, words: "전부 수용 (Recommended)" }
---
## 결정
원래 입력이 필요하면, 그 입력을 다른 층이 손대기 전에 그것을 가진 자리에서 읽는다. vue-router의 `beforeEach`는 원래 주소를 받지 못한다: 해시는 이미 디코딩됐고, 경로 리다이렉트는 그것을 다시 만들고, 히스토리 초기화와 popstate는 끝의 `#`를 `replaceState`로 지운다. 예전 해시처럼 원래 모양이 중요한 입력은 라우터 시작 전(`main.ts`, `window.location.href`)과 `hashchange` 이벤트(`event.newURL`)에서 읽는다.

## 이유
0.1.6에서 예전 해시 넘기기를 가드 안에서 고치자 리뷰마다 새 구멍이 났다: 이중 디코딩(F-1) → push 때 현재 주소를 잘못 읽음(F-5) → 맨 `#`(F-6) → 리다이렉트가 해시를 재구성(F-7) → 초기화·popstate가 `#`를 지움(F-8). "같은 단위 두 번 실패면 멈춤"은 다섯 번째에야 적용됐고, 사용자는 드문 두 형태를 포기했다("일부 포기").

## 적용
리뷰 지적을 고친 자리에서 같은 종류의 지적이 다시 나오면(두 번째), 다음 수정 전에 "이 층이 원래 데이터를 갖고 있나"를 먼저 따진다. 갖고 있지 않으면 고치는 자리를 옮기는 안을 사용자에게 낸다.

## 바뀌면
라우터 라이브러리가 바뀌거나 예전 해시 넘기기를 없애면 다시 본다.
