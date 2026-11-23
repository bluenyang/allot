import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
// @ts-expect-error plain .mjs without types
import { refuse } from '../../scripts/guard-env.mjs'

const refused = (c: string) => refuse(c) !== null

test('plain docker subcommands: -f is not a compose file (false positives of 0.1.4)', () => {
  for (const c of [
    'docker inspect -f "{{.State.Status}}" allot-rc',
    "docker inspect -f '{{.State.Health.Status}}' allot-rc",
    'docker rm -f allot-rc',
    'docker logs -f allot-rc',
    'docker logs -f --tail 20 allot-rc',
    'docker ps -f name=allot',
    'docker compose -f docker/compose.dev.yaml ps && docker inspect -f x c && docker rm -f c',
    'docker rm -f a; docker rm -f b; docker compose -f docker/compose.dev.yaml up -d',
    'docker --context x rm -f c',
  ]) assert.equal(refused(c), false, c)
})

test('every compose variant keeps its old refusal, wherever it is written', () => {
  for (const c of [
    'docker compose up -d',
    'docker compose -f docker/compose.yaml up -d',
    'docker compose --file docker/compose.yaml up -d',
    'docker compose --file=docker/compose.yaml up -d',
    'docker compose -f docker/compose.dev.yaml -f docker/compose.yaml up -d',
    'docker compose -f docker/compose.dev.yaml up -f docker/compose.yaml',
    'docker compose logs -f api',
    'docker-compose up -d',
    'docker-compose -f docker/compose.yaml config',
    'docker compose -f docker/compose.yaml --env-file docker/.env.example config > out.log',
    'docker compose -f docker/compose.dev.yaml config',
    'docker rm -f c && docker compose -f docker/compose.yaml up -d',
    'docker compose -f docker/compose.dev.yaml ps; docker compose up -d',
    'docker --context x compose up -d',
    'sudo docker compose up -d',
    'sudo -u root docker compose up -d',
    'env -u X docker compose up -d',
    'env A=1 docker compose up -d',
    '2>/dev/null docker compose up -d',
    '>/dev/null 2>&1 docker compose up -d',
    'find . -exec docker compose up -d \\;',
    'pnpm exec docker compose up -d',
    'xargs -I X docker compose up -d',
    'timeout 5 docker compose up -d',
    "script -qc 'docker compose up -d' /dev/null",
    "python3 -c 'import os; os.system(\"docker compose up -d\")'",
    "node -e 'require(\"child_process\").execSync(\"docker compose up -d\")'",
    'sh -c "docker compose up -d"',
    "bash -c 'cd x && docker compose -f docker/compose.yaml up'",
    'eval docker compose up -d',
    'docker exec c docker compose up -d',
    'echo ok\ndocker compose up -d',
    "bash <<'EOF'\ndocker compose up -d\nEOF",
    '(docker compose up -d)',
    'echo "$(docker compose up -d)"',
    'docker rm -f c docker compose -f docker/compose.yaml up -d',
    // a line with any execution context besides plain docker commands is read as a whole, as before
    'docker inspect -f x c && sudo docker compose -f docker/compose.dev.yaml up -d',
    'docker rm -f c; sh -c "docker compose -f docker/compose.yaml up"',
    'GIT=1 docker rm -f c; docker compose up -d',
    'docker rm -f c &\ndocker compose up -d',
    'docker rm -f c | xargs docker compose up -d',
  ]) assert.equal(refused(c), true, c)
})

test('compose with the dev file or the example env stays allowed', () => {
  for (const c of [
    'docker compose -f docker/compose.dev.yaml up -d --build -V --wait',
    'docker compose -f docker/compose.dev.yaml -f .loctx/reports/0.1.1/test/compose.rls.yaml up -d api',
    'docker compose -f docker/compose.dev.yaml exec -T api pnpm db:seed',
    'docker compose -f docker/compose.yaml --env-file docker/.env.example config --no-env-resolution',
    'docker compose -p x -f docker/compose.dev.yaml ps',
    'docker compose --file docker/compose.dev.yaml ps',
  ]) assert.equal(refused(c), false, c)
})

test('env files are still never read', () => {
  for (const c of ['cat docker/.env', 'grep SECRET docker/.env', 'set -a; . docker/.env; set +a', 'source .env', 'docker compose --env-file docker/.env -f docker/compose.dev.yaml up', 'docker rm -f c; cat docker/.env'])
    assert.equal(refused(c), true, c)
  for (const c of ['set -a; . docker/.env.dev; set +a', 'cat docker/.env.example', 'git status', 'pnpm typecheck'])
    assert.equal(refused(c), false, c)
})

test('malformed input is refused', () => {
  for (const c of ['echo "unterminated', "echo 'unterminated", 'docker rm -f c "x', 'echo $(x', 'echo `x', 'echo ${x', "echo $'x"])
    assert.equal(refused(c), true, c)
  assert.equal(refused('echo "closed" $(echo ok)'), false)
})

test('deep or oversized input falls back to the raw text rules (never throws)', () => {
  const deep = '$('.repeat(20000) + 'docker compose up -d' + ')'.repeat(20000)
  assert.equal(refused(deep), true)
  assert.equal(refused('echo ' + 'x '.repeat(80000) + '; docker compose up -d'), true)
})

test('a recursive grep or rg over a folder holding env files is refused unless they are excluded (retro 0.1.7)', () => {
  const base = join(resolve('.'), '.loctx', 'scratch')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'guard-env-'))
  try {
    mkdirSync(join(root, 'conf', 'deep'), { recursive: true })
    mkdirSync(join(root, 'code'))
    writeFileSync(join(root, 'conf', 'deep', '.env.local'), 'X=1\n') // a test file, never a real env file
    writeFileSync(join(root, 'conf', 'a.yaml'), 'a: 1\n')
    writeFileSync(join(root, 'code', 'a.ts'), 'x\n')
    const r = (c: string) => refuse(c, { cwd: root }) !== null
    // rg skips dotfiles unless told to read hidden ones (retro review T-4)
    for (const c of ['grep -rn X conf', 'grep -Rl X conf/', 'grep -r X', 'grep -r X .', 'rg --hidden X conf', 'rg -uu X', 'grep -d recurse X conf',
      'grep -rn --exclude=*.yaml X conf', "rg --hidden -g '*.local' X conf", 'grep -rn X code conf', 'echo $(grep -r X conf)'])
      assert.equal(r(c), true, c)
    for (const c of ["grep -rn --exclude='.env*' X conf", "grep -rn --include='*.yaml' X conf", "rg -g '!.env*' X conf", 'rg --glob=!.env* X conf',
      'grep -rn X code', 'rg X code', 'rg X conf', 'rg X', 'grep -n X conf/a.yaml', 'grep X conf', 'grep -r X missing-folder', 'grep -r -e conf code'])
      assert.equal(r(c), false, c)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
