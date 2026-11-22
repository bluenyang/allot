import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// @ts-expect-error plain .mjs without types
import { check, isCandidate, tokenize, decide, recordFile } from '../../scripts/guard-review.mjs'
import { gitFreeEnv } from './git-env'

const script = resolve('scripts/guard-review.mjs')

test('check: canonical forms pass', () => {
  assert.deepEqual(check('gh pr create --base master --head x --title "a b" --draft'), { kind: 'create', arg: null, head: 'x' })
  assert.deepEqual(check("gh  pr   merge 24 --merge --subject 's t' --delete-branch"), { kind: 'merge', arg: '24', head: null })
  assert.equal(check('gh pr mer\\ge 24').kind, 'merge') // the shell runs merge, so it is checked as merge
})
test('check: every other form is an error that names the allowed forms', () => {
  for (const c of [
    '/usr/bin/gh pr merge 24', 'gh -R other/repo pr merge 24', 'gh -Rother/repo pr merge 24', 'gh pr merge 24 -R other/repo',
    'GH_REPO=o/r gh pr merge 24', 'GH_HOST=h gh pr create --head x', 'gh pr create -Hother', 'gh pr create -H other', 'gh pr create --head=x',
    'gh pr create --head owner:x', 'gh pr create', 'gh pr create --head x --fill', 'gh pr create --head x --head y',
    'git push x && gh pr merge 24', 'gh pr merge 24; gh pr merge 25', 'gh pr merge 24\ngh pr merge 25', 'gh pr merge 24 | cat',
    'cd /e && gh pr merge 24', 'gh pr merge $(echo 24)', 'gh pr merge 24 `x`', 'gh pr merge 24 > f', 'gh pr merge "24', "gh pr merge '24",
    'gh pr merge feat/a', 'gh pr merge', 'gh pr merge 24 --admin', 'gh pr merge 24 --subject', 'gh pr merge https://x/pull/24',
    'gh api --raw-field=title=x repos/o/r/pulls', 'gh api -X PUT repos/o/r/pulls/24/merge', 'gh pr create \\\n --head x',
  ]) {
    const r = check(c)
    assert.ok(r.error?.includes('Allowed forms'), c)
  }
})
test('isCandidate: raw text, quotes and backslashes removed', () => {
  for (const c of ['gh pr mer\\ge 24', 'gh api --raw-field=t=x repos/o/r/pulls', '"gh" "pr" "merge"', '{"tool_input":{"command":"gh pr merge 24"}'])
    assert.equal(isCandidate(c), true, c)
  for (const c of ['git push -u origin x', 'gh pr view 24', 'gh pr checks 24', 'gh pr edit 24 --body-file f', 'gh pr close 22', 'git commit -F msg.txt', 'echo hi', '{}', 'not json'])
    assert.equal(isCandidate(c), false, c)
})
test('isCandidate: shell-quoting variants of merge and unknown gh pr subcommands', () => {
  for (const c of ["gh $'pr' view 24", "gh $'\\x70r' view 24", "gh pr $'\\155erge' 24", "gh pr $'\\x6derge' 24", 'gh pr ${x}ge 24', "gh pr me''rge 24", 'gh pr $(echo merge) 24', 'gh pr "merge" 24', 'gh pr $"merge" 24'])
    for (const raw of [c, JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } })]) assert.equal(isCandidate(raw), true, raw)
  for (const c of ['git push -u origin x', 'gh pr view 24', 'gh pr checks 24', 'gh pr edit 24 --body-file f', 'gh pr close 22', 'gh pr comment 24 --body-file f', 'gh pr list', 'git commit -F msg.txt', "printf '%s\\n' x"])
    for (const raw of [c, JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } })]) assert.equal(isCandidate(raw), false, raw)
})
test('check: quoting variants never pass as an allowed form', () => {
  for (const c of ["gh pr $'\\155erge' 24", "gh pr $'\\x6derge' 24", 'gh pr ${x}ge 24', 'gh pr $(echo merge) 24'])
    assert.ok(check(c).error, c)
  assert.equal(check("gh pr me''rge 24").kind, 'merge') // the shell runs merge: goes through the review check
  assert.equal(check('gh pr "merge" 24').kind, 'merge')
})
const asInput = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } })

