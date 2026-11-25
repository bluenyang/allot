// spec 017 W-1, W-6: the app connection guide — nine apps, every MCP command carries this server's address, a key only
// as the placeholder, example hosts only, https help links, every message key in both languages.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'
import { CONNECT_APPS, blockedWithoutOauth, filled } from '../../src/lib/connect-guide'
import { connectEn } from '../../src/i18n/connect.en'
import { connectKo } from '../../src/i18n/connect.ko'

const F = { url: 'https://allot.example.com/mcp', origin: 'https://allot.example.com', keyPh: '<KEY>' }
const get = (o: unknown, key: string) => key.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], o)

test('nine apps with unique ids: the README apps, the API key way and the manual way (S-1)', () => {
  assert.deepEqual(CONNECT_APPS.map((a) => a.id), ['claude-code', 'claude-code-key', 'claude-ai', 'chatgpt', 'codex', 'gemini-cli', 'antigravity', 'api-key', 'manual'])
})

test('the codes: an MCP command names this address, a key appears only as the placeholder, no other host than the repository (S-2)', () => {
  for (const app of CONNECT_APPS) {
    for (const s of filled(app, F)) {
      if (!s.value) continue
      if (/\bmcp add\b/.test(s.value)) assert.ok(s.value.includes(F.url), `${app.id}: ${s.value}`)
      if (/Bearer/.test(s.value)) assert.ok(s.value.includes('Bearer <KEY>'), `${app.id}: ${s.value}`)
      for (const host of s.value.match(/https?:\/\/[^\s/"]+/g) ?? []) assert.ok(['https://allot.example.com', 'https://github.com'].includes(host), `${app.id}: ${host}`)
    }
  }
})

test('the API key way keeps the command the card showed before rc.3 (S-6)', () => {
  const key = CONNECT_APPS.find((a) => a.id === 'api-key')!
  assert.equal(filled(key, F)[0].value, `claude mcp add --transport http allot ${F.url} --header "Authorization: Bearer <KEY>"`)
})

test('OAuth-only apps are the ones dimmed when OAuth is off: the OAuth plugin, claude.ai and ChatGPT (S-3)', () => {
  assert.deepEqual(CONNECT_APPS.filter(blockedWithoutOauth).map((a) => a.id), ['claude-code', 'claude-ai', 'chatgpt'])
  // an app that takes either has a step for each
  for (const app of CONNECT_APPS.filter((a) => a.auth === 'both')) {
    assert.ok(app.steps.some((s) => s.mode === 'oauth'), app.id)
    assert.ok(app.steps.some((s) => s.mode === 'key'), app.id)
  }
})

test('help links are https and each app has at least one (S-2)', () => {
  for (const app of CONNECT_APPS) {
    assert.ok(app.help.length > 0, app.id)
    for (const h of app.help) assert.match(h.url, /^https:\/\//, app.id)
  }
})

test('every message key of the guide exists in Korean and English', () => {
  for (const app of CONNECT_APPS) {
    for (const key of [app.name, ...app.steps.map((s) => s.text), ...(app.notes ?? [])]) {
      assert.equal(typeof get(connectKo, key), 'string', `ko ${key}`)
      assert.equal(typeof get(connectEn, key), 'string', `en ${key}`)
    }
  }
})

test('a skill name for every folder in skills/ (the download list, S-4)', () => {
  const dirs = readdirSync(new URL('../../skills', import.meta.url)).sort()
  assert.deepEqual(Object.keys(connectKo.connect.skills.names).sort(), dirs)
  assert.deepEqual(Object.keys(connectEn.connect.skills.names).sort(), dirs)
})
