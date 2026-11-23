// Review rc3-2 N-2 (spec 013 S-23): while a listed currency is refreshed by the server (auto on), a save that leaves its
// rate as this tab had it sends the rate the server holds now. A typed rate goes as typed; with auto off nothing is read.
// The API is faked; no browser, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveCurrency, store } from '../../src/lib/store'
import type { ForeignCurrency } from '../../src/data/types'

type Call = { method: string; path: string; body: unknown }
function fakeApi(serverRate: number): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init.method ?? 'GET', path, body })
    const json = init.method === 'GET' ? { currencies: [{ ...EUR, rate: serverRate }] } : { ...body, id: 'e1' }
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return calls
}
const EUR: ForeignCurrency = { id: 'e1', code: 'EUR', rate: 1500, buffer: 0, auto: true }

test('a buffer change with auto on keeps the refreshed rate', async () => {
  store.currencies = [{ ...EUR }]
  const calls = fakeApi(1512)
  await saveCurrency({ ...EUR, buffer: 2 }, 1500)
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /api/state', 'PUT /api/currencies/e1'])
  assert.equal((calls[1]!.body as ForeignCurrency).rate, 1512)
  assert.equal((calls[1]!.body as ForeignCurrency).buffer, 2)
})

test('turning auto off without touching the rate keeps the refreshed rate (review rc3-3 N-3)', async () => {
  store.currencies = [{ ...EUR }]
  const calls = fakeApi(1512)
  await saveCurrency({ ...EUR, auto: false }, 1500)
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /api/state', 'PUT /api/currencies/e1'])
  assert.equal((calls[1]!.body as ForeignCurrency).rate, 1512)
  assert.equal((calls[1]!.body as ForeignCurrency).auto, false)
})

test('a typed rate goes as typed; auto off and a new currency read nothing', async () => {
  store.currencies = [{ ...EUR }]
  let calls = fakeApi(1512)
  await saveCurrency({ ...EUR, rate: 1490 }, 1500)
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['PUT /api/currencies/e1'])
  assert.equal((calls[0]!.body as ForeignCurrency).rate, 1490)
  store.currencies = [{ ...EUR, auto: false }]
  calls = fakeApi(1512)
  await saveCurrency({ ...EUR, auto: false, buffer: 2 }, 1500)
  assert.deepEqual(calls.map((c) => c.method), ['PUT'], 'stored and saved auto off: nothing is read')
  calls = fakeApi(1512)
  await saveCurrency({ ...EUR, id: '', code: 'JPY', rate: 9.1 }, null)
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['POST /api/currencies'])
})
