#!/usr/bin/env node
// Claude Code PreToolUse hook for Bash (audits 0.1.1-0.1.3): refuse `gh pr create` and
// `gh pr merge` while the branch has commits after its last review mark. Three audits in a row
// found commits that landed after the review.
//
// Record: .loctx/reviews/<branch>.sha (`/` in the branch becomes `__`), the full SHA of the last
// reviewed commit. Write it after a review with no open findings:
//   node scripts/guard-review.mjs --mark [<branch> [<sha>]]     (pnpm review:mark)
//
// Activate the hook in .claude/settings.json (the user's file; the agent never edits settings):
//   { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
//       { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/guard-review.mjs\"" } ] } ] } }
//
// Exit 2 blocks the call and shows the reason to the agent; exit 0 lets it run.
// Self-test: node scripts/guard-review.mjs --test
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fail closed: one canonical form is allowed (a single `gh pr create` or `gh pr merge`, run from the
// project, without -R/--repo, GH_REPO/GH_HOST, cd or pushd); anything the hook cannot resolve with
// certainty is refused with the form to use. Quotes are not parsed, so `echo "gh pr create"` also
// matches: the guard errs on blocking.
const GH = /(?:^|[\s;&|(`{])gh(?=\s)([^;&|\n)`]*)/g
const VALUE_FLAGS = new Set([
  '--head', '-H', '--base', '-B', '--body', '-b', '--body-file', '-F', '--title', '-t', '--subject',
  '--author-email', '--match-head-commit', '--assignee', '-a', '--label', '-l',
  '--milestone', '-m', '--project', '-p', '--reviewer', '-r', '--template', '-T',
])

const unquote = (s) => s.replace(/^["']|["']$/g, '')
const words = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote)

/**
 * Reads a command: { kind: 'create'|'merge'|null, arg, head, problems }.
 * `problems` lists why the command is refused regardless of the review record.
 */
export function parse(command) {
  const cmd = String(command ?? '').replace(/\\\r?\n/g, ' ')
  const problems = []
  const ops = []
  for (const m of cmd.matchAll(GH)) {
    const w = words(m[1])
    const pr = w.indexOf('pr')
    if (w.includes('api') && (pr < 0 || w.indexOf('api') < pr)) {
      const write = /(^|\s)(-X|--method)[ =]?(POST|PUT|PATCH)\b/i.test(m[1]) || w.some((x) => ['-f', '-F', '--field', '--raw-field'].includes(x))
      if (write && /\/merge\b|pulls/.test(m[1])) problems.push('`gh api` writes to pull requests; use `gh pr create` / `gh pr merge`')
      continue
    }
    if (pr < 0) continue
    let i = pr + 1
    while (i < w.length && w[i].startsWith('-')) i++
    if (w[i] !== 'create' && w[i] !== 'merge') continue
    const op = { kind: w[i], arg: null, head: null, segment: m[0] }
    const rest = w.slice(i + 1)
    for (let j = 0; j < rest.length; j++) {
      const x = rest[j]
      const eq = x.startsWith('-') ? x.indexOf('=') : -1
      const flag = eq > 0 ? x.slice(0, eq) : x
      if (flag === '--head' || flag === '-H') op.head = eq > 0 ? x.slice(eq + 1) : (rest[++j] ?? null)
      else if (x.startsWith('-')) { if (eq < 0 && VALUE_FLAGS.has(flag)) j++ }
      else if (op.arg === null) op.arg = x
    }
    if (op.kind === 'create') op.arg = null
    ops.push(op)
  }
  if (ops.length > 1) problems.push('more than one `gh pr create` / `gh pr merge` in one command; run one operation per command')
  if (ops.length) {
    if (ops.some((o) => w2(o.segment).some((x) => x === '-R' || x.startsWith('-R=') || x.startsWith('--repo')))) problems.push('-R/--repo is not allowed; run the PR command in the repository checkout without it')
    if (/\bGH_(REPO|HOST)=/.test(cmd)) problems.push('GH_REPO/GH_HOST assignments are not allowed; run the PR command in the repository checkout without them')
    if (/(^|[\s;&|(`{])(cd|pushd)(\s|$)/.test(cmd)) problems.push('cd/pushd in the same command is not allowed; run the PR command from the project directory')
  }
  const o = ops[0]
  return { kind: o?.kind ?? null, arg: o?.arg ?? null, head: o?.head ?? null, problems }
}
const w2 = (s) => words(s)

/** True when a command (or raw hook input) looks like a PR operation at all. */
export const isPrOperation = (text) => { const p = parse(text); return p.kind !== null || p.problems.length > 0 }

/** Returns the reason a PR command is refused, or null. */
export function decide({ command, branch, headSha, recorded }) {
  const p = parse(command)
  if (p.problems.length) return p.problems.join('; ')
  if (p.kind === null) return null
  if (recorded && recorded === headSha) return null
  const fix = recorded
    ? `review the commits ${recorded.slice(0, 12)}..${String(headSha).slice(0, 12)}, then \`pnpm review:mark\``
    : `review the branch, then \`pnpm review:mark\``
  return `branch ${branch} has commits after its last review: recorded ${recorded ? recorded : 'none'}, head ${headSha}. ${fix}`
}

export const recordFile = (dir, branch) => join(dir, '.loctx', 'reviews', `${encodeURIComponent(branch)}.sha`)

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || git(process.cwd(), 'rev-parse', '--show-toplevel')
}

function readRecord(dir, branch) {
  try { return readFileSync(recordFile(dir, branch), 'utf8').trim() || null } catch { return null }
}

function fail(msg) { console.error(`guard-review: ${msg}`); process.exit(1) }

function mark(args) {
  const dir = projectDir()
  const branch = args[0] || git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
  let tip
  try { tip = git(dir, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`) } catch { fail(`no local branch ${branch}`) }
  let sha = tip
  if (args[1]) {
    try { sha = git(dir, 'rev-parse', '--verify', `${args[1]}^{commit}`) } catch { fail(`unknown commit ${args[1]}`) }
    try { git(dir, 'merge-base', '--is-ancestor', sha, tip) } catch { fail(`${sha} is not the tip of ${branch} or one of its ancestors`) }
  }
  const file = recordFile(dir, branch)
  mkdirSync(join(dir, '.loctx', 'reviews'), { recursive: true })
  writeFileSync(file, `${sha}\n`)
  console.log(`guard-review: recorded ${sha} for ${branch} (${file})`)
}

function selfTest() {
  let bad = 0
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want)
    if (!pass) bad++
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`)
  }
  const P = (c) => parse(c)
  check('chained create', [P('git push && gh pr create --base master --head x').kind, P('git push && gh pr create --head x').head], ['create', 'x'])
  check('merge spaces', P('gh  pr   merge 24 --merge').arg, '24')
  check('pr view', P('gh pr view 24').kind, null)
  check('echo gh pr list', P('echo gh pr list').kind, null)
  check('ghx', P('ghx pr create').kind, null)
  check('-R blocks', P('gh -R o/r pr merge 24').problems.length > 0, true)
  check('GH_REPO blocks', P('GH_REPO=o/r gh pr merge 24').problems.length > 0, true)
  check('gh api merge blocks', P('gh api -X PUT repos/o/r/pulls/24/merge').problems.length > 0, true)
  check('backslash newline', P('gh pr \\\nmerge 24').kind, 'merge')
  check('two operations block', P('gh pr merge 24; gh pr merge 25').problems.length > 0, true)
  check('cd blocks', P('cd /x && gh pr merge 24').problems.length > 0, true)
  const cmd = 'gh pr create'
  check('no record blocks', decide({ command: cmd, branch: 'b', headSha: 'aaa', recorded: null }) !== null, true)
  check('equal allows', decide({ command: cmd, branch: 'b', headSha: 'aaa', recorded: 'aaa' }), null)
  check('different blocks', decide({ command: cmd, branch: 'b', headSha: 'bbb', recorded: 'aaa' }) !== null, true)
  check('other command allows', decide({ command: 'git status', branch: 'b', headSha: 'bbb', recorded: null }), null)
  check('collision-free path', recordFile('/p', 'feat/a') !== recordFile('/p', 'feat__a'), true)
  console.log(bad ? `${bad} FAILED` : 'all ok')
  process.exit(bad ? 1 : 0)
}

function originOwner(dir) {
  const url = git(dir, 'remote', 'get-url', 'origin')
  const m = /[:/]([^/:]+)\/[^/]+?(?:\.git)?\/?$/.exec(url)
  return m ? m[1] : null
}

function resolveHead(dir, p) {
  const ghBin = process.env.GUARD_REVIEW_GH || 'gh'
  if (p.kind === 'create') {
    let branch = p.head
    if (branch && branch.includes(':')) {
      const [owner, ...r] = branch.split(':')
      const mine = originOwner(dir)
      if (!mine || owner.toLowerCase() !== mine.toLowerCase()) throw new Error(`--head ${branch} names another owner than origin; use --head <branch> of this repository`)
      branch = r.join(':')
    }
    branch = branch || git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
    const line = git(dir, 'ls-remote', 'origin', `refs/heads/${branch}`).split('\n')[0]
    const remote = line ? line.split(/\s+/)[0] : ''
    if (!remote) throw new Error(`branch ${branch} is not on origin; push the branch first`)
    let local = null
    try { local = git(dir, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`) } catch { /* no local branch */ }
    if (local && local !== remote) throw new Error(`local ${branch} (${local}) differs from origin (${remote}); push the branch first`)
    return { branch, headSha: remote }
  }
  const out = execFileSync(ghBin, ['pr', 'view', ...(p.arg ? [p.arg] : []), '--json', 'headRefName,headRefOid,isCrossRepository'],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const j = JSON.parse(out)
  if (!j.headRefName || !j.headRefOid || typeof j.isCrossRepository !== 'boolean') throw new Error('gh pr view returned incomplete fields')
  if (j.isCrossRepository) throw new Error('the pull request comes from a fork; review and merge it by hand')
  return { branch: j.headRefName, headSha: j.headRefOid }
}

function hook() {
  let input = ''
  process.stdin.on('data', (d) => { input += d })
  process.stdin.on('end', () => {
    const block = (why) => { console.error(`guard-review: ${why}`); process.exit(2) }
    let command = ''
    try {
      command = JSON.parse(input)?.tool_input?.command ?? ''
    } catch {
      if (isPrOperation(input)) block('unreadable hook input that looks like a PR command; refusing')
      process.exit(0)
    }
    const p = parse(command)
    if (p.problems.length) block(p.problems.join('; '))
    if (p.kind === null) process.exit(0)
    let dir, branch, headSha
    try {
      dir = projectDir()
      ;({ branch, headSha } = resolveHead(dir, p))
    } catch (e) {
      block(`cannot resolve the branch head for \`gh pr ${p.kind}\` (${String(e.stderr || e.message).trim().split('\n')[0]}); refusing.`)
    }
    const why = decide({ command, branch, headSha, recorded: readRecord(dir, branch) })
    if (why) block(why)
    process.exit(0)
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, ...rest] = process.argv.slice(2)
  if (a === '--test') selfTest()
  else if (a === '--mark') mark(rest)
  else hook()
}
