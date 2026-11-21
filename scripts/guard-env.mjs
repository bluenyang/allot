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
import { LEADERS, SHELLS, WRAPPERS, baseName, parseShell } from './shell-words.mjs'

const ALLOWED_ENV = /\.env\.(example|dev)\b/

const ASSIGN = /^[A-Za-z_]\w*=/
// options of `docker` / `docker compose` that take a value in the next word
const DOCKER_VALUE_FLAGS = new Set(['--context', '-c', '-H', '--host', '--config', '-l', '--log-level'])
const COMPOSE_VALUE_FLAGS = new Set(['-p', '--project-name', '--env-file', '--profile', '--project-directory', '--ansi', '--parallel', '--progress'])
// after these subcommands `-f` is not a compose file: logs --follow, rm --force, and exec/run take a command
const NO_FILE_FLAG_AFTER = new Set(['logs', 'rm', 'exec', 'run'])

/**
 * The words after `compose` of every `docker compose` / `docker-compose` command in `command`.
 * Only a command whose program is docker counts (also behind env/sudo/..., or inside sh -c / eval):
 * other docker subcommands (`inspect -f`, `rm -f`, `logs -f`) have no compose file.
 */
function composeUses(command, depth = 0) {
  const uses = []
  for (const seg of parseShell(command)) {
    const w = seg.words
    let k = 0
    while (k < w.length && (ASSIGN.test(w[k]) || LEADERS.has(w[k]))) k++
    while (k < w.length && WRAPPERS.has(baseName(w[k]))) {
      k++
      while (k < w.length && (w[k].startsWith('-') || ASSIGN.test(w[k]) || /^\d+$/.test(w[k]))) k++
    }
    if (k >= w.length) continue
    const prog = baseName(w[k])
    if (prog === 'docker-compose') uses.push(w.slice(k + 1))
    else if (prog === 'docker') {
      let j = k + 1
      while (j < w.length && w[j].startsWith('-')) j += DOCKER_VALUE_FLAGS.has(w[j]) ? 2 : 1
      if (w[j] === 'compose') uses.push(w.slice(j + 1))
    } else if ((SHELLS.has(prog) || WRAPPERS.has(prog)) && depth < 4) {
      const args = w.slice(k + 1)
      for (const x of args) uses.push(...composeUses(x, depth + 1))
      if (prog === 'eval') uses.push(...composeUses(args.join(' '), depth + 1))
      for (const b of seg.heredocs) uses.push(...composeUses(b, depth + 1))
    }
  }
  return uses
}

/** -f / --file values among compose's words (see NO_FILE_FLAG_AFTER). */
function composeFiles(rest) {
  const files = []
  const fileFlag = (x, next) => {
    if (x === '-f' || x === '--file') { files.push(next ?? ''); return 2 }
    if (x.startsWith('--file=')) { files.push(x.slice(7)); return 1 }
    if (/^-f[^-=]/.test(x)) { files.push(x.slice(2)); return 1 }
    return 0
  }
  let i = 0
  while (i < rest.length && rest[i].startsWith('-')) { // options before the subcommand
    const used = fileFlag(rest[i], rest[i + 1])
    i += used || (COMPOSE_VALUE_FLAGS.has(rest[i]) ? 2 : 1)
  }
  if (i < rest.length && !NO_FILE_FLAG_AFTER.has(rest[i])) {
    for (let j = i + 1; j < rest.length;) j += fileFlag(rest[j], rest[j + 1]) || 1
  }
  return files
}

/** Returns the reason a command is refused, or null. */
export function refuse(command) {
  const cmd = String(command ?? '')
  for (const rest of composeUses(cmd)) {
    const isConfig = rest.includes('config')
    // `config` prints env_file values unless told not to resolve them
    if (isConfig && !rest.includes('--no-env-resolution')) {
      return 'docker compose config without --no-env-resolution expands env_file values (docker/.env). Add --no-env-resolution and --env-file docker/.env.example.'
    }
    // only the dev stack may run here; compose.yaml (production example) loads docker/.env
    const files = composeFiles(rest)
    if (!isConfig && (files.length === 0 || files.some((f) => !/compose\.dev\.yaml$/.test(f) && !/\.loctx\//.test(f)))) {
      return 'Local servers use docker/compose.dev.yaml only (docker/compose.yaml is the production example and loads docker/.env). Pass -f docker/compose.dev.yaml.'
    }
  }
  // reading or loading an env file through the shell
  const envRef = /(^|[\s'"=/])\.env(\.[\w-]+)?(?=$|[\s'";|&)])/g
  for (const m of cmd.matchAll(envRef)) {
    const name = m[0].trim().replace(/^['"=/]/, '')
    if (ALLOWED_ENV.test(name)) continue
    if (/\b(cat|less|more|head|tail|bat|grep|rg|awk|sed|source|xargs|env|export|dotenv|direnv)\b|(^|[;&|]\s*)\.\s/.test(cmd) || /--env-file[ =]\S*\.env\b/.test(cmd)) {
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
    ['docker compose -f docker/compose.dev.yaml logs -f api', false],
    ['docker compose -f docker/compose.dev.yaml rm -f db', false],
    ['docker compose -f docker/compose.dev.yaml exec api ls -f', false],
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
