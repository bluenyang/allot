---
id: "002"
slug: rename-allot
version: 0.1.0
status: approved
origin: user
approvals:
  - role: user
    by: BlueNyang
    at: "2026-11-10"
    words: "좋아. 그렇게 해."
    rev: 40e3ff5
waivers:
  - step: merge (PR and CI)
    words: "응. 이번까지만 그렇게 해."
    at: "2026-11-10"
    scope: once
    note: "사후 기록(감사 0.1.0-rc3 A-3). 원격이 비공개 정리 전이라 PR·CI 없이 로컬 --no-ff 머지(5b26395). 당시 waiver를 바로 적지 않았다."
supersedes: null
---
## 문제
사용자 말 (2026-11-10):
> 이거 이름 추천 좀. money-dash는 조금 짜치는데
> 다 allot으로 하고, 색상도 좀 어울리는 색으로 바꿔라. 폴더는 내가 바꿈.

지금 이름은 "Money Desk"(패키지 `money-desk`)이고, 색은 프로토타입 때의 남보라(accent `#5b4cf0`)다.

## 바라는 결과
- 제품 이름이 모든 곳에서 **Allot**이다: 화면(사이드바·모바일 상단·로그인·`<title>`·로고 글자), 패키지 이름, compose 프로젝트 이름, 문서(README·AGENTS.md·ROADMAP·CHANGELOG), 코드 안의 식별자(헤더 이름, 잠금 키, 계정 표시 이름).
- 색이 "Allot"(정해진 몫으로 나눔)에 어울린다. 라이트·다크 모드 모두 대비가 충분하고, 차트 색끼리 구분된다.

## 계획
1. 이름 변경 (코드·설정·문서).
2. 색 팔레트 교체 (`src/style.css`의 토큰, 차트 색 `src/lib/colors.ts`).
3. 테스트 스택을 새 이름으로 다시 띄워서 게이트·API 검사·E2E를 다시 돌린다.
4. rc를 다시 자른다.

## 영향 범위
`package.json`, `index.html`, `src/App.vue`, `src/pages/Login.vue`, `src/style.css`, `src/lib/colors.ts`, `vite.config.ts`, `server/auth.ts`, `server/db/seed.ts`, `docker/compose.yaml`, `docker/compose.dev.yaml`, `docker/.env.example`, `README.md`, `AGENTS.md`(프로젝트 섹션), `docs/ROADMAP.md`, `CHANGELOG.md`.

## 제약
- 폴더(레포 디렉터리) 이름은 사용자가 바꾼다. 에이전트는 바꾸지 않는다.
- 과거 기록(intent 001·spec·감사 0.1.0·git 이력)은 당시 이름 그대로 둔다.
- compose 프로젝트 이름이 바뀌면 Docker 볼륨도 새로 생긴다. 테스트 DB는 다시 시드한다. 사용자의 실제 스택은 아직 띄운 적이 없다.

## 열린 질문
없음.
1. 버전: **0.1.0-rc.2**. (에이전트 해석: 사용자 답 "좋아. 그렇게 해."를 추천안 rc.2에 대한 동의로 읽었다. 첫 stable 0.1.0이 Allot 이름으로 나간다.)

## 질의서 기록
—
### 에이전트가 정한 것
- 색 방향: 깊은 초록(밭을 몫으로 나눈 allotment, 돈) + 따뜻한 호박색 보조. 지금의 남보라 대신 쓴다. 대안은 남색 계열을 유지하고 채도만 낮추는 것인데, 이름과의 연결이 약해서 고르지 않았다. 정확한 값과 대비 확인은 spec에서 정한다.
- 로고 글자는 `M` → `A`.
- 클라이언트 IP 헤더 `x-money-desk-client-ip` → `x-allot-client-ip`, 시드 잠금 키 `money-desk:admin` → `allot:admin`, 계정 표시 이름 `Money Desk` → `Allot`.

## 하지 않을 것
- 폴더 이름 변경, git 이력 재작성, 과거 기록 문서의 이름 변경.
- 화면 구조나 기능 변경.
