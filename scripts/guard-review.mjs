#!/usr/bin/env node
// Claude Code PreToolUse hook for Bash (audits 0.1.1-0.1.3): refuse `gh pr create` and
// `gh pr merge` while the branch has commits after its last review mark. Three audits in a row
// found commits that landed after the review.
//
// Record: .loctx/reviews/<branch>.sha (the branch name percent-encoded), the full SHA of the last
// reviewed commit. The .loctx is the common one, next to the git common dir (the main checkout's),
// also when the mark is written from a linked worktree (retro 0.1.7; the rule of
// scripts/test-server/common.sh). Write it after a review with no open findings:
//   node scripts/guard-review.mjs --mark --review <file> [<branch> [<sha>]]     (pnpm review:mark)
// <file> is the review record: it must hold a line `model: <name>`, and when .loctx/delegation.local.md
// names pl/code-reviewer or pl/doc-reviewer models, <name> must be one of them. The record keeps the
// SHA on its first line and `review: <file>` on its second.
//
// Activate the hook in .claude/settings.json (the user's file; the agent never edits settings):
//   { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
//       { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/guard-review.mjs\"" } ] } ] } }
//
// Exit 2 blocks the call and shows the reason to the agent; exit 0 lets it run.
// Self-test: node scripts/guard-review.mjs --test
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PH, parseShell } from './shell-words.mjs'

// Threat model: this hook stops the agent's own accidental or habitual PR create/merge without a
// review mark, including shell-quoting variants. It is not a sandbox against deliberate obfuscation
// (decoding a payload and piping it to a shell); AGENTS.md's red lines already forbid that.
// Detection is safe by default: every command line is read as text (any reading that spells a PR
// operation), exactly as before. The one exemption is a whole line of plain data commands
// (scripts/shell-words.mjs parses it): echo, printf, grep, cat, head, tail, wc, `git commit -m`,
// read-only `gh`, the file and listing programs of DATA_PROGS and git with the options of GIT_OPTS (retro 0.1.8),
// with no env assignment, wrapper or unlisted option, joined
// only by ; && || | and newlines. One other command anywhere puts the whole line back under the text
// rules. Input the parser cannot handle (too large or nested) is refused.
//
// Allowlist: a command that looks like a PR operation is allowed only in one canonical form,
// standing alone; everything else is refused with the forms to use.
export const FORMS = [
  'gh pr create --head <branch> [--base <b>] [--title <t>] [--body-file <f>] [--draft]',
  'gh pr merge <number> [--merge] [--subject <s>] [--body <b>] [--body-file <f>] [--delete-branch]',
  '(each flag as its own token with its value as the next token; the command stands alone: no ; && || | & newline ` $ < >, no env assignment, plain `gh`)',
].join('\n  ')

const SAFE_PR = new Set(['view', 'checks', 'list', 'diff', 'status', 'edit', 'close', 'comment', 'ready', 'reopen'])

// Text rules: the default for every command, and the only reading of hook input that is not JSON with a string command (so there
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
const REDIR = /^\d*(?:>>?|<|<>|>\||>&|&>)/
const REDIR_ONLY = /^\d*(?:>>?|<|<>|>\||>&|&>)$/

/**
 * Words without redirections (`2>/dev/null`, `> f`, `< f`, `>&2`, `<<< w`); `hasIn` when stdin comes from a file.
 * A quoted word (`quoted[i]`, from parseShell) is an argument, never a redirection (`"<"`; review 3).
 */
function stripRedirs(words, quoted = []) {
  const args = []
  let hasIn = false
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (quoted[i] || !REDIR.test(w)) { args.push(w); continue }
    if (/^\d*<(?!<)/.test(w)) hasIn = true
    if (REDIR_ONLY.test(w) || /^\d*<<<$/.test(w)) i++ // the operator stands alone: its target is the next word
  }
  return { args, hasIn }
}

