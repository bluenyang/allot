import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
// @ts-expect-error plain .mjs without types
import { check, isCandidate, tokenize, decide, recordFile } from '../../scripts/guard-review.mjs'
import { gitFreeEnv } from './git-env'
// @ts-expect-error plain .mjs without types
import { parseShell } from '../../scripts/shell-words.mjs'

test('parseShell: each word says whether its first character was quoted or escaped', () => {
  const [seg] = parseShell(`git fetch . "<" x 2>/dev/null \\< 'a'b c"d" <"/dev/null" 2>'f'`)
  assert.deepEqual(seg.words, ['git', 'fetch', '.', '<', 'x', '2>/dev/null', '<', 'ab', 'cd', '</dev/null', '2>f'])
  assert.deepEqual(seg.quoted, [false, false, false, true, false, false, true, true, false, false, false])
})

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
test('isCandidate: lines of file, listing and git commands that only mention a PR are data (false positives of 0.1.8)', () => {
  for (const c of [
    'cd wt && git merge --ff-only -q fix/x; git log --oneline -1; grep -h "gh pr merge" notes.md',
    'git -C wt status --short; git log --format="%h %s" -3 -- notes/pr-merge.md',
    'ls reports; cd reports && grep -c "gh pr create" a.log b.log',
    'git diff --stat a..b; git show b:docs/x.md | grep -n "gh pr merge"',
    'mkdir -p out && cut -c1-80 log | sort | uniq -c',
    'git worktree add -q -b fix/x wt/x origin/master; git branch -d feat/y',
    'git push -q -u origin docs/x; git fetch -q origin; git rev-parse v1^{commit}',
  ]) assert.equal(isCandidate(asInput(c)), false, c)
  for (const c of [
    'cd wt && gh pr merge 24', 'git -c alias.m="!gh pr merge 24" m', 'git rebase -x "gh pr merge 24" master',
    'git push --receive-pack="gh pr merge 24" origin x', 'find . -exec gh pr merge 1 \\;', 'ls; gh pr create --head x',
    'git log --oneline -1 && gh pr merge 24', 'git difftool -x "gh pr merge 24"',
    // git takes abbreviated long options (review 1 F-1)
    'git push --rece="gh pr merge 24;:" origin x', 'git push --exe="gh pr merge 24;:" origin x',
    'git fetch --upload-pa="gh pr merge 24;:" .', 'git fetch --upl "gh pr merge 24;:" .', 'git pull --upl="gh pr merge 24;:" .',
    'git ls-remote --upl="gh pr merge 24;:" .', 'git -C wt ls-remote --upl="gh pr merge 24;:" .', 'git diff --ext="gh pr merge 24"',
    'git diff --e="gh pr merge 24"',
    // a line that writes what git runs, then runs git (review 1 F-2)
    'echo "[core] fsmonitor = gh pr merge 24;:" >> .git/config; git status',
    "printf '[diff]\\n external = gh pr merge 24 #\\n' >> .git/config && git diff",
    "printf '[diff]\\n external = gh pr merge 24 #\\n'>cfg && git diff",
    'git log -1 --output=.git/config --format="[core]%n fsmonitor = gh pr merge 24;:" && git status',
    'git log -1 --o=.git/config --format="[core]%n fsmonitor = gh pr merge 24;:" && git status',
    'uniq notes.txt .git/config; grep "gh pr merge 24" notes.txt; git status',
    'sort --compress-program=gh notes.txt; grep "gh pr merge" notes.txt', 'sort -o out notes.txt; grep "gh pr merge" notes.txt',
    // a quoted "<" or ">&" is an argument, not a redirection: the word after it is still read (review 2 G-1)
    'git fetch . "<" "--upload-pack=gh pr merge 24;:"', 'git fetch . ">&" "--upl=gh pr merge 24;:"',
    'git pull . "<" "--upload-pack=gh pr merge 24;:"', 'git commit -m x "<" "--exec=gh pr merge 24"',
    // `>& file` writes the file; uniq writes its second operand (review 2 G-2)
    "printf 'x: gh pr merge 24' >& lefthook-local.yml && git commit -m x", "printf 'x: gh pr merge 24' 2>& hooks.yml; git push -q origin x",
    "uniq - lefthook-local.yml <<'E'\ngh pr merge 24\nE\ngit push -q origin x", 'uniq -c a.txt b.txt; grep "gh pr merge" a.txt',
    // a here-string or a quoted "<" moves the word git or gh reads as its subcommand (review 3 H-1, I-1)
    'gh <<< run pr merge 24', 'gh <<< issue pr create --head x', 'gh 0<<< run pr merge 24',
    'git <<< status filter-branch -f --tree-filter "gh pr merge 24;:" HEAD',
    'git -C <<< x status filter-branch -f --tree-filter "gh pr merge 24;:" HEAD',
    'mkdir -p "<" && git -C "<" filter-branch -f --tree-filter "gh pr merge 24;:" HEAD',
    // git takes only the options of GIT_OPTS: any other one, however spelled, puts the line under the text rules
    'git fetch --upload-pac "gh pr merge 24;:" .', 'git push --recv="gh pr merge 24;:" origin x', 'git ls-remote -qu "gh pr merge 24;:" .',
    'git log -1 --outp=x; grep "gh pr merge" a.log', 'git --exec-path=. log; grep "gh pr merge" a.log',
    'git filter-branch -f --tree-filter "gh pr merge 24;:" HEAD', 'git bisect run gh pr merge 24',
    'git --no-pager -c core.pager="gh pr merge 24" log',
    // a redirection with a quoted target is still a redirection (review 4 F-1)
    `git -C <"/dev/null" switch -c 'core.fsmonitor=gh pr merge 24;:' status`,
    `git -C >"/dev/null" switch -c 'core.fsmonitor=gh pr merge 24;:' status`,
    `git -C 2>'/dev/null' switch -c 'core.fsmonitor=gh pr merge 24;:' status`,
    // git pull passes the words after -- to fetch as options (review 4 F-2)
    'git pull -- --upload-pack="gh pr merge 24;:" .', 'git pull -q -- --upl="gh pr merge 24;:" .',
    // words the shell computes can become options (review 4 F-3)
    "git ls-remote {--upload-pack='gh pr merge 24;:',.}", "git -C {.,-c,'core.fsmonitor=gh pr merge 24;:'} status",
    'git ls-remote "${X:---upload-pack=gh pr merge 24;:}" .', 'git ls-remote "$(echo x--upload-pack=gh pr merge 24 | cut -c2-)" .',
    "true '--upload-pack=gh pr merge 24;:' && git ls-remote $_ .", "sort {-o,lefthook-local.yml} notes.txt; grep 'gh pr merge' notes.txt",
  ]) assert.equal(isCandidate(asInput(c)), true, c)
  // writing nowhere (/dev/null, another descriptor) keeps a git line plain
  for (const c of [
    'git log --oneline -3 2>/dev/null; grep -h "gh pr merge" notes.md',
    'git status --short >&2; grep -c "gh pr create" a.log 2>&1', 'git fetch -q origin 2> /dev/null && sort -n -k2 notes | grep "gh pr merge"',
    'git log --oneline -3 2>& 1; grep -h "gh pr merge" notes.md', 'git log -3 | uniq -c -f 1 | grep "gh pr merge"',
    'git log -3 >& /dev/null; grep -h "gh pr merge" notes.md', 'git log -3 | uniq --count --skip-fields=1 | grep "gh pr merge"',
    // git with its habit options (GIT_OPTS); values and paths after `--` are data (review 3 false positives)
    'git --no-pager log --oneline -5 2>&1 | head; grep "gh pr merge" a.log', 'git log --grep="-c" --oneline; grep "gh pr merge" a.log',
    'git commit -q -m "-x flag docs" ; grep "gh pr merge" a.log', 'git diff -- -x.md; grep "gh pr merge" a.log',
    'git status -sb; git branch --show-current; git rev-parse --abbrev-ref HEAD; grep "gh pr create" a.log',
    'git fetch . "<"; grep "gh pr merge" a.log',
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

// base: where the scratch repository goes (default: the system temp dir); tests added in retro 0.1.6 pass a folder under the worktree's .loctx/
function setup(base: string = tmpdir()) {
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'guard-review-'))
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
  const review = join(root, 'review.md')
  writeFileSync(review, '# review\nmodel: gpt-x\nno open findings\n')
  return { root, dir, env, sh, git, hook, commit, review }
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
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review]).status, 0)
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
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review]).status, 0) // reviewed, recorded at the remote tip
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
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review, 'feat/x', first]).status, 0) // ancestor
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review, 'feat/x', orphan]).status, 1) // unrelated
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review, 'nope']).status, 1) // no branch
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review, 'feat/x', 'deadbeef']).status, 1)
    // feat/a and feat__a keep separate records
    t.git('branch', 'feat/a'); t.git('branch', 'feat__a', first)
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review, 'feat/a']).status, 0)
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review, 'feat__a']).status, 0)
    assert.notEqual(recordFile(t.dir, 'feat/a'), recordFile(t.dir, 'feat__a'))
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})

