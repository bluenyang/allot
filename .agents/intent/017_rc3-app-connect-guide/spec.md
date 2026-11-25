---
intent: "017"
status: draft
approvals: []
summary_for_user: |
  0.1.9-rc.3은 작업 단위 6개(W-1~W-6)입니다. 순서는 안내 내용 → 화면(카드·모달) → 스킬 ZIP → MCP 서버 자기소개 → 문서 → 시험입니다.
  설정 › AI·연동에 '앱 연결' 카드를 두고 앱 아홉 가지를 보여 줍니다: Claude Code(플러그인·OAuth), Claude Code(플러그인·API 키), claude.ai·데스크톱·휴대폰, ChatGPT, Codex, Gemini CLI, Antigravity CLI, API 키로 직접, 그 밖의 에이전트(수동).
  하나를 누르면 모달(휴대폰에서는 아래에서 올라오는 시트)에 단계·명령·이 서버의 MCP 주소·복사 버튼·공식 도움말 링크가 나옵니다.
  관리자가 외부 앱 연결(OAuth)을 꺼 두었거나 서버가 https가 아니면, OAuth로만 되는 앱(claude.ai·ChatGPT, OAuth 플러그인)은 흐리게 두고 이유를 적습니다. 판단은 지금 있는 `GET /api/oauth-apps`의 `enabled`로 합니다.
  지금 카드의 키 명령(`claude mcp add … --header`)은 없애지 않고 'API 키로 직접' 모달로 옮깁니다. MCP 주소·예전 주소 안내·연결된 앱 목록은 그 자리에 그대로 둡니다.
  스킬 ZIP 일곱 개는 이미지를 만들 때 넣고, 로그인한 사용자만 `GET /api/skills/<이름>.zip`으로 받습니다(이름은 정해진 일곱 개만). claude.ai 모달과 수동 모달에서 받기 버튼으로 받습니다.
  MCP 서버 자기소개에 제목 "Allot", 한 줄 설명(영어), 저장소 주소를 넣습니다.
  새로 거부하는 입력이나 새 제한은 없습니다(스킬 받기는 새 경로이고, 로그인을 요구하는 것은 다른 API와 같습니다).
---
## 요구 해석
- S-1 **앱 연결 카드** (intent 바라는 결과 1, 사용자 "README의 일곱가지 + APIKey 방식 + 기타 에이전트 적용 방식(수동)", "설정 › AI·연동에 '앱 연결' 카드 + 앱별 모달 (추천)"): 설정 › AI·연동에 카드 하나, 그 안에 앱 아홉 개.
  1. Claude Code — 플러그인 `allot`(OAuth)
  2. Claude Code — 플러그인 `allot-key`(API 키)
  3. claude.ai · Claude 데스크톱 · 휴대폰 앱(커넥터, OAuth)
  4. ChatGPT(웹, OAuth)
  5. Codex(CLI, 플러그인과 MCP; OAuth 또는 키)
  6. Gemini CLI(확장과 MCP; 키 또는 OAuth)
  7. Antigravity CLI(플러그인과 MCP)
  8. API 키로 직접(`claude mcp add … --header`, 지금 카드의 명령)
  9. 그 밖의 에이전트(수동): MCP 주소, 연결 방식 Streamable HTTP, 인증 — OAuth(서버가 `/.well-known/oauth-protected-resource`로 알려 줌) 또는 `Authorization: Bearer <키>` 헤더, 스킬은 `SKILL.md` 폴더를 그 에이전트의 스킬 위치에.
  - 단계·명령은 README "AI 연결 › 앱별 방법"과 같다(2026-11 기준이라고 적음). Claude Code 플러그인은 "둘 중 하나만 설치"(spec 015 A-21)를 적는다. 확인하지 못한 것은 README처럼 그렇다고 적는다.
