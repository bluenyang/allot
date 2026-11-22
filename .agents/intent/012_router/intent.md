---
id: "012"
slug: router
version: 0.1.6
status: draft
origin: user
approvals: []
waivers: []
supersedes: null
---
## 문제
`docs/ROADMAP.md` 0.1.6 줄: 라우팅 — 직접 만든 해시 주소 대신 vue-router의 history 주소, 예전 `#…` 주소와 로그인 돌아오기 주소는 그대로 동작, 서버는 API가 아닌 모든 경로에 앱을 돌려줌.

사용자 말:
> 지금보니까, 왜 주소가 다 해시주소임? vue 쓰는거 아니야? (2026-11-21)
> 그렇게 하자 그럼. a방식으로. 진행 (2026-11-21 — 0.1.5에 넣지 않고 그다음 작은 패치로)
> 진행 준비 / 0.1.6으로, 뒤를 하나씩 밀기 (Recommended) (2026-11-22)

지금 앱은 vue-router 없이 `src/App.vue`가 `location.hash`를 직접 읽어 화면을 고른다(`#home`, `#spend/general`, `#settings/ai` …). 이렇게 된 이유는 기록에 없다. 주소에 `#`가 붙고, 주소 처리 코드가 여러 파일(`App.vue`, `Root.vue`, `Settings.vue`, `Spending.vue`, `Payroll.vue`, `AddRecordModal.vue`)에 흩어져 있다.

## 바라는 결과
PM 해석:
1. **주소**: `https://<host>/spend/general`처럼 `#` 없는 주소. 화면과 탭은 지금과 1:1로 대응한다(`/home`, `/pay`, `/spend/general|inst|subs`, `/events`, `/pending`, `/history`, `/settings/general|theme|ai|security`, `/admin`, …). 첫 화면 `/`은 지금처럼 현황이다.
2. **예전 주소 유지**:
   - 북마크나 링크로 들어온 `#home`, `#subs`, `#subs?add`, `#spend/subs?add`, `#settings/ai`, `#account`는 새 주소로 바뀌어 같은 화면과 동작으로 간다.
   - 외부 로그인(OIDC·GitHub·Google) 연결 뒤 돌아오는 `/#account`도 계속 동작한다. 새 연결은 새 주소로 돌아오게 한다.
3. **동작은 그대로**: 화면, 입력, 저장, 페이지 상태 유지(KeepAlive), 탭을 옮길 때 편집기 닫기(0.1.5 A-13), 뒤로/앞으로, 화면 맨 위로 스크롤, 지연 로드와 불러오기 실패 안내(A-25), 휴대폰 아래 막대와 더보기 시트가 지금과 같다.
4. **서버**: `/api/*`, `/auth/*`, `/healthz`, MCP 경로는 지금처럼 응답한다. 그 밖의 경로는 앱(`index.html`)을 돌려준다. 이 처리는 이미 있으니 확인만 한다. 개발 서버(Vite)도 같게 한다.
5. **버전 표기 밀기**: 화면 문구와 README의 "0.1.10에서 지원할 예정"(MCP OAuth)을 0.1.11로, 코드 주석의 "0.1.6 adds buffer"를 0.1.7로 고친다. 출시된 CHANGELOG 항목은 그대로 둔다.

## 계획
1. intent 승인 → spec 012. spec에서 정할 것:
   - 경로 표
   - 예전 해시를 새 주소로 넘기는 규칙(처음 열 때와 해시가 바뀔 때)
   - KeepAlive와 vue-router의 조합(지금 상태 유지 방식과 같게)
   - `?add`처럼 화면을 여는 질의
   - 외부 로그인 돌아오기 주소
   - W-n과 V-n
2. 구현 순서(안):
   - vue-router 추가(`pnpm add -E`, 하루 지난 버전)
   - 경로와 셸(App.vue)
   - 페이지·탭 안의 주소 처리 바꾸기
   - 예전 해시 넘기기
   - 로그인 돌아오기
   - 버전 표기 밀기
   - E2E 주소를 새 주소로 바꾸고, 예전 주소 보존 E2E 추가
