// How to connect each AI app to this server (spec 017 S-1, S-2): the app connection card and its dialogs in
// Settings › AI & integrations. Pure data: the screen fills in this server's MCP address and the key placeholder; the
// words are i18n keys (connect.*). The steps follow README "AI 연결 › 앱별 방법" (as of 2026-11).
// The official help links were opened and checked on 2026-11-26 (Codex's moved to learn.chatgpt.com with a 308).
import type { MessageKey } from '../i18n'

/** How the app signs in: OAuth only, an API key only, or either. */
export type ConnectAuth = 'oauth' | 'key' | 'both'

export interface Fill {
  /** This server's MCP address, e.g. https://allot.example.com/mcp */
  url: string
  /** The page's origin, e.g. https://allot.example.com */
  origin: string
  /** Where the user's API key goes, e.g. <키> */
  keyPh: string
}

export interface ConnectStep {
  text: MessageKey
  /** A command or value to copy. */
  code?: (f: Fill) => string
  /** The step works only with this way of signing in (the screen says so when OAuth is off). */
  mode?: 'oauth' | 'key'
}

export interface ConnectApp {
  id: string
  name: MessageKey
  auth: ConnectAuth
  steps: readonly ConnectStep[]
  notes?: readonly MessageKey[]
  /** The skills download list belongs in this dialog. */
  skills?: boolean
  /** Official help pages (title as the page shows it). */
  help: readonly { title: string; url: string }[]
}

const REPO = 'bluenyang/allot'
const marketplace: ConnectStep = { text: 'connect.step.marketplace', code: () => `/plugin marketplace add ${REPO}` }
const address: ConnectStep = { text: 'connect.step.address', code: (f) => f.url }
const CLAUDE_PLUGINS = { title: 'Install and manage plugins — Claude Code Docs', url: 'https://code.claude.com/docs/en/discover-plugins' }
const CLAUDE_MCP = { title: 'Connect Claude Code to tools via MCP — Claude Code Docs', url: 'https://code.claude.com/docs/en/mcp' }

