// scripts/session-start.mjs: the SessionStart hook prints the personal delegation section or the fallback.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const script = join(root, 'scripts/session-start.mjs')
const scratch = join(root, '.loctx')

const run = (dir: string) =>
  spawnSync('node', [script], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })

const sample = [
  '# Personal delegation table',
  '',
  'SECRET-PREAMBLE do not print',
  '',
  '## Delegation',
  '',
  'Mode: **multi**',
  '',
  '| role | model |',
  '|---|---|',
  '| pl/code-reviewer | x |',
  '',
  '## Other',
  '',
  'SECRET-AFTER do not print',
  '',
].join('\n')

test('with a delegation file: the header and the Delegation section only', () => {
  mkdirSync(scratch, { recursive: true })
  const dir = mkdtempSync(join(scratch, 'ss-'))
  try {
    mkdirSync(join(dir, '.loctx'))
    writeFileSync(join(dir, '.loctx', 'delegation.local.md'), sample)
    writeFileSync(join(dir, '.loctx', 'other.md'), 'SECRET-OTHER-FILE\n')
    const r = run(dir)
    assert.equal(r.status, 0)
    assert.ok(r.stdout.startsWith("This machine's delegation table (.loctx/delegation.local.md) — it replaces the table in AGENTS.md:\n"))
    assert.ok(r.stdout.includes('## Delegation\n\nMode: **multi**\n\n| role | model |\n|---|---|\n| pl/code-reviewer | x |'))
    assert.ok(!r.stdout.includes('SECRET'), r.stdout)
    assert.ok(!r.stdout.includes('## Other'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('without a delegation file: the fallback line', () => {
  mkdirSync(scratch, { recursive: true })
  const dir = mkdtempSync(join(scratch, 'ss-'))
  try {
    const r = run(dir)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, 'No personal delegation table: follow the Delegation block in AGENTS.md.\n')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a file with no Delegation section prints the fallback, never the file', () => {
  mkdirSync(scratch, { recursive: true })
  const dir = mkdtempSync(join(scratch, 'ss-'))
  try {
    mkdirSync(join(dir, '.loctx'))
    writeFileSync(join(dir, '.loctx', 'delegation.local.md'), '# x\nSECRET\n')
    const r = run(dir)
    assert.equal(r.status, 0)
    assert.ok(!r.stdout.includes('SECRET'))
    assert.ok(r.stdout.startsWith('No personal delegation table'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