test('isCandidate: text that only mentions a PR operation is data (false positives of 0.1.4)', () => {
  for (const c of [
    'echo "run gh pr edit 28 then gh pr merge 28 later" > prompt.md',
    "printf '%s\\n' 'gh pr create --head x' >> notes.md",
    "python3 - <<'EOF'\nprint(\"PR 28 ready to merge, create the notes\")\nEOF",
    'cat > prompt.md <<EOF\nPlease gh pr merge 24 after review\nEOF',
    'codex exec --model m - < prompt.md', // not plain data, but its text has no PR operation
    'cat <<-EOF > f\n\tgh pr merge 24\n\tEOF',
    "grep -n '^codex$' list.txt",
    'grep -c "$" file.txt',
    'git commit -m "docs: explain gh pr merge and gh pr create flow"',
    'echo hi # gh pr merge 24',
    'gh pr comment 24 --body "ready to merge, then gh pr create the next one"',
    'gh pr view 24 --json state --jq ".state"',
    'echo $(gh pr view 24 --json state) "merge"',
  ]) assert.equal(isCandidate(asInput(c)), false, c)
})
test('isCandidate: command words are found behind separators, wrappers, substitutions and shells', () => {
  for (const c of [
    'git push x && gh pr merge 24', 'echo x; gh pr create --head x', 'echo x | gh pr merge 24', 'echo x\ngh pr merge 24',
    '(gh pr merge 24)', 'if true; then gh pr merge 24; fi', 'for n in 1 2; do gh pr merge $n; done', 'x=1 gh pr merge 24',
    '/usr/bin/gh pr merge 24', 'env GH_REPO=o/r gh pr merge 24', 'command gh pr merge 24', 'sudo -u x gh pr create --head b',
    'xargs -I{} gh pr merge {}', 'timeout 5 gh pr merge 24', 'gh -R o/r pr merge 24', 'gh --repo o/r pr create --head b', 'gh pr -R o/r merge 24',
    'sh -c "gh pr merge 24"', "bash -c 'git push x && gh pr merge 24'", 'eval "gh pr merge 24"', 'eval gh pr merge 24', 'env bash -c "gh pr merge 24"',
    "bash <<'EOF'\ngh pr merge 24\nEOF", 'bash <<< "gh pr merge 24"', 'cat <<EOF\n$(gh pr merge 24)\nEOF',
    'echo "$(gh pr merge 24)"', 'echo `gh pr merge 24`', 'echo "${x:-$(gh pr create --head b)}"',
    'gh pr review 24', 'gh pr update-branch 24', 'gh api -X PUT repos/o/r/pulls/24/merge', 'gh api repos/o/r/pulls', 'gh api repos/o/r/pulls/24/merge -X PUT',
    'gh pr ${x}ge 24', 'gh pr $(echo merge) 24', "gh pr $'\\155erge' 24", 'gh $x pr merge 24','"gh" "pr" "merge" 24',
    'gh\npr\nmerge 24', 'g\\\nh pr merge 24',
  ]) assert.equal(isCandidate(asInput(c)), true, c)
})
test('isCandidate: launchers, redirections and wrappers are scanned, not treated as data (review of 0.1.4 guards)', () => {
  for (const c of [
    '2>/dev/null gh pr merge 1', '2> /dev/null gh pr merge 1', '>/dev/null 2>&1 gh pr merge 1', '< /dev/null gh pr create --head b', '>&2 gh pr merge 1',
    'find . -exec gh pr merge 1 \\;', 'find . -name x -exec gh pr create --head b {} +', 'pnpm exec gh pr merge 1', 'npx gh pr merge 1',
    "script -qc 'gh pr merge 1' /dev/null", "git -c alias.x='!gh pr merge 1' x", 'git -c alias.x="!gh pr merge 1" x',
    `python3 -c 'import os; os.system("gh pr merge 1")'`, "node -e 'require(\"child_process\").execSync(\"gh pr merge 1\")'",
    "perl -e 'system(\"gh pr merge 1\")'", "ruby -e 'system(\"gh pr merge 1\")'",
    "python3 - <<'EOF'\nimport os\nos.system('gh pr merge 1')\nEOF", "node <<'EOF'\nrequire('child_process').execSync('gh pr merge 1')\nEOF",
    'sudo -u root gh pr merge 1', 'env -u X gh pr merge 1', 'env -i PATH=/usr/bin gh pr merge 1', 'xargs -I X gh pr merge X', 'timeout 5 gh pr merge 1', 'nice -n 5 gh pr merge 1',
    'ssh host gh pr merge 1', 'docker exec c gh pr merge 1', 'watch -n1 gh pr merge 1', 'time gh pr merge 1', 'nohup gh pr merge 1 &',
    'echo x | sh -c "gh pr merge 1"', 'bash -lc "gh pr merge 1"', 'zsh -c "gh pr create --head b"', 'source <(echo "gh pr merge 1")',
    'echo "gh pr merge 1" | sh', 'printf "gh pr merge 1\\n" | bash -s', 'cat <<EOF | sh\ngh pr merge 1\nEOF', 'echo "gh pr merge 1" | python3',
    'echo ok && echo "$(gh pr merge 1)"', 'printf x > f; gh pr merge 1',
  ]) assert.equal(isCandidate(asInput(c)), true, c)
})
test('isCandidate: codex exec is an executor, not data; malformed input is refused (third review)', () => {
  for (const c of [
    "printf '%s\\n' 'Run gh pr merge 1' > prompt.md; codex exec - < prompt.md", "codex exec -- 'Run gh pr merge 1' < prompt.md",
    "printf 'Run gh pr merge 1' > prompt.md; codex exec --sandbox danger-full-access - < prompt.md", 'codex exec "gh pr create --head b"',
    'echo "unterminated', "echo 'unterminated", 'echo $(unterminated', 'echo `unterminated', 'echo ${unterminated', "echo $'unterminated",
  ]) assert.equal(isCandidate(asInput(c)), true, c)
  for (const c of ['echo "unterminated', "echo 'x", 'echo $(x', 'echo ${x']) assert.ok(check(c).error, c) // so the hook exits 2
})
test('isCandidate: data that flows into an executor, or a data command with an execution context, is scanned (second review)', () => {
  for (const c of [
    "echo 'gh pr merge 1' | awk '{system($0)}'", 'echo gh pr | xargs -I{} {} merge 1', "printf 'gh pr merge 1' | tee f; chmod +x f; ./f",
    "echo 'gh pr merge 1' > f; env sh f", "echo 'gh pr merge 1' > f; sudo -u root sh f", "echo 'gh pr merge 1' | xargs -I{} sh -c {}", "echo 'gh pr merge 1' | xargs sh",
    "printf 'gh pr merge 1' > x; rg --pre sh x f", "GIT_EDITOR='gh pr merge 1' git commit", "GIT_SEQUENCE_EDITOR='gh pr merge 1' git commit -m x", "PAGER='gh pr merge 1' git commit -m x",
    "GH_EDITOR='gh pr merge 1' gh pr edit 1", "GH_BROWSER='gh pr merge 1' gh pr view 1 --web", "GH_PAGER='gh pr merge 1' gh pr view 1", "GIT_EDITOR='gh pr merge 1' git commit -m x",
    'echo "gh pr merge 1" | bash', 'echo "gh pr merge 1" | sh', 'echo "gh pr merge 1" | perl -e \'system(<>)\'', "echo 'gh pr merge 1' > f; env bash f", 'echo "gh pr merge 1" > f; bash f',
    'echo x; (echo "gh pr merge 1")', 'echo "gh pr merge 1" &', 'echo "gh pr merge 1" |& sh', 'git commit -c HEAD -m "gh pr merge 1"', 'git -c core.editor="gh pr merge 1" commit -m x',
    'git commit --template "gh pr merge 1" -m x', 'gh pr view 1 --web "gh pr merge 1"', 'gh pr edit 1 -F f "gh pr merge 1"', 'cat -x "gh pr merge 1"', 'echo "gh pr merge 1" && rg -z --pre sh x f',
  ]) assert.equal(isCandidate(asInput(c)), true, c)
})
test('isCandidate: bodies that may run, and real PR commands around a body, are still candidates', () => {
  for (const c of [
    "python3 - <<'EOF'\nx = 'gh pr merge 24'\n", // never terminated: the body runs to the end of the text
    'cat <<EOF\n$(gh pr merge 24)\nEOF', // unquoted: the substitution runs
    'cat <<EOF\n`gh pr merge 24`\nEOF',
    "cat > f <<'EOF'\necho hi\nEOF\ngh pr merge 24",
    "gh pr merge 24 && cat > f <<'EOF'\necho hi\nEOF",
    "cat > f <<'EOF' && gh pr create --head x\necho hi\nEOF",
    "cat > f <<'EOF'\ngh pr merge 24\nEOF\nsh f",
    "cat > f <<'EOF'\ngh pr merge 24\nEOF\n./f",
    "cat > f <<'EOF'\ngh pr merge 24\nEOF\npython3 f",
    "cat <<'EOF' | sh\ngh pr merge 24\nEOF",
    "bash <<'EOF'\ngh pr merge 24\nEOF",
    "python3 - <<'EOF'\nimport subprocess\nsubprocess.run('gh pr merge 24', shell=True)\nEOF",
    "python3 - <<'EOF'\nx = 'gh pr create'\nEOF\npython3 - <<'EOF'\nimport os\nos.system('gh pr merge 1')\nEOF",
    "python3 - <<EOF\nx = '$(gh pr merge 1)'\nEOF",
  ]) assert.equal(isCandidate(asInput(c)), true, c)
})
test('isCandidate: gh pr edit <n> --body-file <f> passes this guard; chained with a PR operation it does not (retro 0.1.5 R4)', () => {
  for (const c of ['gh pr edit 38 --body-file /tmp/x/body.md', 'gh pr edit 38 --body-file=/tmp/x/body.md', 'gh pr edit 38 --title t --body-file f'])
    assert.equal(isCandidate(asInput(c)), false, c)
  for (const c of ['gh pr edit 38 --body-file f; gh pr merge 38', 'gh pr edit 38 --body-file f && gh pr create --head x'])
    assert.equal(isCandidate(asInput(c)), true, c)
})
test('isCandidate: fails closed on input the parser cannot take', () => {
  const deep = '$('.repeat(20000) + 'gh pr merge 1' + ')'.repeat(20000)
  assert.equal(isCandidate(asInput(deep)), true)
  assert.equal(isCandidate(asInput('echo ' + 'x '.repeat(60000))), true) // over the size limit
})
test('check: a refused-by-form command stays refused when a harmless mention precedes it', () => {
  assert.ok(check('echo "gh pr view" && gh pr merge 24').error)
})
test('tokenize: quotes and escapes', () => {
  assert.deepEqual(tokenize(`a 'b c' "d \\" e" f\\ g ''`), ['a', 'b c', 'd " e', 'f g', ''])
  assert.equal(tokenize('a "b'), null)
  assert.equal(tokenize('a && b'), null)
})
test('decide: no record blocks, equal allows, different names the range', () => {
  const command = 'gh pr merge 1'
  assert.match(decide({ command, branch: 'b', headSha: 'aaa', recorded: null }), /recorded none/)
  assert.equal(decide({ command, branch: 'b', headSha: 'aaa', recorded: 'aaa' }), null)
  assert.match(decide({ command, branch: 'b', headSha: 'bbb', recorded: 'aaa' }), /aaa\.\.bbb/)
  assert.match(decide({ command: 'gh -R o/r pr merge 1', branch: 'b', headSha: 'a', recorded: 'a' }), /Allowed forms/)
})
test('recordFile: feat/a and feat__a do not collide', () => {
  assert.notEqual(recordFile('/p', 'feat/a'), recordFile('/p', 'feat__a'))
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'guard-review-'))
  const dir = join(root, 'work')
  const origin = join(root, 'owner1', 'repo.git')
  const env = { ...gitFreeEnv(), CLAUDE_PROJECT_DIR: dir, GUARD_REVIEW_GH: join(root, 'fakegh') }
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
  writeFileSync(join(root, 'fakegh'), '#!/bin/sh\n[ "$*" = "pr view 24 --json headRefName,headRefOid,isCrossRepository" ] || { echo "fake gh: unexpected args: $*" >&2; exit 1; }\nprintf "%s" "$FAKE_GH_OUT"\nexit "${FAKE_GH_EXIT:-0}"\n')
  chmodSync(join(root, 'fakegh'), 0o755)
  const hook = (command: string | null, extra: Record<string, string> = {}) =>
    sh(dir, 'node', [script], JSON.stringify({ tool_input: command === null ? {} : { command } }), { ...env, ...extra })
  const commit = (n: string) => { writeFileSync(join(dir, 'a'), n); git('commit', '-q', '-am', n); return git('rev-parse', 'HEAD') }
  return { root, dir, env, sh, git, hook, commit }
}