export const CONNECT_APPS: readonly ConnectApp[] = [
  {
    id: 'claude-code',
    name: 'connect.app.claudeCode',
    auth: 'oauth',
    steps: [
      marketplace,
      { text: 'connect.step.installAllot', code: () => '/plugin install allot@allot' },
      address,
      { text: 'connect.step.consent', mode: 'oauth' },
    ],
    notes: ['connect.note.onePlugin'],
    help: [CLAUDE_PLUGINS],
  },
  {
    id: 'claude-code-key',
    name: 'connect.app.claudeCodeKey',
    auth: 'key',
    steps: [
      marketplace,
      { text: 'connect.step.installAllotKey', code: () => '/plugin install allot-key@allot' },
      address,
      { text: 'connect.step.keyAsked', mode: 'key' },
    ],
    notes: ['connect.note.onePlugin', 'connect.note.makeKey'],
    help: [CLAUDE_PLUGINS],
  },
  {
    id: 'claude-ai',
    name: 'connect.app.claudeAi',
    auth: 'oauth',
    steps: [
      { text: 'connect.step.claudeAiOpen' },
      address,
      { text: 'connect.step.consent', mode: 'oauth' },
      { text: 'connect.step.claudeAiPhone' },
      { text: 'connect.step.claudeAiSkills' },
    ],
    notes: ['connect.note.publicHttps'],
    skills: true,
    help: [
      { title: 'Get started with custom connectors using remote MCP — Claude Help Center', url: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp' },
      { title: 'Use skills in Claude — Claude Help Center', url: 'https://support.claude.com/en/articles/12512180-using-skills-in-claude' },
    ],
  },
  {
    id: 'chatgpt',
    name: 'connect.app.chatgpt',
    auth: 'oauth',
    steps: [
      { text: 'connect.step.chatgptOpen' },
      address,
      { text: 'connect.step.consent', mode: 'oauth' },
    ],
    notes: ['connect.note.chatgptPlans', 'connect.note.publicHttps'],
    help: [{ title: 'Connecting custom MCP servers in ChatGPT — OpenAI Help Center', url: 'https://help.openai.com/en/articles/12584461' }],
  },
  {
    id: 'codex',
    name: 'connect.app.codex',
    auth: 'both',
    steps: [
      { text: 'connect.step.codexMarketplace', code: () => `codex plugin marketplace add ${REPO}` },
      { text: 'connect.step.codexPlugin', code: () => 'codex plugin add allot@allot' },
      { text: 'connect.step.codexOauth', code: (f) => `codex mcp add allot --url ${f.url}`, mode: 'oauth' },
      { text: 'connect.step.codexLogin', code: () => 'codex mcp login allot', mode: 'oauth' },
      { text: 'connect.step.codexKey', code: (f) => `codex mcp add allot --url ${f.url} --bearer-token-env-var ALLOT_API_KEY`, mode: 'key' },
    ],
    notes: ['connect.note.makeKey'],
    help: [
      { title: 'Model Context Protocol — ChatGPT Learn', url: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli' },
      { title: 'Plugins — ChatGPT Learn', url: 'https://learn.chatgpt.com/docs/plugins' },
    ],
  },
  {
    id: 'gemini-cli',
    name: 'connect.app.geminiCli',
    auth: 'both',
    steps: [
      { text: 'connect.step.geminiExtension', code: () => `gemini extensions install https://github.com/${REPO}` },
      { text: 'connect.step.geminiOauth', code: (f) => `gemini mcp add --transport http allot ${f.url}`, mode: 'oauth' },
      { text: 'connect.step.geminiKey', code: (f) => `gemini mcp add --transport http --header "Authorization: Bearer ${f.keyPh}" allot ${f.url}`, mode: 'key' },
    ],
    notes: ['connect.note.geminiMoved', 'connect.note.makeKey'],
    help: [
      { title: 'MCP servers with Gemini CLI', url: 'https://geminicli.com/docs/tools/mcp-server' },
      { title: 'Gemini CLI extensions', url: 'https://geminicli.com/docs/extensions/' },
      { title: 'Transitioning Gemini CLI to Antigravity CLI — Google Developers Blog', url: 'https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli' },
    ],
  },
  {
    id: 'antigravity',
    name: 'connect.app.antigravity',
    auth: 'both',
    steps: [
      { text: 'connect.step.agyClone', code: () => `git clone https://github.com/${REPO}` },
      { text: 'connect.step.agyPlugin', code: () => 'agy plugin install ./allot/plugins/allot' },
      { text: 'connect.step.agyOauth', code: (f) => `agy mcp add allot ${f.url}`, mode: 'oauth' },
      { text: 'connect.step.agyKey', code: (f) => `agy mcp add --header "Authorization: Bearer ${f.keyPh}" allot ${f.url}`, mode: 'key' },
    ],
    notes: ['connect.note.makeKey'],
    help: [
      { title: 'MCP — Google Antigravity Docs', url: 'https://antigravity.google/docs/mcp' },
      { title: 'Plugins — Google Antigravity Docs', url: 'https://antigravity.google/docs/plugins' },
    ],
  },
  {
    id: 'api-key',
    name: 'connect.app.apiKey',
    auth: 'key',
    steps: [
      { text: 'connect.step.keyCommand', code: (f) => `claude mcp add --transport http allot ${f.url} --header "Authorization: Bearer ${f.keyPh}"`, mode: 'key' },
    ],
    notes: ['connect.note.makeKey', 'connect.note.keyScope'],
    help: [CLAUDE_MCP],
  },
  {
    id: 'manual',
    name: 'connect.app.manual',
    auth: 'both',
    steps: [
      address,
      { text: 'connect.step.manualTransport' },
      { text: 'connect.step.manualOauth', code: (f) => `${f.origin}/.well-known/oauth-protected-resource/mcp`, mode: 'oauth' },
      { text: 'connect.step.manualKey', code: (f) => `Authorization: Bearer ${f.keyPh}`, mode: 'key' },
      { text: 'connect.step.manualSkills' },
    ],
    notes: ['connect.note.makeKey'],
    skills: true,
    help: [
      { title: 'Transports — Model Context Protocol', url: 'https://modelcontextprotocol.io/specification/latest/basic/transports' },
      { title: 'Authorization — Model Context Protocol', url: 'https://modelcontextprotocol.io/specification/latest/basic/authorization' },
    ],
  },
]

/** The steps of an app with its codes filled in (pure; the screen and the tests use it). */
export const filled = (app: ConnectApp, f: Fill) => app.steps.map((s) => ({ ...s, value: s.code?.(f) }))

/** OAuth is not possible on this server: the app cannot connect at all (it needs OAuth only). */
export const blockedWithoutOauth = (app: ConnectApp) => app.auth === 'oauth'