// Plain data commands: they print, search or read files and run nothing. Options are limited to a
// small list per program; any other option makes the command "not plain" (so its line is scanned).
const PLAIN_OPTIONS = {
  echo: /^-[neE]+$/,
  printf: /^--$/,
  cat: /^-[nAbEsTv]+$/,
  head: /^-(?:[qv]|n|c|\d+)$/,
  tail: /^-(?:[qvf]|n|c|\d+)$/,
  wc: /^-[lwcmL]+$/,
  // sort: no -o/--output (writes a file) and no --compress-program (runs one) — review 1 F-2
  sort: /^-[bdfghiMnrRsuVz]*(?:[kt].*)?$/,
  grep: /^(?:-[a-zA-Z]+|--(?:ignore-case|invert-match|line-number|count|files-with-matches|files-without-match|word-regexp|line-regexp|regexp|extended-regexp|fixed-strings|no-messages|quiet|recursive|include|exclude|no-filename|with-filename|only-matching|max-count|context|after-context|before-context|null)(?:=.*)?)$/,
}
PLAIN_OPTIONS.egrep = PLAIN_OPTIONS.grep
PLAIN_OPTIONS.fgrep = PLAIN_OPTIONS.grep
const GREP_PROGRAMS = new Set(['grep', 'egrep', 'fgrep'])
// More plain programs (retro 0.1.8, user: "보호는 두고 오탐만 줄임" — about ten harmless lines were refused in 0.1.8):
// they read, list or compare files and run no program named in their arguments, whatever their options
// (sort can, so it has an option list above). A line that also runs git is checked for writes (isPlainLine).
const DATA_PROGS = new Set(['ls', 'cd', 'pwd', 'mkdir', 'cut', 'tr', 'diff', 'cmp', 'date', 'basename', 'dirname',
  'realpath', 'readlink', 'stat', 'du', 'df', 'file', 'nl', 'tac', 'rev', 'column', 'jq', 'true', 'false'])
