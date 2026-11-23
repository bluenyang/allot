#!/usr/bin/env node
// Claude Code PreToolUse hook for Bash (audit 0.1.1 A-1): block shell commands that would load
// or print a real env file. File-tool deny rules do not cover a program that reads the file for
// the agent (docker compose env_file, source, cat).
//
// Activate it in .claude/settings.local.json (the user's file; the agent never edits settings):
//   { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
//       { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/guard-env.mjs\"" } ] } ] } }
//
// Exit 2 blocks the call and shows the reason to the agent; exit 0 lets it run.
// Self-test: node scripts/guard-env.mjs --test
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PH, parseShell } from './shell-words.mjs'

const ALLOWED_ENV = /\.env\.(example|dev)\b/

const ASSIGN = /^[A-Za-z_]\w*=/
// options of `docker` that take a value in the next word
const DOCKER_VALUE_FLAGS = new Set(['--context', '-c', '-H', '--host', '--config', '-l', '--log-level'])
const MAX_INPUT = 100000

/**
 * A docker command that is not compose and mentions no compose: its `-f` is not a compose file
 * (`inspect -f` format, `rm -f` force, `logs -f` follow, `ps -f` filter). Only this is exempt.
 */
function isPlainDocker(words) {
  let k = 0
  while (k < words.length && ASSIGN.test(words[k])) k++
  if (words[k] !== 'docker') return false
  let j = k + 1
  while (j < words.length && words[j].startsWith('-')) j += DOCKER_VALUE_FLAGS.has(words[j]) ? 2 : 1
  if (words[j] === undefined || words[j] === 'compose') return false
  return !words.some((w) => w === 'compose' || w === 'docker-compose' || w.includes(PH))
}

/**
 * The texts the compose rules read. By default the whole command, as written (so a compose command
 * is found wherever it is: behind sudo, redirections, sh -c, find -exec, ...).
 * The one exemption: a line whose every simple command is a plain `docker` / `docker-compose`
 * command (no env assignment, wrapper or here-document, joined only by ; && || | and newlines) is
 * read command by command, with the `-f X` of docker commands that are not compose removed.
 * Throws on input the parser cannot take.
 */
function composeTexts(cmd) {
  if (cmd.length > MAX_INPUT) throw new Error('command too large')
  const segs = parseShell(cmd)
  const dockerOnly = !segs.weird && segs.length > 0 &&
    segs.every((s) => (s.words[0] === 'docker' || s.words[0] === 'docker-compose') && s.heredocs.length === 0)
  if (!dockerOnly) return [cmd]
  return segs.map((seg) => {
    let w = seg.words
    if (isPlainDocker(w)) w = w.filter((x, i) => !(x === '-f' || w[i - 1] === '-f'))
    if (w[0] === 'docker') { // `docker --context x compose ...` reads as `docker compose ...`
      let j = 1
      while (j < w.length && w[j].startsWith('-')) j += DOCKER_VALUE_FLAGS.has(w[j]) ? 2 : 1
      if (w[j] === 'compose') w = ['docker', ...w.slice(j)]
    }
    return w.join(' ').replaceAll(PH, '$')
  })
}

// Recursive searches (audit rc.3 F-4, retro 0.1.7): `grep -r x docker/` reads docker/.env.example
// although the command names no env file. A recursive grep or an rg over a folder that holds `.env*`
// files is refused unless every such file is left out by an --exclude (grep) or a `!` glob (rg),
// or is outside every --include / positive glob.
const GREP_VALUE_SHORT = new Set('efmABCdD')
const GREP_VALUE_LONG = new Set(['regexp', 'file', 'max-count', 'after-context', 'before-context', 'context', 'include', 'exclude',
  'exclude-dir', 'exclude-from', 'directories', 'devices', 'label', 'binary-files', 'group-separator'])
const RG_VALUE_SHORT = new Set('efgtTmABCMjErd')
const RG_VALUE_LONG = new Set(['regexp', 'file', 'glob', 'iglob', 'type', 'type-not', 'type-add', 'type-clear', 'max-count', 'after-context',
  'before-context', 'context', 'max-columns', 'threads', 'encoding', 'replace', 'max-depth', 'max-filesize', 'ignore-file', 'pre',
  'pre-glob', 'sort', 'sortr', 'path-separator', 'colors', 'context-separator', 'field-match-separator', 'field-context-separator', 'dfa-size-limit', 'regex-size-limit'])
const SKIP_DIRS = new Set(['node_modules', '.git'])
const MAX_WALK = 20000

