// scripts/check-migrations.sh in a throwaway clone: drift exits 1 and leaves drizzle/ clean; a dirty drizzle/ exits 2 and survives.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' })

function clone() {
  const dir = mkdtempSync(join(tmpdir(), 'check-mig-'))
  git(root, 'clone', '-q', '--no-hardlinks', root, dir)
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'))
  copyFileSync(join(root, 'scripts/check-migrations.sh'), join(dir, 'scripts/check-migrations.sh'))
  return dir
}
const run = (dir: string) => spawnSync('sh', ['scripts/check-migrations.sh'], { cwd: dir, encoding: 'utf8' })

test('no drift passes', () => {
  const dir = clone()
  try { assert.equal(run(dir).status, 0) } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('drift exits 1 and leaves drizzle/ clean', () => {
  const dir = clone()
  try {
    const f = join(dir, 'server/db/schema.ts')
    writeFileSync(f, readFileSync(f, 'utf8').replace("updatedBy: text('updated_by'),\n}, (t) => [check('app_setting_id'", "updatedBy: text('updated_by'),\n  drift: text('drift'),\n}, (t) => [check('app_setting_id'"))
    assert.match(git(dir, 'diff', '--stat'), /schema\.ts/)
    const r = run(dir)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stdout, /\?\? drizzle\/.*\.sql/)
    assert.equal(git(dir, 'status', '--porcelain', '--', 'drizzle'), '')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a dirty drizzle/ exits 2 and the edit survives', () => {
  const dir = clone()
  try {
    const f = join(dir, 'drizzle/meta/_journal.json')
    writeFileSync(f, readFileSync(f, 'utf8') + '\n')
    const r = run(dir)
    assert.equal(r.status, 2)
    assert.match(git(dir, 'status', '--porcelain', '--', 'drizzle'), /_journal\.json/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