// git: each subcommand with the options an agent writes by habit (user, after three reviews of the denylist found a
// way through each time: "git은 허용 옵션 목록으로"). Any other option — one that runs a program (--exec,
// --upload-pack, --ext-diff, -x, ...), writes a file (--output), or an abbreviation git would accept — makes the
// command not plain. Words that are not options (paths, refs, values) and everything after `--` are data.
const LOG_OPTS = String.raw`-\d+|-n\d*|-[psiS]|-[SG].+|--oneline|--stat|--shortstat|--numstat|--name-only|--name-status|--summary|--graph|--decorate(?:=\w+)?|--no-decorate|--all|--reverse|--no-merges|--merges|--first-parent|--follow|--abbrev-commit|--left-right|--cherry-pick|--no-patch|--patch|--source|--boundary|--no-color|--color(?:=\w+)?|--date=[\w-]+|--(?:format|pretty|since|until|after|before|author|committer|grep|max-count|skip|diff-filter|abbrev)=.*`
const GIT_OPTS = new Map(Object.entries({
  status: String.raw`-[sbz]+|-u(?:no|normal|all)?|--short|--branch|--porcelain(?:=v[12])?|--untracked-files(?:=(?:no|normal|all))?|--ignored|--ahead-behind|--no-ahead-behind`,
  log: LOG_OPTS,
  show: `${LOG_OPTS}|-q|--quiet`,
  diff: String.raw`-U\d+|-[wbRM]|--stat(?:=[\d,]+)?|--shortstat|--numstat|--name-only|--name-status|--summary|--cached|--staged|--check|--unified=\d+|--word-diff(?:=\w+)?|--color(?:=\w+)?|--no-color|--quiet|--exit-code|--ignore-all-space|--ignore-space-change|--diff-filter=\w+|--no-index|--merge-base|--find-renames`,
  add: '-[AuNfvn]+|--all|--update|--intent-to-add|--force|--verbose|--dry-run',
  restore: '-[SWqs]+|--staged|--worktree|--quiet|--source=.+',
  rm: '-[rfq]+|--cached|--quiet|--force',
  mv: '-[fkvn]+',
  fetch: String.raw`-[qpv]+|--quiet|--prune|--tags|--no-tags|--all|--depth=\d+|--unshallow|--verbose|--dry-run`,
  pull: '-[qv]+|--quiet|--ff-only|--ff|--no-ff|--rebase|--no-rebase|--prune|--tags|--no-edit',
  push: '-[qunvd]+|--quiet|--set-upstream|--tags|--follow-tags|--force-with-lease(?:=.+)?|--delete|--dry-run|--no-verify|--verbose',
  branch: '-[arvdDmMfu]+|--list|--show-current|--all|--remotes|--merged|--no-merged|--contains|--delete|--move|--force|--verbose|--no-color|--(?:set-upstream-to|sort|format)=.+',
  checkout: '-[bBqft]+|--detach|--track|--quiet|--force',
  switch: '-[cCqd]+|--detach|--create|--force-create|--quiet|--discard-changes',
  merge: '-[qm]|--quiet|--ff-only|--ff|--no-ff|--no-edit|--squash|--abort|--continue',
  'rev-parse': String.raw`-q|--quiet|--short(?:=\d+)?|--abbrev-ref|--verify|--show-toplevel|--git-dir|--git-common-dir|--absolute-git-dir|--is-inside-work-tree|--show-prefix|--symbolic-full-name`,
  'rev-list': String.raw`-n|-\d+|--count|--all|--left-right|--max-count=\d+|--reverse|--first-parent|--no-merges|--merges|--oneline`,
  'merge-base': '--is-ancestor|--all|--fork-point|--octopus',
  'ls-remote': '-[htbq]+|--heads|--tags|--branches|--refs|--quiet|--exit-code|--symref',
  'ls-files': '-[cdmosiuz]+|--others|--modified|--deleted|--cached|--stage|--exclude-standard|--error-unmatch|--ignored|--full-name',
  worktree: '-[bBfqv]+|--force|--detach|--porcelain|--quiet|--verbose|--expire=.+',
  tag: String.raw`-[lda]|-n\d*|-m|--list|--delete|--contains|--points-at|--(?:sort|format)=.+`,
  remote: '-v|--verbose',
  describe: String.raw`--tags|--always|--dirty|--exact-match|--long|--all|--abbrev=\d+`,
  shortlog: '-[sne]+|--summary|--numbered|--email|--all|--no-merges|--since=.+',
  blame: String.raw`-L.*|-[wselnf]+|--porcelain|--line-porcelain|--date=[\w-]+`,
  reflog: String.raw`-n\d*|-\d+|--oneline|--all|--date=[\w-]+|--format=.+`,
  'cat-file': '-[tspe]',
  'check-ignore': '-[vqn]+|--verbose|--quiet|--non-matching|--no-index',
  stash: '-[uqmp]|--include-untracked|--quiet|--stat|--patch',
}).map(([k, v]) => [k, new RegExp(`^(?:${v})$`)]))
const GIT_COMMIT_BARE = new Set(['-q', '-a', '-s', '-am', '-qm', '--amend', '--no-edit', '--allow-empty'])
const GIT_COMMIT_VALUED = new Set(['-m', '-F', '--message', '--file'])
const GH_BANNED = new Set(['--web', '-w', '-F', '--body-file', '--editor', '-e'])

/** `gh` words (after gh): a subcommand that only reads or edits, never creates or merges. */
function ghSafe(rest) {
  // Before a subcommand name only -R/--repo/-H/--hostname with their value: gh takes the word after any other flag
  // (-t, --subject, ...) as that flag's value and the next word as the subcommand (review 5 G-1).
  const nextNonFlag = (from) => {
    let j = from
    while (j < rest.length) {
      if (GH_VALUE_FLAGS.has(rest[j])) { j += 2; continue }
      if (/^--(?:repo|hostname)=/.test(rest[j])) { j++; continue }
      if (rest[j].startsWith('-')) return -1
      return j
    }
    return -1
  }
  if (rest.some((x) => GH_BANNED.has(x) || /^--(?:web|body-file|editor)=/.test(x))) return false
  const a = nextNonFlag(0)
  if (a < 0 || rest[a].includes(PH)) return false
  if (rest[a] === 'run' || rest[a] === 'issue') return true
  if (rest[a] !== 'pr') return false
  const b = nextNonFlag(a + 1)
  return b >= 0 && !rest[b].includes(PH) && SAFE_PR.has(rest[b])
}

