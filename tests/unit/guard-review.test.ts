import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// @ts-expect-error plain .mjs without types
import { parse, decide, recordFile } from '../../scripts/guard-review.mjs'

const script = resolve('scripts/guard-review.mjs')

test('parse: canonical forms', () => {
  const c = parse('git push && gh pr create --base master --head x')
  assert.deepEqual([c.kind, c.head, c.problems], ['create', 'x', []])
  assert.equal(parse('gh  pr   merge 24 --merge').arg, '24')
  assert.equal(parse('gh pr merge --body "x y" feat/a').arg, 'feat/a')
})
test('parse: unrelated commands are null', () => {
  for (const c of ['gh pr view 24', 'echo gh pr list', 'ghx pr create', 'git status']) {
    const p = parse(c)
    assert.deepEqual([p.kind, p.problems], [null, []], c)
  }
})
test('parse: bypass forms are problems', () => {
  for (const c of [
    'gh -R other/repo pr merge 24',
    'gh pr merge 24 -R other/repo',
    'GH_REPO=o/r gh pr merge 24',
    'GH_HOST=h gh pr create',
    'gh api -X PUT repos/o/r/pulls/24/merge',
    'gh api repos/o/r/pulls -f title=x',
    'gh pr merge 24; gh pr merge 25',
    'gh pr merge 24\ngh pr merge 25',
    'cd /elsewhere && gh pr merge 24',
    'pushd /elsewhere; gh pr create',
  ]) assert.ok(parse(c).problems.length > 0, c)
})
test('parse: backslash-newline continuation is joined', () => {
  assert.equal(parse('gh pr \\\n merge 24').kind, 'merge')
})
test('decide: no record blocks, equal allows, different blocks', () => {
  const command = 'gh pr create'
  assert.match(decide({ command, branch: 'b', headSha: 'aaa', recorded: null }), /recorded none/)
  assert.equal(decide({ command, branch: 'b', headSha: 'aaa', recorded: 'aaa' }), null)
  assert.match(decide({ command, branch: 'b', headSha: 'bbb', recorded: 'aaa' }), /aaa\.\.bbb/)
  assert.equal(decide({ command: 'git status', branch: 'b', headSha: 'bbb', recorded: null }), null)
  assert.match(decide({ command: 'gh -R o/r pr merge 1', branch: 'b', headSha: 'a', recorded: 'a' }), /-R/)
})
test('recordFile: feat/a and feat__a do not collide', () => {
  assert.notEqual(recordFile('/p', 'feat/a'), recordFile('/p', 'feat__a'))
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'guard-review-'))
  const dir = join(root, 'work')
  const origin = join(root, 'owner1', 'repo.git')
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, GUARD_REVIEW_GH: join(root, 'fakegh') }
  const sh = (cwd: string, cmd: string, args: string[], input?: string, e = env) =>
    spawnSync(cmd, args, { cwd, input, encoding: 'utf8', env: e })
  const git = (...a: string[]) => {
    const r = sh(dir, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a])
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  assert.equal(sh(root, 'git', ['init', '-q', '--bare', origin]).status, 0)
  assert.equal(sh(root, 'git', ['init', '-q', '-b', 'feat/x', dir]).status, 0)
  git('remote', 'add', 'origin', origin)
  writeFileSync(join(dir, 'a'), '1')
  git('add', 'a')
  git('commit', '-q', '-m', 'one')
  // fake gh: prints $FAKE_GH_OUT, exits $FAKE_GH_EXIT
  writeFileSync(join(root, 'fakegh'), '#!/bin/sh\nprintf "%s" "$FAKE_GH_OUT"\nexit "${FAKE_GH_EXIT:-0}"\n')
  chmodSync(join(root, 'fakegh'), 0o755)
  const hook = (command: string | null, extra: Record<string, string> = {}) =>
    sh(dir, 'node', [script], JSON.stringify({ tool_input: command === null ? {} : { command } }), { ...env, ...extra })
  const commit = (n: string) => { writeFileSync(join(dir, 'a'), n); git('commit', '-q', '-am', n); return git('rev-parse', 'HEAD') }
  return { root, dir, env, sh, git, hook, commit }
}

