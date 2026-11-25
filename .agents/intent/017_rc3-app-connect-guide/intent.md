---
id: "017"
slug: rc3-app-connect-guide
version: 0.1.9
status: draft
origin: user
approvals: []
waivers: []
supersedes: null
---
## 문제
사용자 말 (2026-11-26, 0.1.9-rc.2를 낸 뒤, 정식 배포를 멈추고):
> 지금 플러그인이 만들어진게 맞음? mcp 설정에 설명이 없는데
>
> 아니 뭔 개소리야. 그건 둘째 치고 사용자가 플러그인 설치하는 방법이 없다니깐은. 도움말 페이지든 모달이든 있어야 할 거 아니야

PM 질문("언제?", "어떤 모양?")에 대한 답:
> 0.1.9-rc.3으로, 정식 전에 (추천)
> 설정 › AI·연동에 '앱 연결' 카드 + 앱별 모달 (추천)

지금(0.1.9-rc.2) 상황 (PM이 코드에서 확인):
- **앱 안에 설치 안내가 없다**: 설정 › AI·연동(`src/pages/SettingsAi.vue`)의 "연결 방법"은 API 키로 붙이는 `claude mcp add … --header "Authorization: Bearer …"` 명령 하나뿐이다. 마켓플레이스·플러그인 설치(`allot` / `allot-key`), OAuth로 붙이는 앱(claude.ai·휴대폰 앱, ChatGPT, Codex, Gemini CLI, Antigravity), 스킬은 README "AI 연결"에만 있다. 앱만 쓰는 사람은 알 길이 없다. spec 015가 설치 안내를 README에만 두고 앱 화면을 빠뜨렸다.
- **스킬 ZIP**: claude.ai에 올릴 ZIP은 저장소에서 `node scripts/skills-zip.mjs`를 돌려야 만들어진다. 앱 사용자가 받을 곳이 없다.
- **MCP 목록의 설명**: Allot MCP 서버가 연결할 때 주는 자기소개(`serverInfo`)에 이름(`allot`)과 버전만 있고 제목·설명·홈페이지가 없다(`server/mcp/tools.ts`). SDK(@modelcontextprotocol/server 2.4.0)는 `title`·`description`·`websiteUrl`을 받는다. 설명을 보여 주는 앱에서는 비어 보인다.

## 바라는 결과
1. **앱 안에서 연결 방법을 찾는다**: 설정 › AI·연동에 '앱 연결' 카드가 있고, 앱을 고르면 모달에 그 앱의 단계별 방법과 그 회사의 공식 도움말 링크가 나온다. 앱은 README의 일곱 가지(Claude Code 플러그인 OAuth·API 키, claude.ai·데스크톱·휴대폰, ChatGPT, Codex, Gemini CLI, Antigravity CLI)에, API 키로 붙이는 방법, 목록에 없는 에이전트에 손으로 붙이는 방법(MCP 주소·Streamable HTTP·OAuth 자동 발견 또는 `Authorization: Bearer` 키, 스킬 파일 넣기)을 더한다. 이 서버의 실제 MCP 주소와 명령이 채워져 있고 복사 버튼이 있다. OAuth가 꺼져 있거나 서버 주소가 https가 아니면, 그 때문에 안 되는 방법은 이유와 함께 흐리게 두고 안내한다("관리자가 외부 앱 연결을 켜야 해요").
2. **스킬을 앱에서 받는다**: claude.ai용 스킬 ZIP을 앱에서 바로 받는다(이미지에 넣은 ZIP을 서버가 줌 — 서버 버전과 스킬이 같다).
3. **MCP 목록에 설명이 보인다**: 서버 자기소개에 제목 "Allot", 한 줄 설명, 저장소 주소가 들어간다.

## 계획
1. 안내 내용: README "AI 연결 › 앱별 방법"을 앱 화면용으로 옮긴다(ko·en). 한 곳의 데이터(앱별 단계, 명령 틀)를 두고 화면이 주소를 채운다.
2. 화면: `SettingsAi.vue`에 '앱 연결' 카드(앱 목록)와 앱별 모달. 지금의 "연결 방법"(키 명령)은 그 안의 'API 키로' 방법으로 옮기되 없애지 않는다. 휴대폰 폭에서도 읽힌다.
3. 서버 상태 표시: OAuth 스위치 상태와 https 여부(관리자 설정을 사용자에게 보여 줄 수 있는 범위만)를 화면이 알 수 있게 — 지금 있는 API로 되면 그것을 쓴다.
4. 스킬 ZIP: 이미지 빌드 때 `scripts/skills-zip.mjs`로 만들어 넣고, 로그인한 사용자에게 서버가 내려 준다.
5. `serverInfo`에 `title`·`description`·`websiteUrl`.
6. 시험: 카드·모달이 열리고 주소가 채워짐, 복사, OAuth 꺼짐 안내, 휴대폰 폭, 스킬 ZIP 받기, `initialize` 응답의 `serverInfo`. rc.1·rc.2의 회귀.
7. 그 뒤 0.1.9-rc.3을 내고, rc.3 화면 확인과 함께 0.1.9의 V-9·V-10, rc.2의 V-8.

