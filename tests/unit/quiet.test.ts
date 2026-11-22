// scripts/test-server/quiet.mjs: the command's output is discarded; only a fixed line and its exit status remain.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve(import.meta.dirname, '../../scripts/test-server/quiet.mjs')
const quiet = (...a: string[]) => spawnSync('node', [script, ...a], { encoding: 'utf8' })

test('output of the command is discarded, its exit status is kept', () => {
  const r = quiet('node', '-e', "console.log('SECRET');console.error('SECRET');process.exit(3)")
  assert.equal(r.status, 3)
  assert.equal(r.stdout, 'node … exit=3\n')
  assert.ok(!r.stdout.includes('SECRET') && !r.stderr.includes('SECRET'))
  assert.ok(!r.stdout.includes('console.log'), 'argument values are not printed')
})
test('a passing command exits 0', () => {
  const r = quiet('node', '-e', '0')
  assert.equal(r.status, 0)
  assert.equal(r.stdout, 'node … exit=0\n')
})
test('a command that cannot start exits 1; no command is a usage error', () => {
  assert.equal(quiet('/nonexistent/prog-x').status, 1)
  assert.equal(quiet().status, 2)
})
