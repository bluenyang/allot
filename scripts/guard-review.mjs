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

// gh preceded by start, whitespace or a shell separator; any occurrence counts (quotes are not
// parsed, so `echo "gh pr create"` also matches: the guard errs on blocking).
const GH = /(?:^|[\s;&|(`])gh\s+pr\s+(create|merge)\b([^;&|\n]*)/
const VALUE_FLAGS = new Set([
  '--head', '-H', '--base', '-B', '--body', '-b', '--body-file', '-F', '--title', '-t', '--subject',
  '--author-email', '--match-head-commit', '--repo', '-R', '--assignee', '-a', '--label', '-l',
  '--milestone', '-m', '--project', '-p', '--reviewer', '-r', '--template', '-T',
])

const unquote = (s) => s.replace(/^["']|["']$/g, '')

/** Reads a command: { kind: 'create'|'merge'|null, arg, head }. */
export function parse(command) {
  const m = GH.exec(String(command ?? ''))
  if (!m) return { kind: null, arg: null, head: null }
  const kind = m[1]
  const words = (m[2].match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote)
  let arg = null
  let head = null
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const eq = w.startsWith('-') ? w.indexOf('=') : -1
    const flag = eq > 0 ? w.slice(0, eq) : w
    if (flag === '--head' || flag === '-H') {
      head = eq > 0 ? w.slice(eq + 1) : (words[++i] ?? null)
    } else if (w.startsWith('-')) {
      if (eq < 0 && VALUE_FLAGS.has(flag)) i++
    } else if (arg === null) {
      arg = w
    }
  }
  if (head) head = head.replace(/^[^:]+:/, '') // owner:branch
  return { kind, arg: kind === 'merge' ? arg : null, head }
}

/** Returns the reason a PR command is refused, or null. */
export function decide({ command, branch, headSha, recorded }) {
  if (parse(command).kind === null) return null
  if (recorded && recorded === headSha) return null
  const fix = recorded
    ? `review the commits ${recorded.slice(0, 12)}..${String(headSha).slice(0, 12)}, then \`pnpm review:mark\``
    : `review the branch, then \`pnpm review:mark\``
  return `branch ${branch} has commits after its last review: recorded ${recorded ? recorded : 'none'}, head ${headSha}. ${fix}`
}

export const recordFile = (dir, branch) => join(dir, '.loctx', 'reviews', `${branch.replaceAll('/', '__')}.sha`)

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || git(process.cwd(), 'rev-parse', '--show-toplevel')
}

function readRecord(dir, branch) {
  try { return readFileSync(recordFile(dir, branch), 'utf8').trim() || null } catch { return null }
}

function mark(args) {
  const dir = projectDir()
  const branch = args[0] || git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
  let sha
  try { sha = git(dir, 'rev-parse', '--verify', `${args[1] || args[0] || 'HEAD'}^{commit}`) } catch {
    console.error(`guard-review: unknown commit ${args[1] ?? args[0] ?? 'HEAD'}`)
    process.exit(1)
  }
  if (args[0] && !args[1]) {
    // branch only: use the branch tip
    try { sha = git(dir, 'rev-parse', '--verify', `${branch}^{commit}`) } catch {
      console.error(`guard-review: unknown branch ${branch}`)
      process.exit(1)
    }
  }
  const file = recordFile(dir, branch)
  mkdirSync(join(dir, '.loctx', 'reviews'), { recursive: true })
  writeFileSync(file, `${sha}\n`)
  console.log(`guard-review: recorded ${sha} for ${branch} (${file})`)
}

function selfTest() {
  const ok = (c, want) => (c === want ? 'ok  ' : 'FAIL')
  let bad = 0
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want)
    if (!pass) bad++
    console.log(`${ok(pass, true)} ${label}`)
  }
  check('chained create', parse('git push && gh pr create --base master --head x'), { kind: 'create', arg: null, head: 'x' })
  check('merge spaces', parse('gh  pr   merge 24 --merge'), { kind: 'merge', arg: '24', head: null })
  check('merge value flag', parse('gh pr merge --body "x y" feat/a'), { kind: 'merge', arg: 'feat/a', head: null })
  check('create -H=', parse('gh pr create -H=fix/z'), { kind: 'create', arg: null, head: 'fix/z' })
  check('pr view', parse('gh pr view 24').kind, null)
  check('echo gh pr list', parse('echo gh pr list').kind, null)
  check('ghx', parse('ghx pr create').kind, null)
  const cmd = 'gh pr create'
  check('no record blocks', decide({ command: cmd, branch: 'b', headSha: 'aaa', recorded: null }) !== null, true)
  check('equal allows', decide({ command: cmd, branch: 'b', headSha: 'aaa', recorded: 'aaa' }), null)
  check('different blocks', decide({ command: cmd, branch: 'b', headSha: 'bbb', recorded: 'aaa' }) !== null, true)
  check('other command allows', decide({ command: 'git status', branch: 'b', headSha: 'bbb', recorded: null }), null)
  console.log(bad ? `${bad} FAILED` : 'all ok')
  process.exit(bad ? 1 : 0)
}

function hook() {
  let input = ''
  process.stdin.on('data', (d) => { input += d })
  process.stdin.on('end', () => {
    let command = ''
    try { command = JSON.parse(input)?.tool_input?.command ?? '' } catch { process.exit(0) }
    const p = parse(command)
    if (p.kind === null) process.exit(0)
    const block = (why) => { console.error(`guard-review: ${why}`); process.exit(2) }
    let dir, branch, headSha
    try {
      dir = projectDir()
      if (p.kind === 'create') {
        branch = p.head || git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
        headSha = git(dir, 'rev-parse', '--verify', `${branch}^{commit}`)
      } else {
        const out = execFileSync('gh', ['pr', 'view', ...(p.arg ? [p.arg] : []), '--json', 'headRefName,headRefOid'],
          { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        const j = JSON.parse(out)
        branch = j.headRefName
        headSha = j.headRefOid
        if (!branch || !headSha) throw new Error('gh pr view returned no head')
      }
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