## 영향 범위
- 화면: `src/pages/SettingsAi.vue`, 새 컴포넌트(카드·모달), i18n(ko·en).
- 서버: `server/mcp/tools.ts`(serverInfo), 스킬 ZIP을 서버가 주면 그 경로와 이미지 빌드(`Dockerfile`, `scripts/skills-zip.mjs`).
- 문서: README(앱 안의 안내를 가리킴), CHANGELOG.
- OAuth·`/mcp`·플러그인 파일 자체는 바꾸지 않는다.

## 제약
- 공개 저장소: 예시 주소는 `allot.example.com` 같은 가짜만.
- 각 회사 앱의 화면·요금제는 바뀔 수 있다: 안내에 기준 날짜를 적고, 확인하지 못한 앱은 그렇다고 적는다(README와 같게).
- 관리자만 아는 설정을 일반 사용자에게 드러내지 않는다(보여 줄 것은 "이 서버에서 OAuth 연결이 되는지" 정도).
- 예전 입력을 거부하거나 새 제한을 더하면 spec에 적고 승인(AGENTS.md).

## 열린 질문
없음 — 아래 질의서 기록에 답이 있다.

<details><summary>처음에 물은 질문 (답은 질의서 기록)</summary>

1. **앱 목록**: README에 있는 일곱 가지(Claude Code 플러그인 OAuth·키, claude.ai·데스크톱·휴대폰, ChatGPT, Codex, Gemini CLI, Antigravity CLI)를 모두 넣을까요? (PM 생각: 모두 — README와 같게. 확인하지 못한 것(Gemini 앱 웹 등)은 빼거나 "확인 안 함" 표시.)
2. **스킬 ZIP 받기**: 앱에서 바로 받기(이미지에 ZIP을 넣고 서버가 줌) / GitHub 릴리스에 ZIP을 붙이고 앱은 그 링크 / 저장소의 `skills/` 링크만. (PM 생각: 앱에서 바로 받기 — 서버 버전과 스킬이 맞고, 인터넷이 막힌 서버에서도 됨.)
3. **OAuth가 꺼져 있을 때**: OAuth로만 되는 앱(claude.ai·ChatGPT)은 흐리게 두고 "관리자가 외부 앱 연결을 켜야 해요"라고 할까요, 숨길까요? (PM 생각: 흐리게 두고 안내 — rc.2의 비밀번호 칸과 같게.)
4. **모달 대신 링크**: 각 회사의 공식 도움말 링크도 함께 둘까요? (PM 생각: 둠 — 화면이 바뀌어도 사용자가 찾아갈 수 있게.)

</details>

## 질의서 기록
사용자 답 (2026-11-26, PM 질문에 대한 선택):
- 질문 1(앱 목록): "README의 일곱가지 + APIKey 방식 + 기타 에이전트 적용 방식(수동)"
- 질문 2(스킬 ZIP): "앱에서 바로 받기 (추천)"
- 질문 3(OAuth가 꺼져 있을 때): "흐리게 두고 안내 (추천)"
- 질문 4(공식 도움말 링크): "둠 (추천)"
### 에이전트가 정한 것
- intent 015·016을 고치지 않고 같은 버전의 새 intent 017로 씀: 015의 승인·감사 기록을 그대로 두고, rc.2처럼 rc 하나에 intent 하나.
- "기타 에이전트 적용 방식(수동)"은 목록에 없는 MCP 클라이언트를 위한 일반 안내로 읽음: MCP 주소, 연결 방식(Streamable HTTP), 인증(OAuth 자동 발견 `/.well-known/…` 또는 `Authorization: Bearer <키>`), 스킬은 `SKILL.md` 폴더를 그 에이전트의 스킬 위치에 넣기.

## 하지 않을 것
- 각 앱의 공식 디렉터리 등록(0.1.9 사용자 결정 "공식 디렉터리는 그냥 패스하자").
- 플러그인·OAuth 동작 변경, 새 MCP 도구.
- 0.1.10 항목.