test('--mark: needs a review record with a model line, matching the delegation table when there is one', () => {
  const t = setup(join(resolve('.'), '.loctx', 'scratch'))
  try {
    const mark = (...a: string[]) => t.sh(t.dir, 'node', [script, '--mark', ...a])
    const head = t.git('rev-parse', 'HEAD')
    const rec = recordFile(t.dir, 'feat/x')
    const refused = mark()
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /pnpm review:mark --review <file>/)
    assert.equal(mark('feat/x').status, 1) // the old form
    assert.equal(mark('--review').status, 1)
    assert.equal(mark('--review', join(t.root, 'missing.md')).status, 1)
    const nomodel = join(t.root, 'nomodel.md')
    writeFileSync(nomodel, '# review\nno model here\n')
    assert.match(mark('--review', nomodel).stderr, /model: <name>/)
    assert.throws(() => readFileSync(rec, 'utf8')) // nothing recorded by a refusal
    // no personal table: any model name is accepted; the record is the SHA line, then the review line
    assert.equal(mark('--review', t.review).status, 0)
    assert.equal(readFileSync(rec, 'utf8'), `${head}\nreview: ${t.review}\n`)
    assert.equal(t.hook('gh pr create --head feat/x').status, 2) // not on origin: the check still reads the SHA line only
    t.git('push', '-q', 'origin', 'feat/x')
    assert.equal(t.hook('gh pr create --head feat/x').status, 0)
    // a personal table that names reviewers: the model must be one of them
    mkdirSync(join(t.dir, '.loctx'), { recursive: true })
    writeFileSync(join(t.dir, '.loctx', 'delegation.local.md'), '## Delegation\n\n| role | model | how |\n|---|---|---|\n| pl/code-reviewer | openai gpt-y | x |\n| implementer/code | claude gpt-x | x |\n')
    const wrong = mark('--review', t.review)
    assert.equal(wrong.status, 1)
    assert.match(wrong.stderr, /gpt-x is not a pl\/code-reviewer/)
    const ok = join(t.root, 'ok.md')
    writeFileSync(ok, 'model: gpt-y\n')
    assert.equal(mark('--review', ok).status, 0)
    writeFileSync(ok, 'model: openai gpt-y\n')
    assert.equal(mark('--review', ok).status, 0)
    // several models in one cell: each entry counts, with its provider or without
    writeFileSync(join(t.dir, '.loctx', 'delegation.local.md'), '| pl/code-reviewer | openai model-a, openai model-b | x |\n')
    for (const m of ['model-a', 'openai model-a', 'model-b', 'openai model-b']) {
      writeFileSync(ok, `model: ${m}\n`)
      assert.equal(mark('--review', ok).status, 0, m)
    }
    writeFileSync(ok, 'model: model-c\n')
    assert.equal(mark('--review', ok).status, 1)
    // every model line counts: a listed one does not cover an unlisted one; the same model twice is fine
    writeFileSync(ok, 'model: model-a\nmodel: model-c\n')
    assert.equal(mark('--review', ok).status, 1)
    writeFileSync(ok, 'model: model-c\nmodel: model-a\n')
    assert.equal(mark('--review', ok).status, 1)
    writeFileSync(ok, 'model: model-a\nmodel: openai model-a\n')
    assert.equal(mark('--review', ok).status, 0)
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})

