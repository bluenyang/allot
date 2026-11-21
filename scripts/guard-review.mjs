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
import { LEADERS, PH, SHELLS, WRAPPERS, baseName, parseShell } from './shell-words.mjs'

// Threat model: this hook stops the agent's own accidental or habitual PR create/merge without a
// review mark, including shell-quoting variants. It is not a sandbox against deliberate obfuscation
// (decoding a payload and piping it to a shell); AGENTS.md's red lines already forbid that.
// Detection looks at command words (scripts/shell-words.mjs splits the command into simple
// commands): quoted text, heredoc bodies and comments are data, not PR operations.
//
// Allowlist: a command that looks like a PR operation is allowed only in one canonical form,
// standing alone; everything else is refused with the forms to use.
export const FORMS = [
  'gh pr create --head <branch> [--base <b>] [--title <t>] [--body-file <f>] [--draft]',
  'gh pr merge <number> [--merge] [--subject <s>] [--body <b>] [--body-file <f>] [--delete-branch]',
  '(each flag as its own token with its value as the next token; the command stands alone: no ; && || | & newline ` $ < >, no env assignment, plain `gh`)',
].join('\n  ')

const SAFE_PR = new Set(['view', 'checks', 'list', 'diff', 'status', 'edit', 'close', 'comment', 'ready', 'reopen'])

// Legacy text reading, used only for hook input that is not JSON with a string command (so there
// are no command words to look at): any reading of the text that spells a PR operation.
// `gh pr` followed by anything but a literal safe subcommand (so `gh pr ${x}ge`, `gh pr $(echo merge)`)
const UNKNOWN_PR = new RegExp(`\\bgh\\s+pr\\s+(?!(?:${[...SAFE_PR].join('|')})(?=$|[\\s"'}\\],\\\;&|)]))`)
const looksLikePr = (t) =>
  (/\bgh\b/.test(t) && /\bpr\b/.test(t) && /\b(create|merge)\b/.test(t)) ||
  (/\bgh\b/.test(t) && /\bapi\b/.test(t) && /\b(pulls|merge)\b/.test(t)) ||
  UNKNOWN_PR.test(t)

const decodeEscapes = (t) =>
  t.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([tnr/bf"\\])/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f' })[c] ?? c)

const GH_VALUE_FLAGS = new Set(['-R', '--repo', '-H', '--hostname'])

/** After `gh`: is this `gh pr <not a safe subcommand>` or `gh api` touching pulls or merge? */
function ghCandidate(rest) {
  const nextNonFlag = (from) => {
    let j = from
    while (j < rest.length) {
      if (GH_VALUE_FLAGS.has(rest[j])) { j += 2; continue }
      if (rest[j].startsWith('-')) { j++; continue }
      return j
    }
    return -1
  }
  const a = nextNonFlag(0)
  if (a < 0) return false
  if (rest[a].includes(PH)) return true // the subcommand is only known at run time
  if (rest[a] === 'api') return rest.slice(a + 1).some((x) => x.includes(PH) || /\b(pulls|merge)\b/.test(x))
  if (rest[a] !== 'pr') return false
  const b = nextNonFlag(a + 1)
  if (b < 0) return false
  return rest[b].includes(PH) || !SAFE_PR.has(rest[b])
}

function segmentCandidate(seg, depth) {
  const w = seg.words
  let k = 0
  while (k < w.length && (/^[A-Za-z_]\w*=/.test(w[k]) || LEADERS.has(w[k]))) k++
  if (k >= w.length) return false
  let prog = baseName(w[k])
  // env/sudo/xargs/... run the next program: look through them to the gh or shell they start
  for (let guard = 0; WRAPPERS.has(prog) && guard < 4; guard++) {
    const j = w.findIndex((x, idx) => idx > k && (baseName(x) === 'gh' || SHELLS.has(baseName(x)) || WRAPPERS.has(baseName(x))))
    if (j < 0) {
      return depth < 4 && w.slice(k + 1).some((x) => /\s/.test(x) && isCommandCandidate(x, depth + 1))
    }
    k = j
    prog = baseName(w[k])
  }
  if (prog === 'gh') return ghCandidate(w.slice(k + 1))
  if (w[k].includes(PH)) return w.slice(k + 1, k + 4).some((x) => x === 'pr' || x === 'api') // `$GH pr merge`
  if (SHELLS.has(prog) && depth < 4) {
    const args = w.slice(k + 1)
    return args.some((x) => isCommandCandidate(x, depth + 1)) ||
      (prog === 'eval' && isCommandCandidate(args.join(' '), depth + 1)) ||
      seg.heredocs.some((b) => isCommandCandidate(b, depth + 1))
  }
  return false
}

/** True when a command word (not quoted data, not a heredoc body) starts a PR operation. */
function isCommandCandidate(command, depth = 0) {
  return [false, true].some((nlSpace) => parseShell(command, { nlSpace }).some((seg) => segmentCandidate(seg, depth)))
}

/**
 * Candidate check on the raw hook input. A candidate is a simple command whose program is `gh`
 * (also behind env/sudo/command/xargs..., or inside `sh -c`, `eval` or a script fed to a shell)
 * followed by `pr` and anything but a safe subcommand, or by `api` and pulls/merge. Text that only
 * mentions those words (echo, printf, heredoc bodies, quoted arguments, comments) is data.
 * Input that is not JSON with a string command has no command words: it is read as text, as before.
 */
export function isCandidate(raw) {
  const text = String(raw ?? '')
  let command
  try { command = JSON.parse(text)?.tool_input?.command } catch { /* not JSON */ }
  if (typeof command === 'string') return isCommandCandidate(command)
  const views = [text, decodeEscapes(text)]
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
  const cand = (c) => isCandidate(JSON.stringify({ tool_name: 'Bash', tool_input: { command: c } }))
  t('mentions are data', ['echo "gh pr merge 24" > prompt.md', "grep -n '^codex$' f", "python3 - <<'EOF'\nPR 28 merge, gh pr create\nEOF"].map(cand), [false, false, false])
  t('command words are candidates', ['git push x && gh pr merge 24', 'sh -c "gh pr merge 24"', 'env GH_REPO=o/r gh pr create --head b', "gh pr $'\\155erge' 24"].map(cand), [true, true, true, true])
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
