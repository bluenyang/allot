---
id: 2026-11-17_open-the-app-on-its-auth-url
kind: failure
status: active
supersedes: null
topics: [test, auth, origin, e2e, release]
decisions: [open-the-app-on-its-auth-url]
symptoms: ["E2E: the OIDC tests fail with state_mismatch / '로그인이 중간에 끊겼어요'", "sign-in → 403 INVALID_ORIGIN, the screen says '로그인하지 못했어요. 잠시 뒤에 다시 해 주세요.'", "works from one LAN address, not from another"]
applies_to: all
source: 0.1.3 review fix (Dex E2E, master failed the same way); 0.1.3 test server :15174 (user's sign-in refused)
approved: { by: user, at: 2026-11-17, words: "k1. 수용" }
---
## 결정
앱은 `BETTER_AUTH_URL`의 호스트로 연다. E2E와 API 검사의 `BASE`는 그 호스트와 같게 둔다. 사람이 브라우저로 여는 주소(기기에 LAN 주소가 여럿이면 그 모두, 호스트 이름, localhost)는 하나도 빠짐없이 `TRUSTED_ORIGINS`에 넣는다. 실제 주소는 커밋하는 파일에 적지 않는다.
## 이유
0.1.3에서 두 번 같은 원인이었다. 개발 스택의 E2E가 다른 LAN 주소로 열려 OIDC state 쿠키가 콜백 호스트로 가지 않았고(Dex 테스트 3개, master에서도 실패), 테스트 서버는 사용자가 연 주소가 `TRUSTED_ORIGINS`에 없어 로그인이 403 INVALID_ORIGIN으로 거절됐다. 화면 문구는 일부러 원인을 말하지 않는다(사용자 2026-11-17: "less-info가 맞는거 같음") — 그래서 이 확인을 먼저 한다.
## 적용
E2E·API 검사를 시작하기 전, 테스트 서버를 띄울 때. 로그인이 원인 없이 실패하면 `Origin` 헤더를 붙인 로그인 요청을 curl로 보내 403 INVALID_ORIGIN인지 먼저 본다.
## 바뀌면
개발 스택과 테스트 서버의 주소 설정이 한 곳에서 정해지면 그 설정이 이 확인을 대신한다.