- S-2 **앱별 모달** (사용자 "둠 (추천)" — 공식 도움말 링크): 앱을 누르면 모달(넓은 화면은 가운데 창, 휴대폰은 아래 시트)이 열린다. 단계 목록, 명령마다 코드 칸과 복사 버튼, 이 서버의 MCP 주소(`<origin>/mcp`)를 채운 명령, 키가 필요한 곳은 `<API 키>` 자리 표시와 "키는 위 'API 키'에서 만들어요", 그 회사의 공식 도움말 링크(새 창). Esc·닫기·바깥 누르기로 닫히고 포커스가 돌아간다.
- S-3 **OAuth가 안 될 때** (사용자 "흐리게 두고 안내 (추천)"): `GET /api/oauth-apps`의 `enabled`가 false면(관리자가 끔, 또는 서버 주소가 https가 아님 — 서버의 `oauthOn()`), OAuth로만 되는 앱(1, 3, 4)은 흐리게 두고 "관리자가 외부 앱 연결을 켜야 해요(서버 주소가 https여야 해요)"라고 쓴다. 눌러서 열 수는 있고(방법은 읽을 수 있게), 모달 위에 같은 안내. 키로도 되는 앱(5·6·7·8·9)은 그대로, OAuth 단계 옆에만 같은 안내. 그 값을 못 받으면(실패) 흐리게 하지 않는다(지금 연결된 앱 목록과 같은 값이라 거기서 이미 오류를 보임).
- S-4 **스킬 ZIP 받기** (사용자 "앱에서 바로 받기 (추천)"): 이미지에 `skills/`의 일곱 ZIP(`scripts/skills-zip.mjs`가 만드는 것, 스킬마다 하나 — claude.ai가 하나씩 올림)이 들어 있다. 로그인한 사용자가 `GET /api/skills/<이름>.zip`으로 받는다. 이름은 일곱 개 중 하나만(그 밖은 404). 개발 환경처럼 ZIP이 없으면 404와 "이 서버에는 스킬 ZIP이 없어요" 안내. claude.ai 모달에 일곱 개 받기 버튼과 "Customize › Skills에 하나씩 올려요", 수동 모달에 같은 목록.
- S-5 **MCP 서버 자기소개** (intent 바라는 결과 3): `initialize`의 `serverInfo`에 `title: "Allot"`, `description`(영어 한 줄: 자기 서버의 월급 분배·예산·구독을 읽고 변경을 제안), `websiteUrl: "https://github.com/bluenyang/allot"`. `name: "allot"`·`version`은 그대로(바꾸면 클라이언트가 다른 서버로 볼 수 있음).
- S-6 **지금 있는 것은 그대로**: 지금 '연결 방법' 카드의 MCP 주소와 복사, 예전 주소(`/api/mcp`) 안내, 키 범위 안내, 연결된 앱 목록은 그 자리에 남는다. 키 명령은 8번 모달로 옮긴다(없어지지 않음). 예전 입력을 거부하거나 새 제한을 두는 것은 없다.

## 설계
### 안내 내용 (W-1)
- `src/lib/connect-guide.ts`(순수): 앱 목록 `{ id, name, auth: 'oauth'|'key'|'both', steps: Step[], help: { label, url }[] }`, `Step = { text: i18n 키, code?: (u: { url, keyPh }) => string }`. 문구는 i18n(`connect.*`, ko·en; 새 파일 `src/i18n/connect.ko.ts`·`connect.en.ts`).
- 공식 도움말 주소는 구현할 때 하나씩 열어 확인하고(열리는 것만), 확인한 날을 주석에 적는다. 확인 못 하면 넣지 않고 조정 기록에.
- 단위 시험: 모든 명령에 주소가 들어가고(`url`을 쓰는 단계), 키 자리가 `<…>`로만 있고, 예시 주소는 `example.com`뿐, 도움말 주소는 https, id가 겹치지 않음.

### 화면 (W-2)
- `src/components/ConnectApps.vue`: 카드(앱 타일 격자, 휴대폰은 한 줄에 하나) + 모달. 모달은 넓은 화면에서 가운데 Reka Dialog, 휴대폰 폭은 `Sheet.vue`처럼 아래에서. 기존 `copyText`·토스트 문구를 쓴다.
- `SettingsAi.vue`: '연결 방법' 카드 위에 새 카드. 키 명령 줄은 8번 모달로 옮기고, 그 자리에는 "앱별 방법은 위 '앱 연결'에서"라는 한 줄.
- OAuth 상태: `ConnectedApps.vue`가 이미 읽는 `GET /api/oauth-apps`의 `enabled`를 한 번 읽어 둘이 함께 쓴다(작은 공용 상태 `src/lib/oauth-state.ts` 또는 props).

### 스킬 ZIP (W-3)
- `Dockerfile` builder 단계에서 `node scripts/skills-zip.mjs`, 런타임 이미지에 `dist-skills/` 복사.
- `server/skills.ts`: `GET /api/skills`(있는 이름 목록과 크기), `GET /api/skills/:file`(`^allot-[a-z-]+\.zip$`이고 일곱 이름 중 하나, 파일이 있으면 `application/zip`, `Content-Disposition: attachment`). 세션 필요(app.ts의 세션 검사 뒤에 둠). 경로 조합은 이름 목록으로만(사용자 입력을 경로에 바로 쓰지 않음).
- API 문서(`server/docs.ts`)에 두 줄.

