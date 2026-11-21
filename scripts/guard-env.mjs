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
 * The text the compose rules read: the command as simple commands, each as its words, with the `-f X`
 * of plain docker commands removed. Everything else stays as text, so a compose command is found
 * wherever it is written (behind redirections, sudo, sh -c, find -exec, ...). On any parser error
 * or limit the raw command is read, which can only refuse more.
 */
function composeTexts(cmd) {
  try {
    if (cmd.length > MAX_INPUT) return [cmd]
    return parseShell(cmd).map((seg) => {
      let w = seg.words
      if (isPlainDocker(w)) w = w.filter((x, i) => !(x === '-f' || w[i - 1] === '-f'))
      const d = w.indexOf('docker')
      if (d >= 0 && w.slice(0, d).every((x) => ASSIGN.test(x))) { // `docker --context x compose ...` reads as `docker compose ...`
        let j = d + 1
        while (j < w.length && w[j].startsWith('-')) j += DOCKER_VALUE_FLAGS.has(w[j]) ? 2 : 1
        if (w[j] === 'compose') w = [...w.slice(0, d + 1), ...w.slice(j)]
      }
      return [w.join(' '), ...seg.heredocs].join('\n').replaceAll(PH, '$')
    })
  } catch {
    return [cmd]
  }
}

/** Returns the reason a command is refused, or null. */
export function refuse(command) {
  const raw = String(command ?? '')
  for (const cmd of composeTexts(raw)) { // each simple command on its own
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
    try { command = JSON.parse(input)?.tool_input?.command ?? '' } catch { process.exit(0) }
    const why = refuse(command)
    if (why) { console.error(`guard-env: ${why}`); process.exit(2) }
    process.exit(0)
  })
}
