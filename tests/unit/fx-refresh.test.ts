// spec 013 S-23, A-38: the daily rate refresh with a fake fetch (no network, no database).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { autoCodes, fetchRate, fxBase, fxEnabled, planWrites, refreshAll, type FetchFn, type FxResult, type FxState, type FxStore } from '../../server/fx-rates'

const BASE = 'https://rates.test'
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

/** A fake rate service: KRW per unit for the codes it has, 404 for the rest; it records every URL asked. */
function fakeService(rates: Record<string, number>) {
  const calls: string[] = []
  const fetchFn: FetchFn = async (url) => {
    calls.push(url)
    const from = new URL(url).searchParams.get('from')!
    return from in rates ? answer(200, { amount: 1, base: from, date: '2026-11-23', rates: { KRW: rates[from] } }) : answer(404, { message: 'not found' })
  }
  return { fetchFn, calls }
}

/** An in-memory store of users' rates, as the database side would hold them. */
function memoryStore(users: Record<string, FxState>) {
  const written: Record<string, ReturnType<typeof planWrites>> = {}
  const store: FxStore = {
    users: async () => Object.keys(users),
    read: async (uid) => users[uid]!,
    write: async (uid, results) => { written[uid] = planWrites(users[uid]!, results, 'NOW') },
  }
  return { store, written }
}

test('fetchRate: asks from=<code>&to=KRW and rounds to 2 decimals', async () => {
  const svc = fakeService({ EUR: 1534.567 })
  assert.deepEqual(await fetchRate('EUR', svc.fetchFn, BASE), { rate: 1534.57 })
  assert.deepEqual(svc.calls, [`${BASE}/latest?from=EUR&to=KRW`])
})

