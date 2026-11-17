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

// Threat model: this hook stops the agent's own accidental or habitual PR create/merge without a
// review mark, including shell-quoting variants. It is not a sandbox against deliberate obfuscation
// (decoding a payload and piping it to a shell); AGENTS.md's red lines already forbid that.
//
// Allowlist: a command that looks like a PR operation is allowed only in one canonical form,
// standing alone; everything else is refused with the forms to use.
export const FORMS = [
  'gh pr create --head <branch> [--base <b>] [--title <t>] [--body-file <f>] [--draft]',
  'gh pr merge <number> [--merge] [--subject <s>] [--body <b>] [--body-file <f>] [--delete-branch]',
  '(each flag as its own token with its value as the next token; the command stands alone: no ; && || | & newline ` $ < >, no env assignment, plain `gh`)',
].join('\n  ')

const SAFE_PR = 'view|checks|list|diff|status|edit|close|comment|ready|reopen'
// `gh pr` followed by anything but a literal safe subcommand (so `gh pr ${x}ge`, `gh pr $(echo merge)`)
const UNKNOWN_PR = new RegExp(`\\bgh\\s+pr\\s+(?!(?:${SAFE_PR})(?=$|[\\s"'}\\],\\\;&|)]))`)
const looksLikePr = (t) =>
  (/\bgh\b/.test(t) && /\bpr\b/.test(t) && /\b(create|merge)\b/.test(t)) ||
  (/\bgh\b/.test(t) && /\bapi\b/.test(t) && /\b(pulls|merge)\b/.test(t)) ||
  UNKNOWN_PR.test(t)

const decodeEscapes = (t) =>
  t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([tnr/bf"\\])/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f' })[c] ?? c)

/**
 * Candidate check on the raw hook input. It is a candidate when any reading of the text looks like
 * a PR operation: backslashes as spaces or removed, JSON escapes decoded or not, quotes removed.
 */
export function isCandidate(raw) {
  const text = String(raw ?? '')
  const views = [text, decodeEscapes(text)]
  try {
    const c = JSON.parse(text)?.tool_input?.command
    if (typeof c === 'string') views.push(c)
  } catch { /* raw views only */ }
  // shell line continuations (backslash-newline) vanish before the shell splits words: join them first
  for (const v of [...views]) views.push(v.replace(/\\\r?\n/g, ''))
  // ANSI-C / locale quoting ($'..', $"..") can spell any word: always a candidate
  return views.some((v) => /\$['"]/.test(v) || looksLikePr(v.replace(/\\/g, ' ').replace(/['"]/g, '')) || looksLikePr(v.replace(/[\\'"]/g, '')))
}

/** Small POSIX-shell-word tokenizer. Returns an array of words, or null (unbalanced/unsupported). */
export function tokenize(cmd) {
  if (/[;&|\n\r`<>$]/.test(cmd)) return null
  const out = []
  let cur = ''
  let inTok = false
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1)
      if (j < 0) return null
      cur += cmd.slice(i + 1, j); inTok = true; i = j
    } else if (c === '"') {
      inTok = true
      let j = i + 1
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === '\\' && '"\\$`'.includes(cmd[j + 1] ?? '')) j++
        cur += cmd[j]
      }
      if (j >= cmd.length) return null
      i = j
    } else if (c === '\\') {
      if (i + 1 >= cmd.length) return null
      cur += cmd[++i]; inTok = true
    } else if (c === ' ' || c === '\t') {
      if (inTok) { out.push(cur); cur = ''; inTok = false }
    } else { cur += c; inTok = true }
  }
  if (inTok) out.push(cur)
  return out
}

