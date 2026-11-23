// tests/api/lib/check.mjs (retro 0.1.7): the stop-at-first-failure helper of the API checks. Each case runs in its own
// node process, as an API check does (the helper's state is its module's).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const lib = pathToFileURL(resolve('tests/api/lib/check.mjs')).href
const run = (body: string) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { arm, cleanupStep, disarm, failures, ok, settle, threw, Stop } from '${lib}'\n${body}`], { encoding: 'utf8' })
  return { out: r.stdout, err: r.stderr, status: r.status }
}

test('before arm() a failure only counts; after it the first one throws Stop, later ones only report', () => {
  const r = run(`
    ok(false, 'early')
    console.log('n=' + failures())
    arm()
    try { ok(true, 'fine'); ok(false, 'first'); console.log('not reached') } catch (e) { console.log('stop=' + (e instanceof Stop) + ' ' + e.message) }
    ok(false, 'second')
    console.log('n=' + failures())`)
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /FAIL early\nn=1\nPASS fine\nFAIL first\nstop=true first\nFAIL second\nn=3\n/)
})

test('threw(e) counts and prints anything but Stop', () => {
  const r = run(`
    threw(new Stop('x'))
    console.log('n=' + failures())
    threw(new Error('boom'))
    console.log('n=' + failures())`)
  assert.match(r.out, /^n=0\nFAIL threw: Error: boom[\s\S]*\nn=1\n$/)
})

test('cleanupStep never throws: every step runs, a throw counts, a returned value is logged', async () => {
  const r = run(`
    arm()
    disarm()
    await cleanupStep('one', async () => { throw new Error('net down') })
    await cleanupStep('two', async () => 204)
    await cleanupStep('three', async () => { ok(false, 'a check in a step') })
    console.log('n=' + failures())`)
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /FAIL cleanup: one threw: net down\ncleanup: two → 204\nFAIL a check in a step\nn=2\n/)
})

test('inside the armed run a failed cleanup step stops the run only at settle(), after every step ran', () => {
  const r = run(`
    arm()
    try {
      await cleanupStep('a', async () => { ok(false, 'delete a') })
      await cleanupStep('b', async () => { console.log('b ran') })
      console.log('before settle')
      settle()
      console.log('not reached')
    } catch (e) { console.log('stop=' + (e instanceof Stop) + ' ' + e.message) }
    settle()
    console.log('n=' + failures())`)
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /FAIL delete a\nb ran\nbefore settle\nstop=true cleanup failed: delete a\nn=1\n/)
})

test('settle() is a no-op without a failed step, and once the run is stopped', () => {
  const r = run(`
    arm()
    settle()
    try { ok(false, 'x') } catch {}
    await cleanupStep('c', async () => { throw new Error('late') })
    settle()
    console.log('n=' + failures())`)
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /n=2\n$/)
})
