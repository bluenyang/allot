// scripts/check-logs.mjs: a log is evidence only when every step has rev, command and exit.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { checkLog, hasPipe } from '../../scripts/check-logs.mjs'

const root = resolve(import.meta.dirname, '../..')
const block = (o: { rev?: boolean; cmd?: string | null; exit?: boolean } = {}) =>
  [
    '=== step: s1',
    ...(o.rev === false ? [] : ['rev abc123']),
    'date 2026-01-01',
    ...(o.cmd === null ? [] : [`$ ${o.cmd ?? 'pnpm typecheck'}`]),
    'output',
    ...(o.exit === false ? [] : ['exit=0']),
    '',
    'RESULT x: all steps exit 0',
  ].join('\n')

test('a complete log passes', () => assert.deepEqual(checkLog(block()), []))
test('missing rev is reported', () => assert.match(checkLog(block({ rev: false }))[0].problem, /no rev/))
test('missing command is reported', () => assert.match(checkLog(block({ cmd: null }))[0].problem, /no command/))
test('missing exit is reported', () => assert.match(checkLog(block({ exit: false }))[0].problem, /no exit=/))
test('a piped command is reported', () => assert.match(checkLog(block({ cmd: 'pnpm test | tail' }))[0].problem, /pipe/))
test('a quoted pipe is reported too', () => {
  assert.match(checkLog(block({ cmd: "sh -c 'false | true'" }))[0].problem, /pipe/)
  assert.match(checkLog(block({ cmd: "grep -E 'a|b' file" }))[0].problem, /pipe/)
  assert.equal(hasPipe('a | b'), true)
  assert.equal(hasPipe('grep -e a -e b'), false)
})
test('check-run.sh refuses a step with a pipe and logs it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const log = join(dir, 'pipe.log')
  const script = join(dir, 'run.sh')
  writeFileSync(script, `. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep p sh -c 'false | true'\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 2)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /refused/)
  assert.match(text, /^exit=2$/m)
})
test('a file without step blocks is not a runner log', () => {
  assert.match(checkLog('crud-create: exit=0\n')[0].problem, /not a runner log/)
})

test('a log made by check-run.sh passes the checker and records the failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const log = join(dir, 'out.log')
  const script = join(dir, 'run.sh')
  writeFileSync(
    script,
    `. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep ok true\nstep bad sh -c 'printf partial; exit 3'\ndone_check\n`,
  )
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 3)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /^exit=3$/m)
  assert.doesNotMatch(text, /RESULT t: all steps exit 0/)
  assert.match(text, /RESULT t: fail/)
  assert.deepEqual(checkLog(text), [])
  const cli = spawnSync('node', ['scripts/check-logs.mjs', log], { cwd: root, encoding: 'utf8' })
  assert.equal(cli.status, 0)
})

test('check-run.sh under set -euo pipefail still logs the failing exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const log = join(dir, 'strict.log')
  const script = join(dir, 'run.sh')
  writeFileSync(script, `set -euo pipefail\n. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep bad bash -c 'exit 3'\nstep never true\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 3)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /^exit=3$/m)
  assert.doesNotMatch(text, /step: never/)
})
