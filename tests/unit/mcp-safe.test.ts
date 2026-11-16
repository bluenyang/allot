// spec 008 S-8 (review finding 1): a tool's failure is a generic answer, and `before` is a real time.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INTERNAL_ERROR, guarded, isTimestamp } from '../../server/mcp/safe'

test('a tool that throws answers with the generic error, not the exception text', async (t) => {
  t.mock.method(console, 'warn', () => undefined)
  const run = guarded('x', async () => { throw new Error('select "id" from "subscription" where user_id = $1 -- params: u-1234') })
  const r = await run({})
  assert.equal(r.isError, true)
  assert.deepEqual(r.content, [{ type: 'text', text: INTERNAL_ERROR }])
  assert.ok(!JSON.stringify(r).includes('select'))
})

test('a tool that does not throw is passed through', async () => {
  const ok = { content: [{ type: 'text' as const, text: '{}' }] }
  assert.equal(await guarded('x', async () => ok)({}), ok)
})

test('the log of a failure carries no message text', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined)
  await guarded('x', async () => { throw Object.assign(new Error('secret sql $1'), { code: '22008' }) })({})
  const line = String(warn.mock.calls[0]?.arguments[0])
  assert.ok(line.includes('22008') && !line.includes('secret'))
})

test('isTimestamp: real times are accepted, impossible ones refused', () => {
  for (const ok of ['2026-11-16 09:30:00.123456+00', '2026-11-16T09:30:00Z', '2024-02-29 00:00:00+09:00', '2026-12-31 23:59:59-0500'])
    assert.equal(isTimestamp(ok), true, ok)
  for (const bad of ['2026-99-99 00:00:00Z', '2026-02-30 00:00:00Z', '2025-02-29 00:00:00Z', '2026-13-01 00:00:00Z', '2026-11-16 24:00:00Z', '2026-11-16 09:60:00Z', '2026-11-16 09:30:61Z', '2026-11-16 09:30:00+99', '2026-11-16', 'now'])
    assert.equal(isTimestamp(bad), false, bad)
})