/** A plain data command: no env assignment, no wrapper, no option outside the small lists. */
function isPlainData(seg) {
  const { args } = stripRedirs(seg.words, seg.quoted)
  if (args.length === 0 || args[0].includes(PH)) return false
  const prog = args[0]
  const rest = args.slice(1)
  // git and gh read their words as a subcommand: a here-string, or a standalone redirection operator before anything
  // but /dev/null or a descriptor, is not plain for them (review 3 H-1)
  if ((prog === 'git' || prog === 'gh') && seg.words.some((w, i) => w.includes('<<<') ||
    (!seg.quoted[i] && REDIR_ONLY.test(w) && !/^(?:\/dev\/null|\d+-?|-)$/.test(seg.words[i + 1] ?? '')))) return false
  // a word whose value the shell computes ($x, $(..), $_, brace expansion {a,b} or {a..b}) can turn into an option
  // of a program that reads options as commands; `stash@{0}` has no comma (review 4 F-3)
  if (['git', 'gh', 'sort', 'uniq'].includes(prog) && rest.some((w) => w.includes(PH) || /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(w))) return false
  if (PLAIN_OPTIONS[prog]) {
    return rest.every((x) => !x.startsWith('-') || x === '-' || PLAIN_OPTIONS[prog].test(x))
  }
  if (DATA_PROGS.has(prog)) return true
  // uniq writes its second operand: one operand at most, and only the listed options (review 2 G-2)
  if (prog === 'uniq') {
    let operands = 0
    for (let i = 0; i < rest.length; i++) {
      const x = rest[i]
      if (/^-[fsw]$/.test(x)) { i++; continue }
      if (x === '-' || !x.startsWith('-')) operands++
      else if (!/^-(?:[cdDiuz]+|[fsw]\d+)$|^--(?:count|repeated|all-repeated|ignore-case|unique|zero-terminated|(?:skip-fields|skip-chars|check-chars)=\d+)$/.test(x)) return false
    }
    return operands <= 1
  }
  if (prog === 'git') {
    // `git -C <dir>` and `--no-pager` only; any other option before the subcommand (-c, --exec-path, ...) is not plain
    let k = 0
    for (;;) {
      if (rest[k] === '-C' && rest[k + 1] !== undefined && !rest[k + 1].includes(PH)) k += 2
      else if (rest[k] === '--no-pager') k++
      else break
    }
    const sub = rest[k]
    const opts = rest.slice(k + 1)
    if (sub === 'commit') {
      for (let i = 0; i < opts.length; i++) {
        const x = opts[i]
        if (GIT_COMMIT_VALUED.has(x)) { if (opts[++i] === undefined) return false } else if (!GIT_COMMIT_BARE.has(x)) return false
      }
      return true
    }
    const ok = GIT_OPTS.get(sub)
    if (!ok) return false
    for (const x of opts) {
      // after `--` come paths, except for pull, which hands those words to fetch as options (review 4 F-2)
      if (x === '--' && sub !== 'pull') return true
      if (x.startsWith('-') && !ok.test(x)) return false
    }
    return true
  }
  if (prog === 'gh') return ghSafe(rest)
  return false
}

/**
 * True when the whole line is plain data commands: every simple command is plain (see isPlainData),
 * joined only by ; && || | and newlines (pipes thus only between plain commands), with redirections to
 * files and here-documents only into those commands. A subshell, process substitution, background
 * `&`, unterminated quote or any other command anywhere keeps the line out.
 */