test('merge: fake gh (exact args) decides the head', () => {
  const t = setup()
  try {
    const head = t.git('rev-parse', 'HEAD')
    const out = (o: object) => ({ FAKE_GH_OUT: JSON.stringify(o) })
    const view = { headRefName: 'feat/x', headRefOid: head, isCrossRepository: false }
    assert.equal(t.hook('gh pr merge 24 --merge', out(view)).status, 2) // unreviewed
    assert.equal(t.sh(t.dir, 'node', [script, '--mark', '--review', t.review]).status, 0)
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

test('--mark from a linked worktree writes to and reads from the common .loctx (retro 0.1.7)', () => {
  const t = setup(join(resolve('.'), '.loctx', 'scratch'))
  try {
    const wt = join(t.root, 'wt')
    t.git('worktree', 'add', '-q', '-b', 'feat/w', wt)
    const inWt = { ...t.env, CLAUDE_PROJECT_DIR: '' } // as in a Bash call: the checkout is found from the working directory
    const mark = (...a: string[]) => t.sh(wt, 'node', [script, '--mark', ...a], undefined, inWt)
    // the main checkout's table applies from the worktree too
    mkdirSync(join(t.dir, '.loctx'), { recursive: true })
    writeFileSync(join(t.dir, '.loctx', 'delegation.local.md'), '| pl/code-reviewer | openai gpt-y | x |\n')
    assert.equal(mark('--review', t.review).status, 1) // gpt-x is not listed there
    const ok = join(t.root, 'ok.md')
    writeFileSync(ok, 'model: gpt-y\n')
    const r = mark('--review', ok)
    assert.equal(r.status, 0, r.stderr)
    const head = t.sh(wt, 'git', ['rev-parse', 'HEAD'], undefined, inWt).stdout.trim()
    // the worktree's branch, recorded in the main checkout's .loctx and not in the worktree's own
    assert.equal(readFileSync(recordFile(t.dir, 'feat/w'), 'utf8'), `${head}\nreview: ${ok}\n`)
    assert.throws(() => readFileSync(recordFile(wt, 'feat/w'), 'utf8'))
    t.git('push', '-q', 'origin', 'feat/w')
    // the hook finds the mark whether its project dir is the main checkout or the worktree
    assert.equal(t.hook('gh pr create --head feat/w').status, 0)
    assert.equal(t.hook('gh pr create --head feat/w', { CLAUDE_PROJECT_DIR: wt }).status, 0)
  } finally { rmSync(t.root, { recursive: true, force: true }) }
})