3. 검사는 `scripts/check-run.sh`로 돌리고, 시험 서버 스크립트는 `scripts/test-server/`를 쓴다. 시험 서버(:15174)는 한 번에 한 담당만 쓴다. 마이그레이션은 없을 것으로 본다.
4. review → test → PR·첫 감사 → 머지(사용자 지시) → rc → stable(사용자 지시) → 둘째 감사 → retro.

## 영향 범위
- `package.json`·`pnpm-lock.yaml`(vue-router)
- `src/main.ts`·`src/Root.vue`·`src/App.vue`, 새 라우터 모듈
- `src/pages/Settings.vue`·`Spending.vue`·`Payroll.vue`·`Dashboard.vue`, `src/components/AddRecordModal.vue`·`MoreSheet.vue`, 그 밖에 `href="#…"`가 있는 곳
- `src/pages/Account.vue`·`src/lib/auth-ui.ts`(돌아오기 주소)
- `server/app.ts`(fallback 확인), `vite.config.ts`
- 테스트: `tests/e2e/*`(해시 주소 약 190곳), 새 보존 E2E
- 문서: README, DESIGN.md(주소를 적은 곳), CHANGELOG

## 제약
- 지금 받는 주소와 입력은 그대로 받는다(AGENTS.md: 예전에 받던 것을 거부하는 변경은 spec 변경). 예전 해시 주소는 모두 같은 화면으로 이어 준다. 바뀌기 전과 비교하는 E2E를 둔다.
- 화면·데이터·API는 바꾸지 않는다. 바뀌는 것은 주소뿐이다.
- 첫 화면 JS 크기가 늘어난다(vue-router). 한도는 spec에서 정하고, 넘으면 그때 묻는다.
- 공개 저장소다. 예시와 테스트에 실제 데이터를 쓰지 않는다.

## 열린 질문
1. **시험 서버 기준 E2E 실패 0으로 만들기**(로드맵 아이디어): 지금 시험 서버에서 항상 실패하는 6개를 이번에 같이 고칠까요? PM 제안: 같이 고치지 않습니다. E2E 주소를 모두 바꾸는 이번 작업에서 그 6개가 섞이면 회귀를 가려내기 어렵습니다. `scripts/test-server/seed.mjs`로 데이터 문제(edit:106·140·438)는 이미 줄었고, 나머지(Dex, payroll 선택자, 토요일 색, 휴대폰 더보기)는 작은 패치로 따로 합니다.
2. **새 주소 모양**: `/spend/general`처럼 지금 해시와 같은 이름을 쓸지, 이름을 바꿀지. PM 제안: 같은 이름을 씁니다. 예전 주소와 짝이 분명하고 E2E를 바꾸기 쉽습니다.

## 질의서 기록
- 2026-11-21: PM이 해시 주소의 이유는 기록에 없다고 답하고, (a) 0.1.5와 0.1.6 사이 작은 패치 / (b) 0.1.6 안 중에서 물음 → 사용자 "그렇게 하자 그럼. a방식으로. 진행".
- 2026-11-22: 사용자 "진행 준비" → 버전 질문 → "0.1.6으로, 뒤를 하나씩 밀기 (Recommended)". `docs/ROADMAP.md`에서 계좌 관리 0.1.7, 거래 0.1.8, 급여명세서 0.1.9, 모바일 앱 0.1.10, MCP OAuth 0.1.11로 밀었다.

### 에이전트가 정한 것
- **vue-router의 history 모드**(`createWebHistory`). 대안: 해시 모드를 그대로 두고 vue-router만 쓰기. 이유: 사용자가 물은 것이 `#` 주소이고, 서버 fallback이 이미 있다.
- **예전 해시는 클라이언트에서 넘긴다**: 앱이 열릴 때와 해시가 바뀔 때 `#…`을 새 경로로 바꾼다(`replace`, 기록에 두 번 남지 않게). 대안: 서버에서 넘기기. 이유: 해시는 서버로 오지 않는다.

## 하지 않을 것
- 화면·기능 변경, 새 메뉴
- 계좌 관리·예산 화면(0.1.7)
- 시험 서버 기준 실패 고치기(열린 질문 1에서 따로 하자고 하시면)