test('create: bare origin, local tip, remote tip and record', () => {
  const t = setup()
  try {
    const create = 'gh pr create --base master --head feat/x'
    assert.equal(t.hook(create).status, 2) // not on origin
    assert.match(t.hook(create).stderr, /push the branch first/)
    t.git('push', '-q', 'origin', 'feat/x')
    assert.match(t.hook(create).stderr, /recorded none/)
    const first = t.git('rev-parse', 'HEAD')
    assert.equal(t.sh(t.dir, 'node', [script, '--mark']).status, 0)
    assert.equal(t.hook(create).status, 0) // reviewed: from here only the named check can block
    for (const c of [
      'gh pr create --base master --head owner1:feat/x', 'gh pr create --head=feat/x', 'gh pr create -Hfeat/x', 'gh pr create -H feat/x',
      'gh pr create', 'gh -R o/r pr create --head feat/x', 'GH_REPO=o/r gh pr create --head feat/x', '/usr/bin/gh pr create --head feat/x',
      'git push origin feat/x && gh pr create --head feat/x', 'gh api -X POST repos/o/r/pulls', 'gh api --raw-field=title=x repos/o/r/pulls',
    ]) assert.equal(t.hook(c).status, 2, c)
    assert.equal(t.hook('git push -u origin feat/x').status, 0)
    assert.equal(t.hook(null).status, 0)
    // local ahead of origin (record = remote tip): only local != remote can block
    const second = t.commit('2')
    const ahead = t.hook(create)
    assert.equal(ahead.status, 2)
    assert.match(ahead.stderr, /differs from origin/)
    // pushed but not reviewed: the range is named
    t.git('push', '-q', 'origin', 'feat/x')
    const blocked = t.hook(create)
    assert.equal(blocked.status, 2)
    assert.ok(blocked.stderr.includes(`${first.slice(0, 12)}..${second.slice(0, 12)}`), blocked.stderr)
    // reviewed local branch, other branch on origin: head names the branch whose tip is checked
    t.git('branch', 'feat/y', first)
    assert.equal(t.hook('gh pr create --head feat/y').status, 2) // feat/y not on origin
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})

test('create: branch on origin but not local is blocked by the local-branch check only', () => {
  const t = setup()
  try {
    t.git('push', '-q', 'origin', 'feat/x')
    assert.equal(t.sh(t.dir, 'node', [script, '--mark']).status, 0) // reviewed, recorded at the remote tip
    const create = 'gh pr create --head feat/x'
    assert.equal(t.hook(create).status, 0)
    t.git('checkout', '-q', '-b', 'other')
    t.git('branch', '-D', 'feat/x')
    const r = t.hook(create)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /no local branch feat\/x/)
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})

test('hook input: candidates must be readable JSON with a string command', () => {
  const t = setup()
  try {
    const raw = (input: string) => t.sh(t.dir, 'node', [script], input, t.env).status
    assert.equal(raw('not json'), 0)
    assert.equal(raw('{}'), 0)
    assert.equal(raw('{"tool_input":{}}'), 0)
    assert.equal(raw('not json gh pr merge 5'), 2)
    assert.equal(raw('{"tool_input":{"command":"gh pr merge 24"}'), 2) // truncated
    assert.equal(raw('{"tool_input":{"command":["gh pr merge 24"]}}'), 2) // not a string
    assert.equal(raw('{"tool_input":{"command":"git push x && gh pr merge 24"}}'), 2)
    assert.equal(raw('{"tool_input":{"command":"gh pr mer\\\\ge 24"}}'), 2)
    for (const sep of ['\t', '\n', '\u00a0', '\u2003']) {
      const cmd = ['gh', 'pr', 'merge', '24'].join(sep)
      assert.equal(isCandidate(JSON.stringify({ tool_input: { command: cmd } })), true, JSON.stringify(sep))
      assert.equal(raw(JSON.stringify({ tool_input: { command: cmd } })), 2, JSON.stringify(sep))
    }
    // hand-written escapes, as the raw text a client might send
    for (const e of ['gh\\tpr\\tmerge\\t24', 'gh\\u0020pr\\u0020merge 24', 'gh\\npr\\nmerge 24', '\\u0067h pr merge 24'])
      assert.equal(raw(`{"tool_input":{"command":"${e}"}}`), 2, e)
    // unparseable JSON: only the decoded-escape reading can see the command
    for (const e of ['gh\\tpr\\tmerge\\t24', 'gh\\npr\\nmerge 24'])
      assert.equal(raw(`{"tool_input":{"command":"${e}"}`), 2, `truncated ${e}`)
    for (const c of ["gh pr $'\\155erge' 24", "gh pr $'\\x6derge' 24", 'gh pr ${x}ge 24', 'gh pr $(echo merge) 24'])
      assert.equal(t.hook(c).status, 2, c)
    // shell line continuations inside words (review 5): bash joins them, so must the hook
    for (const c of ['g\\\nh pr merge 24', 'gh p\\\nr merge 24', 'gh pr mer\\\nge 24', 'gh pr crea\\\nte --head x'])
      assert.equal(t.hook(c).status, 2, JSON.stringify(c))
    for (const c of ['gh pr comment 24 --body-file f', "printf '%s\\n' x"]) assert.equal(t.hook(c).status, 0, c)
    // fail closed: deeply nested or oversized input is refused with exit 2, not a crash
    assert.equal(t.hook('$('.repeat(20000) + 'gh pr merge 1' + ')'.repeat(20000)).status, 2)
    assert.equal(t.hook('echo ' + 'x '.repeat(80000)).status, 2)
    for (const c of ['echo "unterminated', "echo 'unterminated", 'codex exec - < prompt.md; echo $(x']) assert.equal(t.hook(c).status, 2, c)
    assert.equal(t.hook("codex exec - < prompt.md").status, 0) // no PR operation in its text
    assert.equal(t.hook("printf 'Run gh pr merge 1' > p; codex exec - < p").status, 2)
    for (const c of ['2>/dev/null gh pr merge 1', 'find . -exec gh pr merge 1 \\;', 'sudo -u root gh pr merge 1']) assert.equal(t.hook(c).status, 2, c)
    // text that only mentions a PR operation is data (false positives of 0.1.4)
    for (const c of ['echo "gh pr edit 28; gh pr merge 28" > prompt.md', "grep -n '^codex$' list.txt", "python3 - <<'EOF'\nprint('PR 28 merge; create notes')\nEOF"])
      assert.equal(t.hook(c).status, 0, c)
    for (const c of ['echo x && gh pr merge 24', 'sh -c "gh pr merge 24"', 'env GH_REPO=o/r gh pr create --head b']) assert.equal(t.hook(c).status, 2, c)
    // a Bash call without a string command is refused; a command-less non-Bash input is not
    assert.equal(raw('{"tool_name":"Bash","tool_input":{}}'), 2)
    assert.equal(raw('{"tool_name":"Bash","tool_input":{"command":5}}'), 2)
    assert.equal(raw('{"tool_name":"Bash"}'), 2)
    assert.equal(raw('{"tool_name":"Read","tool_input":{}}'), 0) // checked as merge; fake gh is not set up for it here
    for (const c of ['git push -u origin x', 'gh pr view 24', 'gh pr checks 24', 'gh pr edit 24 --body-file f', 'gh pr close 22', 'git commit -F msg.txt'])
      assert.equal(t.hook(c).status, 0, c)
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

test('merge: fake gh (exact args) decides the head', () => {
  const t = setup()
  try {
    const head = t.git('rev-parse', 'HEAD')
    const out = (o: object) => ({ FAKE_GH_OUT: JSON.stringify(o) })
    const view = { headRefName: 'feat/x', headRefOid: head, isCrossRepository: false }
    assert.equal(t.hook('gh pr merge 24 --merge', out(view)).status, 2) // unreviewed
    assert.equal(t.sh(t.dir, 'node', [script, '--mark']).status, 0)
    assert.equal(t.hook('gh pr merge 24 --merge', out(view)).status, 0) // reviewed
    assert.equal(t.hook('gh pr merge 24 --merge --delete-branch', out(view)).status, 0)
    assert.equal(t.hook('gh pr "merge" 24', out(view)).status, 0) // quotes tokenise to merge: normal review check
    assert.equal(t.hook("gh pr me''rge 24", out({ ...view, headRefOid: 'f'.repeat(40) })).status, 2)
    assert.equal(t.hook('gh pr merge 25 --merge', out(view)).status, 2) // fake gh only answers for 24: number is passed through
    assert.equal(t.hook('gh pr merge 24', out({ ...view, headRefOid: 'f'.repeat(40) })).status, 2) // head moved
    assert.equal(t.hook('gh pr merge 24', out({ ...view, isCrossRepository: true })).status, 2)
    for (const k of ['headRefName', 'headRefOid', 'isCrossRepository']) {
      const o: Record<string, unknown> = { ...view }
      delete o[k]
      const r = t.hook('gh pr merge 24', out(o)) // valid JSON, exit 0, one field missing
      assert.equal(r.status, 2, k)
      assert.match(r.stderr, /incomplete fields/, k)
    }
    assert.equal(t.hook('gh pr merge 24', { ...out(view), FAKE_GH_EXIT: '1' }).status, 2) // gh exits 1 with valid output
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})