/** A shell glob (*, ?, [..]) as a RegExp over a file's base name. */
function globRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '[') {
      const j = glob.indexOf(']', i + 2)
      if (j < 0) { re += '\\['; continue }
      re += `[${glob.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
      i = j
    } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
const globMatches = (glob, name) => { try { return globRe(glob.split('/').pop() || glob).test(name) } catch { return false } }

/** Reads the words of a grep or rg command: { recursive, paths, includes, excludes }, or null when it is neither. */
function searchArgs(words) {
  let k = 0
  while (k < words.length && ASSIGN.test(words[k])) k++
  const prog = String(words[k] ?? '').split('/').pop()
  const isRg = prog === 'rg'
  if (!isRg && !['grep', 'egrep', 'fgrep'].includes(prog)) return null
  const shortV = isRg ? RG_VALUE_SHORT : GREP_VALUE_SHORT
  const longV = isRg ? RG_VALUE_LONG : GREP_VALUE_LONG
  let recursive = isRg
  let patternGiven = false
  const positional = []
  const includes = []
  const excludes = []
  const option = (name, value) => {
    if (name === 'e' || name === 'f' || name === 'regexp' || name === 'file') patternGiven = true
    if (!isRg && (name === 'include')) includes.push(value)
    if (!isRg && (name === 'exclude')) excludes.push(value)
    if (!isRg && (name === 'd' || name === 'directories') && value === 'recurse') recursive = true
    if (isRg && (name === 'g' || name === 'glob' || name === 'iglob')) (value.startsWith('!') ? excludes : includes).push(value.replace(/^!/, ''))
  }
  const rest = words.slice(k + 1)
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]
    if (w === '--') { positional.push(...rest.slice(i + 1)); break }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=')
      const name = w.slice(2, eq < 0 ? undefined : eq)
      if (!isRg && (name === 'recursive' || name === 'dereference-recursive')) recursive = true
      if (eq >= 0) option(name, w.slice(eq + 1))
      else if (longV.has(name)) option(name, rest[++i] ?? '')
      continue
    }
    if (w.startsWith('-') && w.length > 1) {
      for (let j = 1; j < w.length; j++) {
        const c = w[j]
        if (!isRg && (c === 'r' || c === 'R')) recursive = true
        if (shortV.has(c)) { option(c, j + 1 < w.length ? w.slice(j + 1) : (rest[++i] ?? '')); break }
      }
      continue
    }
    positional.push(w)
  }
  if (!recursive) return null
  const paths = positional.slice(patternGiven ? 0 : 1) // without -e/-f the first word is the pattern
  return { paths: paths.length ? paths : ['.'], includes, excludes }
}

/** Base names of the `.env*` files under `path` (a folder), or null when the walk is cut short. */
function envFilesUnder(path) {
  const found = new Set()
  const stack = [path]
  let seen = 0
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (++seen > MAX_WALK) return null
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(join(dir, e.name)) } else if (/^\.env/.test(e.name)) found.add(e.name)
    }
  }
  return [...found]
}

/** The reason a recursive grep or rg over folders holding env files is refused, or null. */
function recursiveSearch(raw, cwd) {
  for (const seg of parseShell(raw)) {
    const s = searchArgs(seg.words)
    if (!s) continue
    for (const p of s.paths) {
      const hint = `Exclude env files (grep --exclude='.env*', rg -g '!.env*') or name the folders without them.`
      if (p.includes(PH)) return `A recursive search over a path only known at run time (${p.replaceAll(PH, '$')}) could read an env file. ${hint}`
      const abs = resolve(cwd, p)
      let st
      try { st = statSync(abs) } catch { continue }
      if (!st.isDirectory()) continue
      const names = envFilesUnder(abs)
      if (names === null) {
        if (s.excludes.some((g) => ['.env', '.env.example', '.env.x'].every((n) => globMatches(g, n)))) continue
        return `A recursive search over ${p} (too large to scan for env files) could read one. ${hint}`
      }
      const read = names.filter((n) => !s.excludes.some((g) => globMatches(g, n)) && (s.includes.length === 0 || s.includes.some((g) => globMatches(g, n))))
      if (read.length) return `A recursive search over ${p} would read ${read.join(', ')} (AGENTS.md Red lines, C4). ${hint}`
    }
  }
  return null
}

/** Returns the reason a command is refused, or null. `cwd`: where the command runs (the hook input's cwd). */
export function refuse(command, { cwd = process.cwd() } = {}) {
  const raw = String(command ?? '')
  let texts
  try {
    texts = composeTexts(raw)
  } catch {
    return 'The command is malformed (unterminated quote or substitution), too large or too deeply nested to check. Fix or split it into simple commands.'
  }
  let search = null
  try { search = recursiveSearch(raw, cwd) } catch { search = 'The command could not be checked for a recursive search over env files. Split it into simple commands.' }
  if (search) return search
  for (const cmd of texts) {
  if (/\bdocker[ -]compose\b/.test(cmd)) {
    // `config` prints env_file values unless told not to resolve them
    if (/\bconfig\b/.test(cmd) && !/--no-env-resolution\b/.test(cmd)) {
      return 'docker compose config without --no-env-resolution expands env_file values (docker/.env). Add --no-env-resolution and --env-file docker/.env.example.'
    }
    // only the dev stack may run here; compose.yaml (production example) loads docker/.env
    const files = [...cmd.matchAll(/(?:-f|--file)[ =](\S+)/g)].map((m) => m[1])
    const isConfigOnly = /\bconfig\b/.test(cmd)
    if (!isConfigOnly && (files.length === 0 || files.some((f) => !/compose\.dev\.yaml$/.test(f) && !/\.loctx\//.test(f)))) {
      return 'Local servers use docker/compose.dev.yaml only (docker/compose.yaml is the production example and loads docker/.env). Pass -f docker/compose.dev.yaml.'
    }
  }
  }
  // reading or loading an env file through the shell
  const envRef = /(^|[\s'"=/])\.env(\.[\w-]+)?(?=$|[\s'";|&)])/g
  for (const m of raw.matchAll(envRef)) {
    const name = m[0].trim().replace(/^['"=/]/, '')
    if (ALLOWED_ENV.test(name)) continue
    if (/\b(cat|less|more|head|tail|bat|grep|rg|awk|sed|source|xargs|env|export|dotenv|direnv)\b|(^|[;&|]\s*)\.\s/.test(raw) || /--env-file[ =]\S*\.env\b/.test(raw)) {
      return `The command would read ${name}. Real env files are never read (AGENTS.md Red lines, C4); use docker/.env.example or docker/.env.dev.`
    }
  }
  return null
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (!isMain) {
  // imported by the unit tests: export only
} else if (process.argv[2] === '--test') {
  const cases = [
    ['docker compose -f docker/compose.dev.yaml up -d --build -V --wait', false],
    ['docker compose -f docker/compose.dev.yaml -f .loctx/reports/0.1.1/test/compose.rls.yaml up -d api', false],
    ['docker compose -f docker/compose.dev.yaml exec -T api pnpm db:seed', false],
    ['docker compose -f docker/compose.yaml --env-file docker/.env.example config --no-env-resolution', false],
    ['docker compose -f docker/compose.yaml up -d', true],
    ['docker compose up -d', true],
    ['docker compose -f docker/compose.yaml --env-file docker/.env.example config > out.log', true],
    ['docker-compose -f docker/compose.yaml config', true],
    ['cat docker/.env', true],
    ['grep SECRET docker/.env', true],
    ['set -a; . docker/.env; set +a', true],
    ['set -a; . docker/.env.dev; set +a', false],
    ['source .env', true],
    ['grep -E "^(ADMIN_EMAIL)=" docker/.env.dev', false],
    ['cat docker/.env.example', false],
    ['git status', false],
    ['pnpm typecheck', false],
    ['docker inspect -f "{{.State.Status}}" allot-rc', false],
    ['docker rm -f allot-rc', false],
    ['docker logs -f allot-rc', false],
    ['docker compose -f docker/compose.dev.yaml ps && docker inspect -f x c && docker rm -f c', false],
    ['docker compose -f docker/compose.dev.yaml up -d && docker compose up -d', true],
    ['docker rm -f c && docker compose -f docker/compose.yaml up -d', true],
    ['sudo docker compose up -d', true],
    ['sh -c "docker compose up -d"', true],
    ['docker compose logs -f api', true],
    // recursive searches over a folder that holds env files (audit rc.3 F-4); run from the repository root
    ['grep -rn SECRET docker/', true],
    ['grep -R SECRET docker', true],
    ['grep --recursive SECRET docker', true],
    ['grep -r SECRET .', true],
    ['grep -r SECRET', true],
    ['grep -rn -e SECRET docker', true],
    ['rg SECRET docker', true],
    ['rg -n SECRET', true],
    ['grep -r SECRET src docker', true],
    ['cd x && grep -rl SECRET docker/ | head', true],
    ["grep -rn --include='*.yaml' SECRET docker", false],
    ["grep -rn --include='*' SECRET docker", true],
    ["grep -rn --exclude='.env*' SECRET docker/", false],
    ['grep -rn --exclude=.env* SECRET docker/', false],
    ["grep -rn --exclude '.env*' SECRET docker/", false],
    ["rg -g '!.env*' SECRET docker", false],
    ["rg --glob '!.env*' SECRET docker", false],
    ['rg --glob=!.env* SECRET docker', false],
    ['grep -rn "$X" docker --exclude=*.md', true],
    ['grep -rn SECRET "$DIR"', true],
    // a named non-env file, or folders without env files, stay allowed
    ['grep -n SECRET docker/compose.yaml', false],
    ['grep SECRET docker', false],
    ['grep -rn SECRET src/ server/ tests/', false],
    ['rg -n SECRET src server', false],
    ['grep -rn docker src', false],
    ['grep -r -e docker -- src', false],
  ]
  let bad = 0
  for (const [c, want] of cases) {
    const got = refuse(c) !== null
    if (got !== want) bad++
    console.log(`${got === want ? 'ok  ' : 'FAIL'} ${want ? 'block' : 'allow'}  ${c}`)
  }
  console.log(bad ? `${bad} FAILED` : 'all ok')
  process.exit(bad ? 1 : 0)
} else {
  let input = ''
  process.stdin.on('data', (d) => { input += d })
  process.stdin.on('end', () => {
    let command = ''
    let cwd = process.cwd()
    try {
      const j = JSON.parse(input)
      command = j?.tool_input?.command ?? ''
      if (typeof j?.cwd === 'string' && j.cwd) cwd = j.cwd
    } catch { process.exit(0) }
    const why = refuse(command, { cwd })
    if (why) { console.error(`guard-env: ${why}`); process.exit(2) }
    process.exit(0)
  })
}