/** Checks a candidate command against the allowed forms: { kind, arg, head } or { error }. */
export function check(command) {
  const bad = (why) => ({ error: `${why}. Allowed forms:\n  ${FORMS}` })
  const w = tokenize(String(command ?? ''))
  if (!w) return bad('unbalanced quote or unsupported shell construct in a PR command')
  if (w[0] !== 'gh' || w[1] !== 'pr' || (w[2] !== 'create' && w[2] !== 'merge')) return bad(`not an allowed PR command (${w.slice(0, 3).join(' ')} ...)`)
  const kind = w[2]
  const rest = w.slice(3)
  let arg = null
  let head = null
  const seen = new Set()
  const bare = kind === 'create' ? ['--draft'] : ['--merge', '--delete-branch']
  const valued = kind === 'create' ? ['--base', '--head', '--title', '--body-file'] : ['--subject', '--body', '--body-file']
  let i = 0
  if (kind === 'merge') {
    if (!/^\d+$/.test(rest[0] ?? '')) return bad('gh pr merge needs a plain PR number first')
    arg = rest[i++]
  }
  for (; i < rest.length; i++) {
    const f = rest[i]
    if (seen.has(f)) return bad(`repeated flag ${f}`)
    seen.add(f)
    if (bare.includes(f)) continue
    if (!valued.includes(f)) return bad(`flag or argument not allowed: ${f}`)
    const v = rest[++i]
    if (v === undefined || v === '') return bad(`${f} needs a value`)
    if (f === '--head') {
      if (!/^[A-Za-z0-9._/-]+$/.test(v)) return bad(`--head must be a plain branch name of this repository (got ${v})`)
      head = v
    }
  }
  if (kind === 'create' && !head) return bad('--head is required')
  return { kind, arg, head }
}

/** Returns the reason a PR command is refused, or null. */
export function decide({ command, branch, headSha, recorded }) {
  const c = check(command)
  if (c.error) return c.error
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
  const t = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want)
    if (!pass) bad++
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}`)
  }
  const okc = (c) => !check(c).error
  t('create ok', okc('gh pr create --head x --base master --title "a b" --draft'), true)
  t('merge ok', okc("gh pr merge 24 --merge --subject 's t'"), true)
  for (const c of ['/usr/bin/gh pr merge 24', 'gh -Rother/repo pr merge 24', 'gh pr create -Hother',
    'git push x && gh pr merge 24', 'gh pr create --head=x', 'gh pr create --head o:x', 'gh pr create', 'gh pr merge 24 --admin',
    'gh pr merge feat', 'GH_REPO=o/r gh pr merge 24', 'gh pr merge 24; gh pr merge 25', 'gh pr merge "24']) t(`block ${c}`, okc(c), false)
  t('candidates', ['gh pr mer\\ge 24', 'gh api --raw-field=t=x repos/o/r/pulls', '"gh" "pr" "merge"'].map(isCandidate), [true, true, true])
  t('not candidates', ['git push -u origin x', 'gh pr view 24', 'gh pr checks 24', 'gh pr edit 24 --body-file f', 'gh pr close 22', 'git commit -F msg.txt'].map(isCandidate), [false, false, false, false, false, false])
  t('equal allows', decide({ command: 'gh pr merge 1', branch: 'b', headSha: 'aaa', recorded: 'aaa' }), null)
  t('different blocks', decide({ command: 'gh pr merge 1', branch: 'b', headSha: 'bbb', recorded: 'aaa' }) !== null, true)
  t('collision-free path', recordFile('/p', 'feat/a') !== recordFile('/p', 'feat__a'), true)
  console.log(bad ? `${bad} FAILED` : 'all ok')
  process.exit(bad ? 1 : 0)
}

function resolveHead(dir, p) {
  const ghBin = process.env.GUARD_REVIEW_GH || 'gh'
  if (p.kind === 'create') {
    const branch = p.head
    const line = git(dir, 'ls-remote', 'origin', `refs/heads/${branch}`).split('\n')[0]
    const remote = line ? line.split(/\s+/)[0] : ''
    if (!remote) throw new Error(`branch ${branch} is not on origin; push the branch first`)
    let local = null
    try { local = git(dir, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`) } catch { /* no local branch */ }
    if (!local) throw new Error(`no local branch ${branch}`)
    if (local !== remote) throw new Error(`local ${branch} (${local}) differs from origin (${remote}); push the branch first`)
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
    // A non-candidate cannot contain a PR operation, so unreadable or command-less input that is not a
    // candidate is allowed: blocking every call on a format change would stop all work. A Bash call
    // without a string command is the one input-contract failure that is refused.
    let parsed
    try { parsed = JSON.parse(input) } catch { /* not JSON */ }
    const command = parsed?.tool_input?.command
    if (parsed?.tool_name === 'Bash' && typeof command !== 'string') block('hook input without a command (tool_name Bash); refusing')
    if (!isCandidate(input)) process.exit(0)
    if (typeof command !== 'string') block(`unreadable hook input that looks like a PR command; refusing. Allowed forms:\n  ${FORMS}`)
    const p = check(command)
    if (p.error) block(p.error)
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
