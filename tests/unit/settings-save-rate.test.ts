// review rc3-1 F-7 (spec 013 S-23): while the USD rate is refreshed by the server (fxAuto on), a settings save that
// does not change the rate sends the rate the server holds now, not the one this tab loaded. A rate the user typed
// goes as typed, and with fxAuto off nothing changes. The API is faked; no browser, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsServerRate, saveSettings, store } from '../../src/lib/store'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Settings } from '../../src/data/types'

type Call = { method: string; path: string; body: unknown }
function fakeApi(serverRate: number): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init.method ?? 'GET', path, body })
    const json = init.method === 'GET' ? { settings: { ...store.settings, fxRate: serverRate } } : body
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return calls
}
const local = (over: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, fxRate: 1380, ...over })

test('needsServerRate', () => {
  assert.equal(needsServerRate(local({ fxAuto: true }), { payDay: 24 }), true)
  assert.equal(needsServerRate(local({ fxAuto: true }), { fxRate: 1380 }), true) // the whole copy, rate untouched
  assert.equal(needsServerRate(local({ fxAuto: true }), { fxRate: 1400 }), false) // the user typed a rate
  assert.equal(needsServerRate(local({ fxAuto: false }), { payDay: 24 }), false)
  assert.equal(needsServerRate(local({ fxAuto: false }), { fxAuto: true }), true) // turning it on keeps the server's rate
  assert.equal(needsServerRate(local({ fxAuto: true }), { fxAuto: false }), true) // so does turning it off
})

test('an unrelated save with fxAuto on sends the server\'s rate', async () => {
  store.settings = local({ fxAuto: true })
  const calls = fakeApi(1402)
  await saveSettings({ payDay: 24 })
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /api/state', 'PUT /api/settings'])
  assert.equal((calls[1]!.body as Settings).fxRate, 1402)
  assert.equal((calls[1]!.body as Settings).payDay, 24)
  assert.equal(store.settings.fxRate, 1402)
})

test('a typed rate, and a save with fxAuto off, go as before', async () => {
  store.settings = local({ fxAuto: true })
  let calls = fakeApi(1402)
  await saveSettings({ fxRate: 1390 })
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['PUT /api/settings'])
  assert.equal((calls[0]!.body as Settings).fxRate, 1390)
  store.settings = local({ fxAuto: false })
  calls = fakeApi(1402)
  await saveSettings({ payDay: 24 })
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['PUT /api/settings'])
  assert.equal((calls[0]!.body as Settings).fxRate, 1380)
})
