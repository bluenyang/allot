// review rc3-1 F-8 (spec 013 S-23): the rate service's answers are kept a short time and reused by "지금 갱신" and the
// daily job; nothing is refused. A failure is kept shorter than a success. Fake fetch and clock; no network.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cachedFetch, FX_CACHE_FAIL_MS, FX_CACHE_OK_MS } from '../../server/fx-cache'
import { fetchRate, type FetchFn } from '../../server/fx-rates'

const BASE = 'https://rates.test'
const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function service(rates: Record<string, number>) {
  const calls: string[] = []
  let down = false
  const fetchFn: FetchFn = async (url) => {
    calls.push(url)
    if (down) throw new TypeError('fetch failed')
    const from = new URL(url).searchParams.get('from')!
    return from in rates ? answer(200, { rates: { KRW: rates[from] } }) : answer(404, { message: 'not found' })
  }
  return { fetchFn, calls, rates, setDown: (v: boolean) => { down = v } }
}

test('a success is reused for 10 minutes, then asked again', async () => {
  let clock = 0
  const svc = service({ EUR: 1500 })
  const f = cachedFetch(svc.fetchFn, { now: () => clock })
  assert.deepEqual(await fetchRate('EUR', f, BASE), { rate: 1500 })
  svc.rates.EUR = 1510
  clock += FX_CACHE_OK_MS - 1
  assert.deepEqual(await fetchRate('EUR', f, BASE), { rate: 1500 }) // from memory
  assert.equal(svc.calls.length, 1)
  clock += 1
  assert.deepEqual(await fetchRate('EUR', f, BASE), { rate: 1510 }) // asked again
  assert.equal(svc.calls.length, 2)
  // another code is its own answer
  svc.rates.JPY = 9.5
  assert.deepEqual(await fetchRate('JPY', f, BASE), { rate: 9.5 })
  assert.equal(svc.calls.length, 3)
})

test('a failure is kept shorter than a success, and every call still gets an answer', async () => {
  let clock = 0
  const svc = service({ EUR: 1500 })
  const f = cachedFetch(svc.fetchFn, { now: () => clock })
  svc.setDown(true)
  assert.deepEqual(await fetchRate('EUR', f, BASE), { error: 'network' })
  assert.deepEqual(await fetchRate('EUR', f, BASE), { error: 'network' }) // the same answer, not a refusal
  assert.equal(svc.calls.length, 1)
  svc.setDown(false)
  clock += FX_CACHE_FAIL_MS
  assert.deepEqual(await fetchRate('EUR', f, BASE), { rate: 1500 })
  assert.equal(svc.calls.length, 2)
  // an unknown code and an answer without a KRW rate are failures too
  assert.deepEqual(await fetchRate('XYZ', f, BASE), { error: 'unknown_code' })
  clock += FX_CACHE_FAIL_MS
  assert.deepEqual(await fetchRate('XYZ', f, BASE), { error: 'unknown_code' })
  assert.equal(svc.calls.length, 4)
  assert.ok(FX_CACHE_FAIL_MS <= FX_CACHE_OK_MS)
  // failMs is never longer than okMs
  let c2 = 0
  const svc2 = service({})
  const g = cachedFetch(svc2.fetchFn, { okMs: 10, failMs: 1000, now: () => c2 })
  await fetchRate('XYZ', g, BASE)
  c2 = 10
  assert.deepEqual(await fetchRate('XYZ', g, BASE), { error: 'unknown_code' })
  assert.equal(svc2.calls.length, 2)
})

test('calls while a request is in flight share it', async () => {
  let release!: () => void
  const calls: string[] = []
  const slow: FetchFn = async (url) => { calls.push(url); await new Promise<void>((r) => { release = r }); return answer(200, { rates: { KRW: 1400 } }) }
  const f = cachedFetch(slow)
  const a = fetchRate('USD', f, BASE)
  const b = fetchRate('USD', f, BASE)
  await new Promise((r) => setImmediate(r))
  release()
  assert.deepEqual(await Promise.all([a, b]), [{ rate: 1400 }, { rate: 1400 }])
  assert.equal(calls.length, 1)
})

test('a timeout and a bad body replay as they came', async () => {
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  const f = cachedFetch(async () => { throw timeout })
  assert.deepEqual(await fetchRate('EUR', f, BASE), { error: 'timeout' })
  assert.deepEqual(await fetchRate('EUR', f, BASE), { error: 'timeout' })
  const g = cachedFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad') } }))
  assert.deepEqual(await fetchRate('EUR', g, BASE), { error: 'bad_answer' })
  assert.deepEqual(await fetchRate('EUR', g, BASE), { error: 'bad_answer' })
})
