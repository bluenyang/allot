import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error plain .mjs without types
import { refuse } from '../../scripts/guard-env.mjs'

const refused = (c: string) => refuse(c) !== null

test('docker subcommands other than compose: -f is not a compose file (false positives of 0.1.4)', () => {
  for (const c of [
    'docker inspect -f "{{.State.Status}}" allot-rc',
    "docker inspect -f '{{.State.Health.Status}}' allot-rc",
    'docker rm -f allot-rc',
    'docker logs -f allot-rc',
    'docker logs -f --tail 20 allot-rc',
    'docker ps -f name=allot',
    'docker compose -f docker/compose.dev.yaml ps && docker inspect -f x c && docker rm -f c',
    'docker rm -f a; docker rm -f b',
  ]) assert.equal(refused(c), false, c)
})

test('compose subcommands whose own -f is not a file', () => {
  for (const c of [
    'docker compose -f docker/compose.dev.yaml logs -f api',
    'docker compose -f docker/compose.dev.yaml logs --follow api',
    'docker compose -f docker/compose.dev.yaml rm -f db',
    'docker compose -f docker/compose.dev.yaml exec api ls -f',
    'docker compose -f docker/compose.dev.yaml run --rm api ls -f',
    'docker-compose -f docker/compose.dev.yaml logs -f api',
  ]) assert.equal(refused(c), false, c)
})

test('compose variants stay refused unless they use the dev file', () => {
  for (const c of [
    'docker compose up -d',
    'docker compose -f docker/compose.yaml up -d',
    'docker compose --file docker/compose.yaml up -d',
    'docker compose --file=docker/compose.yaml up -d',
    'docker compose -fdocker/compose.yaml up -d',
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
    'env A=1 docker compose up -d',
    'sh -c "docker compose up -d"',
    'bash -c \'cd x && docker compose -f docker/compose.yaml up\'',
    'eval docker compose up -d',
    'echo ok\ndocker compose up -d',
    '(docker compose up -d)',
    'echo "$(docker compose up -d)"',
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
  for (const c of ['cat docker/.env', 'grep SECRET docker/.env', 'set -a; . docker/.env; set +a', 'source .env', 'docker compose --env-file docker/.env -f docker/compose.dev.yaml up'])
    assert.equal(refused(c), true, c)
  for (const c of ['set -a; . docker/.env.dev; set +a', 'cat docker/.env.example', 'git status', 'pnpm typecheck'])
    assert.equal(refused(c), false, c)
})
