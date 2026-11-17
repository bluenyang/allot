import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// @ts-expect-error plain .mjs without types
import { parse, decide } from '../../scripts/guard-review.mjs'

const script = resolve('scripts/guard-review.mjs')

test('parse: chained create with --head', () => {
  assert.deepEqual(parse('git push && gh pr create --base master --head x'), { kind: 'create', arg: null, head: 'x' })
})
test('parse: merge with extra spaces', () => {
  assert.deepEqual(parse('gh  pr   merge 24 --merge'), { kind: 'merge', arg: '24', head: null })
})
test('parse: unrelated commands are null', () => {
  assert.equal(parse('gh pr view 24').kind, null)
  assert.equal(parse('echo gh pr list').kind, null)
  assert.equal(parse('ghx pr create').kind, null)
})
test('decide: no record blocks, equal allows, different blocks', () => {
  const command = 'gh pr create'
  assert.match(decide({ command, branch: 'b', headSha: 'aaa', recorded: null }), /recorded none/)
  assert.equal(decide({ command, branch: 'b', headSha: 'aaa', recorded: 'aaa' }), null)
  assert.match(decide({ command, branch: 'b', headSha: 'bbb', recorded: 'aaa' }), /aaa\.\.bbb/)
  assert.equal(decide({ command: 'git status', branch: 'b', headSha: 'bbb', recorded: null }), null)
})

test('--mark and hook mode in a temp repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-review-'))
  try {
    const run = (cmd: string, args: string[], input?: string) =>
      spawnSync(cmd, args, { cwd: dir, input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } })
    const git = (...a: string[]) => {
      const r = run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a])
      assert.equal(r.status, 0, r.stderr)
      return r.stdout.trim()
    }
    git('init', '-q', '-b', 'feat/x')
    writeFileSync(join(dir, 'a'), '1')
    git('add', 'a')
    git('commit', '-q', '-m', 'one')
    const hook = () => run('node', [script], JSON.stringify({ tool_input: { command: 'git push && gh pr create --base master' } }))
    assert.equal(hook().status, 2) // no record
    const m = run('node', [script, '--mark'])
    assert.equal(m.status, 0, m.stderr)
    const first = git('rev-parse', 'HEAD')
    assert.match(m.stdout, new RegExp(first))
    assert.equal(hook().status, 0)
    assert.equal(run('node', [script], JSON.stringify({ tool_input: { command: 'git status' } })).status, 0)
    assert.equal(run('node', [script], 'not json').status, 0)
    writeFileSync(join(dir, 'a'), '2')
    git('commit', '-q', '-am', 'two')
    const second = git('rev-parse', 'HEAD')
    const blocked = hook()
    assert.equal(blocked.status, 2)
    assert.ok(blocked.stderr.includes(`${first.slice(0, 12)}..${second.slice(0, 12)}`), blocked.stderr)
    assert.equal(run('node', [script, '--mark', 'feat/x', 'deadbeef']).status, 1) // unknown sha
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
