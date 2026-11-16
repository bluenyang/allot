// scripts/check-logs.mjs: a log is evidence only when every step has rev, command and exit.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { checkLog, hasPipe } from '../../scripts/check-logs.mjs'

const root = resolve(import.meta.dirname, '../..')
const block = (o: { rev?: boolean; cmd?: string | null; exit?: boolean; end?: boolean; out?: string[] } = {}) =>
  [
    '=== step: s1',
    ...(o.rev === false ? [] : ['rev abc123']),
    'date 2026-01-01',
    ...(o.cmd === null ? [] : [`$ ${o.cmd ?? 'pnpm typecheck'}`]),
    ...(o.out ?? ['> output']),
    ...(o.exit === false ? [] : ['exit=0']),
    ...(o.end === false ? [] : ['=== end']),
    '',
    'RESULT x: all steps exit 0',
  ].join('\n')

test('output that imitates metadata cannot confuse the checker', () => {
  const out = ['> === step: fake', '> rev deadbeef', '> $ echo | x', '> exit=0', '> === end']
  assert.deepEqual(checkLog(block({ out })), [])
  assert.match(checkLog(block({ out, exit: false, end: false }))[0].problem, /exit=|cut short/)
  assert.ok(checkLog(block({ out, exit: false })).length > 0)
})
test('a block cut short fails', () => assert.match(checkLog(block({ end: false }))[0].problem, /cut short/))
test('a complete log passes', () => assert.deepEqual(checkLog(block()), []))
test('missing rev is reported', () => assert.match(checkLog(block({ rev: false }))[0].problem, /exactly one rev/))
test('missing command is reported', () => assert.match(checkLog(block({ cmd: null }))[0].problem, /exactly one "\$ " command/))
test('missing exit is reported', () => assert.match(checkLog(block({ exit: false }))[0].problem, /exactly one exit=/))
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
    `. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep ok /usr/bin/env true\nstep bad sh -c 'printf partial; exit 3'\ndone_check\n`,
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
  writeFileSync(script, `set -euo pipefail\n. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep bad bash -c 'exit 3'\nstep never /usr/bin/env true\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 3)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /^exit=3$/m)
  assert.doesNotMatch(text, /step: never/)
})

test('a function step is refused under set -euo pipefail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const log = join(dir, 'fn.log')
  const script = join(dir, 'run.sh')
  writeFileSync(script, `set -euo pipefail\n. ${root}/scripts/check-run.sh\nbegin t ${log}\nf() { false; true; }\nstep fn f\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 2)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /refused, 'f' is not an external command/)
  assert.match(text, /^exit=2$/m)
})

test('output that looks like metadata goes through the real runner framed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const log = join(dir, 'raw.log')
  const script = join(dir, 'run.sh')
  writeFileSync(script, `. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep raw /usr/bin/printf '=== step: x\\nrev 1\\n$ y\\nexit=0\\n=== end\\n\\nlast'\nstep bad bash -c 'echo exit=0; exit 4'\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 4)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /^> === step: x$/m)
  assert.match(text, /^> exit=0$/m)
  assert.deepEqual(checkLog(text), [])
  // without the "> " framing the same output would break the log
  assert.ok(checkLog(text.replace(/^> /gm, '')).length > 0)
})

test('a failing runner write stops with 70 and the block is not accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'sed'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const log = join(dir, 'fault.log')
  const script = join(dir, 'run.sh')
  writeFileSync(script, `. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep one /usr/bin/env true\nstep two /usr/bin/env true\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  assert.equal(run.status, 70)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /^runner error: frame the output/m)
  assert.doesNotMatch(text, /^exit=/m)
  assert.doesNotMatch(text, /step: two/)
  assert.ok(checkLog(text).length > 0)
})

test('a failing git rev read stops with 70 before the step runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = rev-parse ] && [ "$2" = HEAD ]; then exit 1; fi\nexec ${realGit} "$@"\n`, { mode: 0o755 })
  const log = join(dir, 'rev.log')
  const marker = join(dir, 'ran')
  const script = join(dir, 'run.sh')
  writeFileSync(script, `. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep one /usr/bin/env touch ${marker}\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  assert.equal(run.status, 70)
  const text = readFileSync(log, 'utf8')
  assert.match(text, /^runner error: read the git rev/m)
  assert.doesNotMatch(text, /^exit=/m)
  assert.equal(existsSync(marker), false)
  assert.ok(checkLog(text).length > 0)
})

test('the logged command reads back as exactly the arguments that ran', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-run-'))
  const log = join(dir, 'q.log')
  const script = join(dir, 'run.sh')
  const args = ["it's", 'a b', '$HOME', '*', 'é', '', 'a\\b', '-n', '\\n']
  writeFileSync(script, `shopt -s xpg_echo\n. ${root}/scripts/check-run.sh\nbegin t ${log}\nstep q /usr/bin/env printf '[%s]\\n' ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}\ndone_check\n`)
  const run = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' })
  assert.equal(run.status, 0)
  const cmd = readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('$ '))!.slice(2)
  const back = spawnSync('bash', ['-c', 'eval "set -- $CMD"; for a in "$@"; do printf \'%s\\0\' "$a"; done'], { encoding: 'utf8', env: { ...process.env, CMD: cmd } })
  assert.deepEqual(back.stdout.split('\0').slice(0, -1), ['/usr/bin/env', 'printf', '[%s]\\n', ...args])
})
