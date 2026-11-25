// spec 015 W-8: the Claude Code plugins carry a copy of skills/ (scripts/plugins-sync.mjs); a skill edited in one
// place only fails here. Every skill is agentskills.io SKILL.md with only `name` (its folder) and `description`.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

const ROOT = new URL('../..', import.meta.url).pathname
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : [p]
})
const tree = (dir: string) => Object.fromEntries(files(dir).map((f) => [relative(dir, f), readFileSync(f, 'utf8')]))

test('each plugin carries exactly the shared skills', () => {
  const source = tree(join(ROOT, 'skills'))
  for (const p of ['allot', 'allot-key']) assert.deepEqual(tree(join(ROOT, 'plugins', p, 'skills')), source, `plugins/${p}/skills differs from skills/: run node scripts/plugins-sync.mjs`)
})

test('each plugin carries the repository LICENSE (an installed plugin is its own folder)', () => {
  const lic = readFileSync(join(ROOT, 'LICENSE'), 'utf8')
  for (const p of ['allot', 'allot-key']) assert.equal(readFileSync(join(ROOT, 'plugins', p, 'LICENSE'), 'utf8'), lic, `plugins/${p}/LICENSE differs: run node scripts/plugins-sync.mjs`)
})

test('every skill names itself after its folder and has only name and description', () => {
  const dirs = readdirSync(join(ROOT, 'skills'))
  assert.equal(dirs.length, 7)
  for (const d of dirs) {
    const md = readFileSync(join(ROOT, 'skills', d, 'SKILL.md'), 'utf8')
    const front = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1] ?? ''
    const keys = front.split('\n').map((l) => l.split(':')[0]!.trim())
    assert.deepEqual(keys, ['name', 'description'], d)
    assert.match(front, new RegExp(`^name: ${d}$`, 'm'), d)
    assert.ok(!/^(claude|anthropic)-/.test(d), d)
    assert.ok((/^description: (.+)$/m.exec(front)?.[1] ?? '').length <= 1024, `${d}: description too long`)
  }
})

test('the plugins and the marketplace agree on names; the OAuth plugin sends no header', () => {
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')) as { plugins: { name: string; source: string }[] }
  for (const p of market.plugins) {
    const m = JSON.parse(readFileSync(join(ROOT, p.source, '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string; version: string; mcpServers: Record<string, { url: string; headers?: Record<string, string> }> }
    assert.equal(m.name, p.name)
    assert.match(m.version, /^\d+\.\d+\.\d+$/, `${p.name} version ${m.version}`)
    // the OAuth plugin sends no header: with any header Claude Code does not start OAuth (spec 015 S-14)
    if (p.name === 'allot') assert.equal(m.mcpServers.allot?.headers, undefined)
    else assert.equal(m.mcpServers.allot?.headers?.Authorization, 'Bearer ${user_config.api_key}')
  }
})


test('the Gemini extension: its context file exists and it brings no MCP server (added with gemini mcp add)', () => {
  const ext = JSON.parse(readFileSync(join(ROOT, 'gemini-extension.json'), 'utf8')) as { name: string; version: string; contextFileName: string; mcpServers?: unknown }
  assert.equal(ext.name, 'allot')
  assert.match(ext.version, /^\d+\.\d+\.\d+$/)
  assert.ok(statSync(join(ROOT, ext.contextFileName)).isFile())
  assert.equal(ext.mcpServers, undefined)
})