test('create: --mark and hook against a bare origin', () => {
  const t = setup()
  try {
    const create = 'git push && gh pr create --base master'
    assert.equal(t.hook(create).status, 2) // not pushed
    t.git('push', '-q', 'origin', 'feat/x')
    assert.equal(t.hook(create).status, 2) // pushed, no record
    const m = t.sh(t.dir, 'node', [script, '--mark'])
    assert.equal(m.status, 0, m.stderr)
    const first = t.git('rev-parse', 'HEAD')
    assert.match(m.stdout, new RegExp(first))
    assert.equal(t.hook(create).status, 0)
    assert.equal(t.hook('git status').status, 0)
    assert.equal(t.hook(null).status, 0) // no command field
    // local ahead of origin: local != remote
    const second = t.commit('2')
    const ahead = t.hook(create)
    assert.equal(ahead.status, 2)
    assert.match(ahead.stderr, /differs from origin/)
    // pushed but unreviewed: the range is named
    t.git('push', '-q', 'origin', 'feat/x')
    const blocked = t.hook(create)
    assert.equal(blocked.status, 2)
    assert.ok(blocked.stderr.includes(`${first.slice(0, 12)}..${second.slice(0, 12)}`), blocked.stderr)
    // other owner in --head
    assert.equal(t.hook('gh pr create --head someone:feat/x').status, 2)
    assert.equal(t.hook('gh pr create --head owner1:feat/x').status, 2) // owner ok, but unreviewed
    // reviewed local branch at A must not authorise a remote at B (covered above); bypass forms
    for (const c of ['gh -R o/r pr create', 'GH_REPO=o/r gh pr create', 'gh api -X POST repos/o/r/pulls', 'gh pr create \\\n --head x; gh pr create']) {
      assert.equal(t.hook(c).status, 2, c)
    }
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})

test('malformed stdin: PR text blocks, other text allows', () => {
  const t = setup()
  try {
    assert.equal(t.sh(t.dir, 'node', [script], 'not json', t.env).status, 0)
    assert.equal(t.sh(t.dir, 'node', [script], 'not json gh pr merge 5', t.env).status, 2)
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})

test('--mark: branch must exist, sha must be tip or ancestor', () => {
  const t = setup()
  try {
    const first = t.git('rev-parse', 'HEAD')
    t.commit('2')
    t.git('branch', 'other', first)
    t.git('checkout', '-q', '--orphan', 'unrelated')
    writeFileSync(join(t.dir, 'b'), 'x'); t.git('add', 'b'); t.git('commit', '-q', '-m', 'orphan')
    const orphan = t.git('rev-parse', 'HEAD')
    t.git('checkout', '-q', 'feat/x')
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', 'feat/x', first]).status, 0) // ancestor
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', 'feat/x', orphan]).status, 1) // unrelated
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', 'nope']).status, 1) // no branch
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', 'feat/x', 'deadbeef']).status, 1)
    // feat/a and feat__a keep separate records
    t.git('branch', 'feat/a'); t.git('branch', 'feat__a', first)
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', 'feat/a']).status, 0)
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', 'feat__a']).status, 0)
    assert.notEqual(recordFile(t.dir, 'feat/a'), recordFile(t.dir, 'feat__a'))
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})

test('merge: fake gh decides the head', () => {
  const t = setup()
  try {
    const head = t.git('rev-parse', 'HEAD')
    const out = (o: object) => ({ FAKE_GH_OUT: JSON.stringify(o) })
    const view = { headRefName: 'feat/x', headRefOid: head, isCrossRepository: false }
    assert.equal(t.hook('gh pr merge 24 --merge', out(view)).status, 2) // unreviewed
    assert.equal(t.sh(t.dir, 'node', [script, '--mark']).status, 0)
    assert.equal(t.hook('gh pr merge 24 --merge', out(view)).status, 0) // reviewed
    assert.equal(t.hook('gh pr merge 24', out({ ...view, headRefOid: 'f'.repeat(40) })).status, 2) // moved
    assert.equal(t.hook('gh pr merge 24', out({ ...view, isCrossRepository: true })).status, 2)
    assert.equal(t.hook('gh pr merge 24', out({ headRefName: 'feat/x', headRefOid: head })).status, 2) // missing field
    assert.equal(t.hook('gh pr merge 24', { FAKE_GH_OUT: '', FAKE_GH_EXIT: '1' }).status, 2) // gh fails
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})
