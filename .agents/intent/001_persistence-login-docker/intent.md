---
id: "001"
slug: persistence-login-docker
version: 0.1.0
status: approved
origin: user
approvals:
  - role: user
    by: BlueNyang
    at: "2026-11-10"
    words: "v0.2에서 MCP 열고 싶거든? OAuth랑 패스크 로그인 넣어서. 클로드랑 이전에 대화했던거를 MCP로 데이터 조정해달라고 하려고. 그렇게 한다고 치고, intent 001은 승인."
    rev: b711ded
waivers: []
supersedes: null
---
## 문제
사용자 말 (2026-11-10):
> PostgreSQL 사용. 라이브러리 사용하기를 권장함
> 로그인 기능 넣기(다른 라이브러리 사용 권장)
> seed 때문인지는 몰라도 각 항목 수정이 안되더라고? 수정되게 해놔.
> 향후 각 버전마다 docker 사용해서 개발 서버 15173으로 열어놓고.
> docker 폴더에 Dockerfile, compose.yaml, .env.example 놔두고.

지금 앱은 프론트만 있고, 상태가 메모리에만 있어서 새로고침하면 `src/data/seed.ts` 값으로 돌아간다. 로그인도 없다.

(에이전트 해석) 코드로 확인한 "수정이 안 되는" 원인 후보:
1. 저장이 안 된다: 메모리 상태라 새로고침하면 seed로 돌아간다.
2. 수정 UI가 없다: 설정(실수령·급여일·이체일·카드일·구독 이체 올림), 구간(phases), 일정(상태 토글만), 체크리스트(완료 토글만), 계좌·부채·ISA 분배(읽기 전용 표), 구독 메모.
3. 분배 탭의 실수령 입력(`src/pages/Payroll.vue:27`)은 시뮬레이션용이라 저장값을 바꾸지 않는다.
4. 구독 목록은 전환이 적용된 플랜을 보여 주는데, 편집기는 기본 플랜을 고친다. 전환이 덮어쓰는 필드는 고쳐도 목록에서 그대로 보인다.
5. 구독 편집 패널이 목록 위에 열려서, 아래쪽 행을 누르면 반응이 없어 보일 수 있다(브라우저 확인 필요).
6. 버그: `resetStore`, `exportJson`에서 accounts·debts·isaSplit이 빠져 있다.

## 바라는 결과
- 데이터가 PostgreSQL에 저장되고, 새로고침해도 유지된다.
- 로그인해야 앱을 쓸 수 있다.
- 화면에 보이는 모든 항목을 추가·수정·삭제할 수 있다.
- `docker/compose.yaml` 하나로 개발 환경이 뜨고, 브라우저에서 `http://localhost:15173`으로 연다. 이 방식이 이후 모든 버전의 기본 개발 방식이다.
- `docker/`에 `Dockerfile`, `compose.yaml`, `.env.example`이 있다.

## 계획
1. Docker 개발 환경: web(Vite 15173) + api + postgres.
2. API 서버와 DB 스키마·마이그레이션.
3. 기존 데이터 시드: `.loctx/scripts/seed-data.ts`를 DB에 넣는 스크립트.
4. 로그인.
5. 프론트 store를 API 호출로 교체.
6. 빠진 수정 UI 추가, 위 버그 수정.
7. 게이트와 문서(README, AGENTS.md 명령표) 갱신.

## 영향 범위
`src/lib/store.ts`, `src/pages/*.vue`, 새 `server/`, 새 `docker/`, `package.json`·`pnpm-lock.yaml`, `vite.config.ts`, `tsconfig*.json`, `.agents/harness/gates.yaml`(typecheck 범위), README, AGENTS.md 프로젝트 섹션.

## 제약
- pnpm만 쓰고, 의존성은 정확한 버전으로 고정한다.
- 비밀값은 `docker/.env`에만 둔다. 에이전트는 이 파일을 읽지 않으며(C4), 사용자가 `.env.example`을 복사해 만든다.
- `src/lib/calc.ts`는 순수 함수로 유지한다(서버와 공유).
- Syncthing 파일에는 손대지 않는다.

## 열린 질문
없음. 2026-11-10에 사용자가 답했다(선택지 그대로 인용).
1. 기술 스택: "추천대로". API는 Hono(`@hono/node-server`), DB는 Drizzle ORM(postgres.js 드라이버, drizzle-kit 마이그레이션), 로그인은 Better Auth(이메일+비밀번호, 가입 막음, 본인 계정 하나만 시드로 생성), 저장소는 패키지 하나에 `server/` 폴더.
2. 수정 범위: "모든 항목". 설정·구간·일정·체크리스트·계좌·부채·ISA 분배·구독(메모 포함)·플랜 전환 모두 추가·수정·삭제할 수 있게 한다. 전환이 덮어쓴 필드가 목록에 반영되지 않는 문제도 같이 고친다.
3. 접속 범위: "LAN까지". 15173을 `0.0.0.0`에 열어 같은 네트워크의 기기에서도 접속한다. postgres와 api는 compose 내부망에만 둔다.
4. seed·빌드: "seed 제거 + 단일파일 중단". 앱 코드에서 `src/data/seed.ts`를 빼고 데이터는 DB에서만 읽는다. 시드는 `.loctx/scripts/seed-data.ts`를 쓴다. `vite-plugin-singlefile`을 빼고 일반 Vite 빌드로 간다. 실제 데이터는 git 이력에 남는다.

## 질의서 기록
- advisor/committee: 2026-11-10, `.loctx/reports/0.1.0/committee-fable.md`. 권고 Hono / Drizzle / Better Auth(가입 막기) / 단일 패키지 / Vite `/api` 프록시로 같은 출처. 지적한 위험: 컨테이너 안에서 lefthook `prepare` 실패, 시드의 문자열 ID와 uuid 매핑, 로그인 rate limit.
  - 주의: CLI가 `claude-fable-5-2`를 `unrecognized_model`로 보고했다. 답변은 받았지만 실제로 어떤 모델이 답했는지는 확인되지 않았다.

### 에이전트가 정한 것
- Vite 개발 서버가 `/api`를 api 컨테이너로 프록시해 출처를 하나로 둔다. 대안은 API 포트를 따로 열고 CORS를 쓰는 방식이다. 같은 출처면 로그인 쿠키·CORS 설정이 필요 없어 이쪽으로 정했다.
- 외부에는 15173만 열고 postgres와 api는 compose 내부망에 둔다. 대안은 DB 포트까지 여는 방식인데, 노출 면을 줄이려고 닫아 두었다. LAN에 열리므로 로그인 시도 횟수 제한(rate limit)을 켠다.
- 컨테이너에는 git이 없어 `prepare: lefthook install`이 실패하므로, 컨테이너 안에서는 이 단계를 건너뛰게 한다. 대안은 이미지에 git을 넣는 방식인데, 훅은 호스트에서만 의미가 있어서 건너뛰기로 했다.

## 하지 않을 것
- 운영 배포, 서버 호스팅.
- 다중 사용자, 회원가입 화면.
- OAuth·패스키 로그인(나중 버전에서 검토).