function isPlainLine(command) {
  const segs = parseShell(command)
  if (segs.weird || segs.length === 0 || !segs.every(isPlainData)) return false
  // git runs what its config, attributes and hooks name: a line that runs git and also writes a file
  // (anything but /dev/null or another descriptor) or names a git file is not plain (review 1 F-2)
  if (!segs.some((s) => stripRedirs(s.words, s.quoted).args[0] === 'git')) return true
  return !segs.some((s) => writesFile(s.words) || s.words.some((w) => GIT_FILE.test(w)))
}

const GIT_FILE = /(?:^|[/=:])\.git(?:$|\/|attributes|config|modules)|\/git\/(?:config|attributes)$/
/** A word that writes to a file. Any `>` counts, also inside a word: the parser leaves `a>f` as one word. */
function writesFile(words) {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    // `>&2` copies a descriptor; a standalone `>&` before a word that is not a descriptor writes that file (review 2 G-2)
    if (/^\d*>&$/.test(w)) { if (/^(?:\d+-?|-|\/dev\/null)$/.test(words[i + 1] ?? '')) { i++; continue } return true }
    if (!w.includes('>') || /^\d*>&\d+-?$|^\d*>&-$/.test(w) || /^\d*(?:>>?|&>>?|>\|)\/dev\/null$/.test(w)) continue
    if (/^\d*(?:>>?|&>>?|>\|)$/.test(w) && words[i + 1] === '/dev/null') { i++; continue }
    return true
  }
  return false
}

const MAX_INPUT = 100000

/**
 * Candidate check on the raw hook input. A line of plain data commands (echo, printf, grep, cat,
 * head, tail, wc, sort, `git commit -m`, read-only `gh`, DATA_PROGS and git with the options of
 * GIT_OPTS; see isPlainData and isPlainLine) is not a candidate: the PR
 * words in its quoted arguments and here-documents are data. Every other line is read with the text
 * rules below, exactly as before: any reading of the text that spells a PR operation.
 * Fails closed: input too large or too nested for the parser is a candidate.
 */
export function isCandidate(raw) {
  const text = String(raw ?? '')
  try {
    if (text.length > MAX_INPUT) return true
    const views = [text, decodeEscapes(text)]
    let c
    try { c = JSON.parse(text)?.tool_input?.command } catch { /* not JSON: raw views only */ }
    if (typeof c === 'string') {
      if (isPlainLine(c)) return false
      views.push(c)
    }
    // shell line continuations (backslash-newline) vanish before the shell splits words: join them first
    for (const v of [...views]) views.push(v.replace(/\\\r?\n/g, ''))
    // ANSI-C / locale quoting ($'..', $"..") can spell any word: always a candidate
    return views.some((v) => /\$['"]/.test(v) || looksLikePr(v.replace(/\\/g, ' ').replace(/['"]/g, '')) || looksLikePr(v.replace(/[\\'"]/g, '')))
  } catch {
    return true
  }
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

