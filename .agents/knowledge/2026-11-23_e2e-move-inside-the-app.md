---
id: 2026-11-23_e2e-move-inside-the-app
kind: decision
status: active
supersedes: null
topics: [e2e, router, test]
decisions: [e2e-goto-reloads-move-inside-app]
symptoms: ["a test about KeepAlive, a held request or in-memory state passes after the move to history addresses without proving anything", "a test that holds /api/state hangs on the first load"]
applies_to: all
source: retro 0.1.6 (reviews 2 and 3, spec 012 A-8, A-11, A-12, A-15)
approved: { by: user, at: 2026-11-23, words: "전부 수용 (Recommended)" }
---
## 결정
history 주소에서 Playwright `page.goto('/x')`는 페이지를 새로 불러온다(해시 주소의 `goto('/#x')`는 같은 문서 안의 이동이었다). 열린 페이지가 다음에 하는 일 — KeepAlive로 남는 상태, 붙잡아 둔 요청(`page.route`), 메모리의 값, "열린 뒤의 언어 전환" — 을 보는 시험은 `goto`로 옮기지 않고 앱 안에서 이동한다: `tests/e2e/helpers.ts`의 `menu(page, 이름)`(사이드바 링크, 이름 앞부분 일치), 탭 클릭, 또는 창이 열려 사이드바를 못 누를 때 같은 문서 해시 대입(`location.hash = '#home'`, 라우터가 새 주소로 바꿈).

## 이유
0.1.6에서 주소를 바꾸며 이 차이로 시험 네 개의 뜻이 바뀌었다: zz-account-switch(자기 `/api/state` 붙잡기가 첫 로딩을 잡아 멈춤), api-keys 늦은 키 응답(KeepAlive 없이 지나가 아무것도 증명 못 함), router.spec 뒤로/앞으로(문서를 넘나들어 라우터의 popstate·scrollBehavior를 거치지 않음), i18n 언어 전환(열린 페이지가 아니라 새 페이지를 봄). 리뷰 2·3에서 차례로 드러났고 처음 바꿀 때는 아무도 못 봤다.

## 적용
E2E를 쓰거나 주소를 바꿀 때. 시험 하나에 `page.goto`가 둘 이상이고 그 사이에 살아 있어야 할 것이 있으면 이 항목을 따른다. 시험의 시작점(첫 `goto`)과 서버에 저장된 값만 보는 시험은 해당하지 않는다.

## 바뀌면
라우터를 바꾸거나 `menu()`의 선택자가 바뀌면 이 항목의 도우미 이름을 고친다.