### MCP 서버 자기소개 (W-4)
- `server/mcp/tools.ts`의 `new McpServer({ name, version, title, description, websiteUrl }, …)`. SDK 2.4.0이 이 필드를 받는지 타입으로 확인.

### 문서 (W-5)
- README "AI 연결"의 처음에 "앱 안에서는 설정 › AI·연동 › 앱 연결에 같은 방법이 있다", 스킬 ZIP을 앱에서 받는다는 줄. CHANGELOG "Unreleased — 0.1.9-rc.3".

### 시험 (W-6)
- 단위: `tests/unit/connect-guide.test.ts`(W-1의 규칙), `serverInfo` 필드(가능하면 `tools.ts`의 정보를 따로 내보내 확인).
- API: `tests/api/skills.mjs` — 로그인 없이 401, 일곱 이름 200·`application/zip`·ZIP 머리(`PK`), 없는 이름·`../` 404, `GET /api/skills` 목록. MCP `initialize`의 `serverInfo.title`·`description`·`websiteUrl`(키로).
- E2E: `tests/e2e/connect-guide.spec.ts` — 카드에 아홉 앱, 각 모달이 열리고 주소가 채워짐, 복사(클립보드 권한), 공식 링크가 새 창, Esc로 닫히고 포커스 돌아옴, `oauth-apps`의 `enabled:false`를 흉내 내면 1·3·4가 흐림+안내, 휴대폰 폭 가로 스크롤 없음, 스킬 받기 버튼이 ZIP을 받음. 지금 있던 MCP 주소 복사·연결된 앱 목록이 그대로(S-6).

## 작업 단위
- [ ] W-1 안내 내용: `connect-guide.ts`, i18n ko·en, 도움말 주소 확인(S-1, S-2).
- [ ] W-2 화면: 카드·모달, OAuth 상태, 키 명령 옮김(S-1, S-2, S-3, S-6).
- [ ] W-3 스킬 ZIP: 이미지, 경로, API 문서, 화면의 받기 버튼(S-4).
- [ ] W-4 MCP 서버 자기소개(S-5).
- [ ] W-5 문서.
- [ ] W-6 시험.

## 검증 기준
- V-1 **게이트**: 머리 커밋에서 typecheck·build·unit exit 0.
- V-2 **이미지**: `docker build -t allot:test .`이 되고, 이미지 안에 ZIP 일곱 개.
- V-3 **스킬 API** (:15174): `skills.mjs` 모두 통과.
- V-4 **MCP 자기소개** (:15174): `initialize` 응답의 `serverInfo`에 `title`·`description`·`websiteUrl`, `name`·`version`은 그대로.
- V-5 **E2E** (:15174): `connect-guide.spec.ts` 통과, 휴대폰 폭 가로 스크롤 없음.
- V-6 **회귀**: `oauth.mjs`, `notice-marks.mjs`(일회용), `mcp.mjs` tools·write와 `api-keys.mjs`(일회용) 그대로, 전체 E2E에서 새 실패 없음(알려진 Dex 실패 제외).
- V-7 **화면 확인** (rc.3을 :15173에 올린 뒤 사용자): 앱 연결 카드와 모달, 실제로 한 앱(예: Claude Code 플러그인)을 그 안내대로 설치해 연결되는지, 스킬 ZIP을 claude.ai에 올려 보는지. rc.2의 V-8, 0.1.9의 V-9·V-10도 이어 확인.

## 조정 기록
<!-- - A-n (YYYY-MM-DD, W-n) 무엇을 · 왜 · 커밋 · 예전 입력 거부·새 제한: 있음|없음 -->

## 우려
- **각 회사 화면이 바뀜**: 안내는 2026-11 기준이고 회사 도움말 링크를 함께 둬서 바뀌어도 찾아갈 수 있게 한다. 안내를 고칠 때는 README와 `connect-guide.ts` 두 곳(README는 앱 안내를 가리키게 해 겹침을 줄임).
- **스킬 ZIP과 이미지 크기**: ZIP 일곱 개는 수십 KB라 작다.
- **확인 범위**: 실제 앱(claude.ai·ChatGPT)으로 붙여 보는 것은 공개 https 주소가 있어야 해서 V-7(사용자 서버)에서.

## 범위 밖
- intent 017의 하지 않을 것 전부: 공식 디렉터리, 플러그인·OAuth 동작 변경, 새 MCP 도구, 0.1.10.
- 앱 안의 일반 도움말 체계(다른 화면의 도움말).