/** The folder that holds the common .loctx: the parent of the git common dir (the main checkout, also from a linked worktree). */
export function commonRoot(dir) {
  return dirname(git(dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || git(process.cwd(), 'rev-parse', '--show-toplevel')
}

function readRecord(dir, branch) {
  try { return readFileSync(recordFile(commonRoot(dir), branch), 'utf8').split('\n')[0].trim() || null } catch { return null }
}

function fail(msg) { console.error(`guard-review: ${msg}`); process.exit(1) }

const MARK_FORM = 'pnpm review:mark --review <file> [<branch>] [<commit>]'

/** Models the personal delegation table names for the review roles (pl/code-reviewer, pl/doc-reviewer), or null. */
export function reviewerModels(text) {
  const names = []
  for (const line of String(text).split('\n')) {
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 3 || !/^pl\/(code|doc)-reviewer$/.test(cells[1])) continue
    for (const entry of cells[2].split(',').map((e) => e.trim()).filter(Boolean)) names.push(entry, entry.split(/\s+/).pop())
  }
  return names.length ? names : null
}

function mark(args) {
  const i = args.indexOf('--review')
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) fail(`a review record is required: ${MARK_FORM}`)
  const review = args[i + 1]
  const rest = args.filter((_, k) => k !== i && k !== i + 1)
  const dir = projectDir()
  const root = commonRoot(dir)
  const reviewPath = resolve(process.cwd(), review)
  if (!existsSync(reviewPath) || !statSync(reviewPath).isFile()) fail(`review record ${review} does not exist (${MARK_FORM})`)
  const models = [...readFileSync(reviewPath, 'utf8').matchAll(/^model:[ \t]*(\S.*?)[ \t]*$/gm)].map((m) => m[1])
  const model = models.join(', ')
  if (models.length === 0) fail(`review record ${review} has no \`model: <name>\` line (${MARK_FORM})`)
  let table = null
  try { table = reviewerModels(readFileSync(join(root, '.loctx', 'delegation.local.md'), 'utf8')) } catch { /* no personal table */ }
  const unlisted = table ? models.find((m) => !table.includes(m)) : undefined
  if (unlisted) fail(`review record model ${unlisted} is not a pl/code-reviewer or pl/doc-reviewer model of .loctx/delegation.local.md (${[...new Set(table)].join(', ')})`)
  const branch = rest[0] || git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
  let tip
  try { tip = git(dir, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`) } catch { fail(`no local branch ${branch}`) }
  let sha = tip
  if (rest[1]) {
    try { sha = git(dir, 'rev-parse', '--verify', `${rest[1]}^{commit}`) } catch { fail(`unknown commit ${rest[1]}`) }
    try { git(dir, 'merge-base', '--is-ancestor', sha, tip) } catch { fail(`${sha} is not the tip of ${branch} or one of its ancestors`) }
  }
  const file = recordFile(root, branch)
  mkdirSync(join(root, '.loctx', 'reviews'), { recursive: true })
  writeFileSync(file, `${sha}\nreview: ${review}\n`)
  console.log(`guard-review: recorded ${sha} for ${branch} (${file}), review ${review} by ${model}`)
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
  t('mentions are data', ['echo "gh pr merge 24" > prompt.md', "grep -n '^codex$' f", "python3 - <<'EOF'\nPR 28 merge, create notes\nEOF"].map(cand), [false, false, false])
  t('command words are candidates', ['git push x && gh pr merge 24', 'sh -c "gh pr merge 24"', 'env GH_REPO=o/r gh pr create --head b', "gh pr $'\\155erge' 24"].map(cand), [true, true, true, true])
  t('equal allows', decide({ command: 'gh pr merge 1', branch: 'b', headSha: 'aaa', recorded: 'aaa' }), null)
  t('different blocks', decide({ command: 'gh pr merge 1', branch: 'b', headSha: 'bbb', recorded: 'aaa' }) !== null, true)
  t('reviewer models', reviewerModels('| pl/code-reviewer | openai gpt-x | c |\n| implementer/code | claude y | c |\n| pl/doc-reviewer | claude z | c |'), ['openai gpt-x', 'gpt-x', 'claude z', 'z'])
  t('several models in one cell', reviewerModels('| pl/code-reviewer | openai model-a, openai model-b | c |'), ['openai model-a', 'model-a', 'openai model-b', 'model-b'])
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
  const handle = () => {
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
  }
  // fail closed: a parser error, a size or nesting limit, or any other failure refuses the call
  process.stdin.on('end', () => {
    try { handle() } catch (e) {
      console.error(`guard-review: failed closed (${String(e?.message ?? e).split('\n')[0]}); refusing. Allowed forms:\n  ${FORMS}`)
      process.exit(2)
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, ...rest] = process.argv.slice(2)
  if (a === '--test') selfTest()
  else if (a === '--mark') mark(rest)
  else hook()
}