test('fetchRate: a code the service does not have, a network failure, a timeout, a bad answer', async () => {
  assert.deepEqual(await fetchRate('XYZ', fakeService({}).fetchFn, BASE), { error: 'unknown_code' })
  assert.deepEqual(await fetchRate('EUR', async () => { throw new TypeError('fetch failed') }, BASE), { error: 'network' })
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  assert.deepEqual(await fetchRate('EUR', async () => { throw timeout }, BASE), { error: 'timeout' })
  assert.deepEqual(await fetchRate('EUR', async () => answer(500, {}), BASE), { error: 'http_500' })
  assert.deepEqual(await fetchRate('EUR', async () => answer(200, { rates: { USD: 1 } }), BASE), { error: 'bad_answer' })
  assert.deepEqual(await fetchRate('EUR', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x') } }), BASE), { error: 'bad_answer' })
  // the column holds above 0 and up to 999,999.99
  assert.deepEqual(await fetchRate('EUR', fakeService({ EUR: 0.001 }).fetchFn, BASE), { error: 'out_of_range' })
  assert.deepEqual(await fetchRate('EUR', fakeService({ EUR: 1_000_000 }).fetchFn, BASE), { error: 'out_of_range' })
})

test('the two server variables', () => {
  assert.equal(fxBase({}), 'https://api.frankfurter.app')
  assert.equal(fxBase({ ALLOT_FX_URL: 'http://fx.local:8080/' }), 'http://fx.local:8080')
  assert.equal(fxEnabled({}), true)
  assert.equal(fxEnabled({ ALLOT_FX_REFRESH: 'off' }), false)
  assert.equal(fxEnabled({ ALLOT_FX_REFRESH: 'OFF' }), false)
  assert.equal(fxEnabled({ ALLOT_FX_REFRESH: 'on' }), true)
})

const settingsOf = (fxAuto: boolean) => ({ fxRate: 1400, fxAuto })

test('no auto switch on anywhere: no request at all', async () => {
  const svc = fakeService({ USD: 1450, EUR: 1500 })
  const { store, written } = memoryStore({
    a: { settings: settingsOf(false), currencies: [{ id: 'c1', code: 'EUR', rate: 1500, auto: false }] },
    b: { settings: null, currencies: [] },
  })
  assert.equal(await refreshAll(store, svc.fetchFn, BASE), 0)
  assert.deepEqual(svc.calls, [])
  assert.deepEqual(written, {})
})

test('a success writes the new rate, the time and clears the error; one request per code for all users', async () => {
  const svc = fakeService({ USD: 1450.126, EUR: 1500 })
  const { store, written } = memoryStore({
    a: { settings: settingsOf(true), currencies: [{ id: 'c1', code: 'EUR', rate: 1490, auto: true }, { id: 'c2', code: 'JPY', rate: 9.1, auto: false }] },
    b: { settings: settingsOf(true), currencies: [] },
  })
  assert.equal(await refreshAll(store, svc.fetchFn, BASE), 2)
  assert.deepEqual(svc.calls.sort(), [`${BASE}/latest?from=EUR&to=KRW`, `${BASE}/latest?from=USD&to=KRW`])
  assert.deepEqual(written.a, {
    settings: { fxRate: 1450.13, fxAutoAt: 'NOW', fxAutoError: null },
    currencies: [{ id: 'c1', rate: 1500, autoAt: 'NOW', autoError: null }],
  })
  assert.deepEqual(written.b, { settings: { fxRate: 1450.13, fxAutoAt: 'NOW', fxAutoError: null }, currencies: [] })
})

test('the same rate again: only the time (no rate write, so no change set)', () => {
  const s: FxState = { settings: settingsOf(true), currencies: [{ id: 'c1', code: 'EUR', rate: 1500, auto: true }] }
  const r = new Map<string, FxResult>([['USD', { rate: 1400 }], ['EUR', { rate: 1500 }]])
  assert.deepEqual(planWrites(s, r, 'NOW'), {
    settings: { fxAutoAt: 'NOW', fxAutoError: null },
    currencies: [{ id: 'c1', autoAt: 'NOW', autoError: null }],
  })
})

test('a code the service does not have, or a failed request: the rate stays, the reason is written (A-38)', async () => {
  const { store, written } = memoryStore({
    a: { settings: settingsOf(true), currencies: [{ id: 'c1', code: 'XYZ', rate: 12.5, auto: true }] },
  })
  await refreshAll(store, fakeService({ USD: 1450 }).fetchFn, BASE)
  assert.deepEqual(written.a!.currencies, [{ id: 'c1', autoError: 'unknown_code' }])
  assert.equal(written.a!.settings!.fxRate, 1450)

  const down = memoryStore({ a: { settings: settingsOf(true), currencies: [{ id: 'c1', code: 'EUR', rate: 1500, auto: true }] } })
  await refreshAll(down.store, async () => { throw new TypeError('fetch failed') }, BASE)
  assert.deepEqual(down.written.a, { settings: { fxAutoError: 'network' }, currencies: [{ id: 'c1', autoError: 'network' }] })
})

test('one user failing does not stop the others', async () => {
  const svc = fakeService({ USD: 1450 })
  const done: string[] = []
  const store: FxStore = {
    users: async () => ['bad', 'good'],
    read: async (uid) => { if (uid === 'bad') throw new Error('db'); return { settings: settingsOf(true), currencies: [] } },
    write: async (uid) => { done.push(uid) },
  }
  const logged: string[] = []
  assert.equal(await refreshAll(store, svc.fetchFn, BASE, (m) => logged.push(m)), 1)
  assert.deepEqual(done, ['good'])
  assert.equal(logged.length, 1)
})

test('autoCodes: USD from the settings switch, the listed codes with auto', () => {
  assert.deepEqual(autoCodes({ settings: settingsOf(true), currencies: [{ id: '1', code: 'EUR', rate: 1, auto: true }, { id: '2', code: 'GBP', rate: 1, auto: false }] }), ['USD', 'EUR'])
  assert.deepEqual(autoCodes({ settings: null, currencies: [] }), [])
})
