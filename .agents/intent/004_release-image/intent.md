---
id: "004"
slug: release-image
version: 0.1.0
status: draft
origin: user
approvals: []
waivers: []
supersedes: null
---
## 문제
사용자 말 (2026-11-11):
> 일단 stable 릴리스좀 해봐. ghcr.io 쓰고, env example 같은데에도 money 대신 allot 쓰고
> (이미지 형태) "단일 이미지 (Recommended)"
> (빌드·푸시) "http://github.com/team-croffle/pipit-bot 참고. 수동으로해야 함"
> (버전) "바로 v0.1.0 stable (Recommended)"

지금 Docker 이미지는 개발용이다(Vite 개발 서버, 소스 마운트). 운영에서 쓸 이미지와 릴리스 절차가 없다. `docker/.env.example`의 DB 사용자·이름은 아직 `money`이다.

## 바라는 결과
- `ghcr.io/bluenyang/allot:<버전>`(정식 버전은 `latest`도) 운영 이미지 하나. 빌드된 프론트와 API를 Node 프로세스 하나가 서빙하고, 시작할 때 마이그레이션을 적용한다. DB는 외부(운영 서버의 PostgreSQL 16)에 `DATABASE_URL`로 연결한다.
- 릴리스는 GitHub Actions에서 **수동 실행**(workflow_dispatch)한다. pipit-bot의 `release.yml`과 같은 흐름: 버전 계산 → (바뀌면) 버전 커밋 → 태그 → 게이트 → 이미지 푸시 → GitHub Release 초안.
- `docker/.env.example` 등에서 `money` 대신 `allot`.
- 그 결과로 `v0.1.0` stable 릴리스.

## 계획
1. 운영 이미지: 멀티 스테이지 `Dockerfile`(빌드 → 실행), 서버가 정적 파일과 SPA 폴백을 서빙.
2. 클라이언트 IP: 운영에는 Vite 프록시가 없으므로 서버가 직접 정한다. 기본은 소켓 주소, 설정하면 신뢰하는 리버스 프록시의 헤더 하나만 쓴다(로그인 시도 제한).
3. `docker/compose.prod.yaml` 예시(앱만, DB는 외부)와 `.env` 예시.
4. `.github/workflows/release.yml`(수동 실행, dry-run 포함).
5. `money` → `allot`(env 예시, 테스트 스택 값).
6. 리뷰 → 테스트(로컬에서 운영 이미지 빌드·실행·로그인) → PR → 머지 → 감사 → 워크플로 실행(v0.1.0) → 이미지 받아 실행 확인 → Release 공개.

## 영향 범위
새 `Dockerfile`(저장소 루트), `server/`(정적 서빙, 클라이언트 IP), `package.json`(서버 빌드 스크립트), `docker/compose.prod.yaml`, `docker/.env.example`, `docker/compose*.yaml`(IP 헤더 설정), `.github/workflows/release.yml`, README·AGENTS.md·CHANGELOG.

## 제약
- 비밀값은 저장소에 넣지 않는다. 워크플로는 `GITHUB_TOKEN`만 쓴다.
- 푸시·PR·머지·워크플로 실행·Release 공개는 각각 사용자 지시가 있어야 한다(이번 요청이 v0.1.0 stable 지시다).
- 개발 스택(`docker/compose.yaml`, `compose.dev.yaml`)은 지금처럼 동작한다.

## 열린 질문
1. 이미지 아키텍처: 운영 서버가 x86_64면 `amd64`만, ARM이면 `arm64`도 필요하다. (pipit-bot은 amd64만 만든다.)

## 질의서 기록
—
### 에이전트가 정한 것
- 서버 코드는 실행 이미지에서 TypeScript 그대로(tsx) 돌리지 않고 빌드한 JS로 돌린다. 대안은 tsx를 운영 의존성으로 옮기는 것인데, 실행 이미지가 커지고 시작이 느려져서 고르지 않았다.
- 클라이언트 IP는 기본적으로 소켓 주소를 쓴다. 대안은 `X-Forwarded-For`를 항상 믿는 것인데, 위조할 수 있어 로그인 시도 제한이 무력해진다.
- 버전이 이미 `0.1.0`이면 버전 커밋을 건너뛰고 태그만 만든다.

## 하지 않을 것
- 운영 서버 배포 자동화(사용자 서버에 직접 접속하는 일).
- DB 컨테이너를 운영 이미지에 넣는 일.
- v0.2 기능.
