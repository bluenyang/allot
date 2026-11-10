---
intent: "002"
status: accepted
approvals:
  - role: user
    kind: summary
    by: BlueNyang
    at: "2026-11-10"
    words: "진행"
    rev: 1128e5c
  - role: user
    kind: check
    by: BlueNyang
    at: "2026-11-10"
    words: "1. 그대로 가자."
    rev: 00117d1
    note: "V-6 화면(스크린샷 8장) 판단: 팔레트 그대로 확정."
summary_for_user: |
  이름을 Allot으로 바꿉니다: 화면(로고 A, 사이드바·모바일 상단·로그인·탭 제목), 패키지, compose 프로젝트(allot, allot-dev), 문서, 코드 식별자.
  색은 깊은 초록(accent #14705a, 다크 #5ccba3)에 호박색 보조를 씁니다. 라이트·다크 모두 글자 4.5:1 이상, 차트 색 3:1 이상이고 검사 스크립트로 확인합니다.
  아바타 글자 색을 모드별 토큰으로 바꿔서 다크 모드 대비 문제도 함께 고칩니다.
  과거 기록(intent 001, 감사 0.1.0, git 이력)과 폴더 이름은 바꾸지 않습니다. 작업 2개, 검증 7개, 끝나면 0.1.0-rc.2입니다.
---
## 요구 해석
- S-1 "다 allot으로 하고" → 사용자에게 보이는 이름과 저장소 안의 현재 이름을 모두 **Allot**(식별자는 소문자 `allot`)으로 바꾼다. 대상은 화면 문구, `<title>`, 로고 글자 `M` → `A`, `package.json` `name`, compose 프로젝트 `money-desk` → `allot`·`money-desk-dev` → `allot-dev`, README·AGENTS.md(프로젝트 섹션)·docs/ROADMAP.md·CHANGELOG.md, 코드 식별자(IP 헤더, 시드 잠금 키, 계정 표시 이름, 테스트 예시 이메일 도메인)다. (intent 바라는 결과 1)
- S-2 "색상도 좀 어울리는 색으로 바꿔라" → `src/style.css`의 색 토큰을 아래 팔레트로 바꾼다. 라이트·다크 모두 본문 글자 7:1, 보조 글자·강조색 글자 4.5:1, 차트 표시 색 3:1 이상이다. (intent 바라는 결과 2, 에이전트가 정한 색 방향)
- S-3 intent 제약 "과거 기록은 당시 이름 그대로" → `.agents/intent/001_*`, `.agents/audit/0.1.0.md`, git 이력, `CHANGELOG.md`의 0.1.0-rc.1 항목은 고치지 않는다.
- S-4 intent 제약 "폴더는 사용자가 바꾼다" → 레포 디렉터리 이름은 건드리지 않는다.

## 설계
**이름**
- 화면: `src/App.vue`(사이드바·모바일 상단), `src/pages/Login.vue`, `index.html` `<title>`, 로고 `<span class="logo">A</span>`.
- 식별자: `x-money-desk-client-ip` → `x-allot-client-ip`(`server/auth.ts`, `vite.config.ts`), 잠금 키 `money-desk:admin` → `allot:admin`, 계정 표시 이름 `Money Desk` → `Allot`(`server/db/seed.ts`, `.loctx/scripts/make-seed-sql.ts`), 테스트 계정 예시 `@money-desk.local` → `@allot.local`(`docker/.env.dev`는 에이전트 테스트 파일이라 같이 바꾸고 시드를 다시 돌린다).
- compose: `name: allot` / `name: allot-dev`. 볼륨이 새로 생기므로 테스트 DB는 다시 시드한다. 옛 `money-desk-dev` 컨테이너·볼륨은 에이전트 테스트 스택이므로 내린 뒤 지운다.
- 문서: README 제목·본문, AGENTS.md 프로젝트 섹션, docs/ROADMAP.md 제목, CHANGELOG.md에 0.1.0-rc.2 항목 추가.

**팔레트** (`src/style.css` 토큰. 다크는 `prefers-color-scheme`와 `[data-theme="dark"]` 두 블록 모두)

| 토큰 | 라이트 | 다크 |
|---|---|---|
| bg / surface / raised | #f3f6f4 / #ffffff / #f6f9f7 | #0b1310 / #121c18 / #17241f |
| fg / muted / line | #13201b / #5c6d65 / #dde6e1 | #e3ede8 / #93a89e / #24352e |
| side / side-fg / side-muted / side-active | #0e2620 / #c6dbd1 / #86a99a / #1b3f33 | #07100d / #c6dbd1 / #71917f / #173329 |
| accent / accent-soft / accent-ink | #14705a / #e0f0e9 / #ffffff | #5ccba3 / #12342a / #08120e |
| pos / pos-soft | #0e7a4f / #e2f4ea | #58d3a3 / #103026 |
| neg / neg-soft | #bb3239 / #fbe9ea | #ff8086 / #3a1c21 |
| warn / warn-soft | #9a5500 / #fbefdc | #f2ab55 / #35260f |
| c1~c7 | #14705a #b2581a #2a6fa8 #8a6c10 #18797a #7458b8 #b9c4be | #5ccba3 #f0a066 #6cb0ea #e2c461 #58c3bb #b39af2 #3d4e47 |
| av-ink (새 토큰) | #ffffff | #08120e |

- `.av`의 `color:#fff`를 `var(--av-ink)`로 바꾼다. 지금은 다크 모드의 밝은 차트 색 위에 흰 글자가 올라가 대비가 모자라다.
- 사이드바·강조 블록의 `#fff` 글자는 그대로 두고, 새 배경과의 대비를 검사한다.
- `c7`은 "나머지/비활성" 회색이라 대비 검사에서 뺀다(지금도 같은 역할).
- `tests/contrast.mjs`: `src/style.css`에서 라이트 `:root` 블록과 다크 블록의 토큰을 읽어 WCAG 대비를 계산한다. 아래 V-4의 쌍을 검사하고, 하나라도 기준 미달이면 exit 1.

### 에이전트가 정한 것
- 다크 블록 두 개(`@media` 안, `[data-theme="dark"]`)는 같은 값을 쓴다. 지금 구조를 유지한다.
- 차트 색 순서(c1 초록 = ISA·AI, c2 호박 = 생활비·통신 …)는 지금 배정을 그대로 둔다. `src/lib/colors.ts`는 바꾸지 않는다.

## 작업 단위
- [x] W-1 이름 변경: 위 "이름"의 모든 파일, `.env.dev` 테스트 계정, compose 이름. 옛 테스트 스택을 내리고 새 이름으로 띄운다. (S-1, S-3, S-4)
- [x] W-2 팔레트: `src/style.css` 토큰 교체, `--av-ink` 추가, `tests/contrast.mjs`. (S-2)

## 검증 기준
원본 출력은 `.loctx/reports/0.1.0/rc2/`에 남긴다. 판정이 모호하면 실패다. `<dev>`는 `docker compose -f docker/compose.dev.yaml`이다.
- V-1 게이트: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build` → 모두 exit 0.
- V-2 이름: `git grep -niI "money.desk\|moneydesk"` 결과가 S-3의 과거 기록 파일(`.agents/intent/001_*`, `.agents/audit/0.1.0.md`, `CHANGELOG.md`의 0.1.0-rc.1 절)과 이 intent·spec(002) 안에만 있다. 화면에 `Allot`이 보이고 로고 글자가 `A`다(V-6 스크린샷). 실패: 그 밖의 파일에 하나라도 남음.
- V-3 새 스택: `<dev> up -d --build -V --wait` → exit 0, `docker compose ls`에 `allot-dev`가 있고 `money-desk-dev`가 없다. 시드 후 LAN IP로 15173 → 200.
- V-4 대비: `node tests/contrast.mjs` → exit 0. 라이트·다크 각각 fg/bg·fg/surface ≥ 7, muted/surface·muted/raised ≥ 4.5, accent/surface·accent/accent-soft·accent-ink/accent ≥ 4.5, side-fg/side ≥ 7, side-muted/side ≥ 4.5, #fff/side-active ≥ 7, pos·neg·warn 각각 /soft·/surface ≥ 4.5, c1~c6/surface ≥ 3, av-ink/c1~c6 ≥ 4.5.
- V-5 회귀: `node tests/api/crud.mjs create` → `<dev> restart api` → `verify` → `cleanup` 모두 exit 0, 그리고 `pnpm e2e` 12개 통과. 실패: 하나라도 실패.
- V-6 화면: Playwright로 로그인 화면과 현황·구독 화면을 라이트·다크에서 캡처한다(`.loctx/reports/0.1.0/rc2/*.png`). 로고 `A`, 이름 `Allot`, 초록 강조색이 보인다. 사용자에게 보여 주고 판단을 받는다.
- V-7 IP 헤더: 틀린 비밀번호로 반복 로그인 → 한도 뒤 429. `x-allot-client-ip` 헤더를 위조해도 429가 유지된다(프록시가 새 이름의 헤더를 덮어씀).

## 우려
- compose 이름이 바뀌면 사용자의 실제 스택도 `allot` 이름의 새 볼륨을 쓴다. 실제 스택은 아직 띄운 적이 없어서 옮길 데이터는 없다.
- 폴더 이름은 사용자가 바꾸므로, 그 전까지 경로에는 `money-desk`가 남는다(문서의 명령은 상대 경로라 영향 없음).
- 색은 취향이 큰 부분이다. V-6 스크린샷을 보고 사용자가 수정을 요청하면 W-2만 다시 한다.

## 범위 밖
- 폴더·Syncthing 설정 변경, git 이력, 과거 기록 문서.
- 로고 디자인(글자 외), 폰트, 레이아웃.
