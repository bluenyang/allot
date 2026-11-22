// spec 012 S-6, W-5: the production server serves the app for every address that is not the API
// (history addresses such as /settings/ai), and the API and /healthz answer as before.
//   pnpm test:unit
// No database is reached: the values below are fake and only the paths that need none are called.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const dir = mkdtempSync(join(tmpdir(), 'allot-spa-'))
mkdirSync(join(dir, 'assets'))
writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="app"></div>')
writeFileSync(join(dir, 'assets', 'x.js'), 'export {}')
process.env.STATIC_DIR = dir
process.env.DATABASE_URL ??= 'postgres://nobody@127.0.0.1:1/none'
process.env.BETTER_AUTH_SECRET ??= 'x'.repeat(40)
const { root } = await import('../../server/app')
after(() => rmSync(dir, { recursive: true, force: true }))

for (const path of ['/', '/settings/ai', '/spend/subs?add', '/pay', '/no/such/page']) {
  test(`GET ${path} is the app`, async () => {
    const res = await root.request(path)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
    assert.match(await res.text(), /<div id="app">/)
  })
}

test('a built file is served as itself', async () => {
  const res = await root.request('/assets/x.js')
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'export {}')
})

// Every /api path goes through the API's own middleware first (here it fails for want of a database,
// which this test does not have); what matters is that it is never answered with the app.
for (const path of ['/api/no-such-thing', '/api/auth/get-session', '/api/mcp']) {
  test(`${path} is the API's answer, not the app`, async () => {
    const res = await root.request(path)
    assert.notEqual(res.status, 200)
    assert.doesNotMatch(await res.text(), /<div id="app">/)
  })
}

test('/healthz answers JSON', async () => {
  const res = await root.request('/healthz')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})
