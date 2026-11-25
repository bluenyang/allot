// Idempotent FAKE data for the test account on a throwaway server (:15174, or the disposable API of disposable.sh on :15184; lib.mjs refuses any other), so the E2E
// find what they assume: settings and living costs, one target of each kind, a subscription with a
// plan change, a phase covering the current month with an amount for the fixed target, a check item.
// Every row is made up and named "Seed ..."; a row is created only if it is missing, so a second
// run changes nothing. It never changes or removes a row it did not create (settings and living
// costs are written only while they are still zero).
//   BASE=http://127.0.0.1:15174 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/test-server/seed.mjs
import { connect, rowName } from './lib.mjs'

const { api, state } = await connect()
const st = await state()
let bad = 0
let made = 0
const report = (what, r, want) => {
  const ok = want.includes(r.status)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} -> ${r.status}${ok ? '' : ` ${JSON.stringify(r.json)}`}`)
  if (!ok) bad++
  return r
}
const create = async (what, path, body) => { made++; return report(`create ${what}`, await api('POST', path, body), [201]) }
const has = (list, name) => (list ?? []).some((x) => rowName(x) === name)

const now = new Date()
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const next = new Date(now.getFullYear(), now.getMonth() + 1, 5)
const nextDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-05`

// settings and living costs: only while the account has none
if (!st.settings || st.settings.netPay === 0) {
  made++
  report('set settings', await api('PUT', '/api/settings', { netPay: 3_000_000, fxRate: 1400, fxBuffer: 3, payDay: 25, transferDay: 25, billingDay: 10, subRound: 1000 }), [200])
}
if (!st.living || (st.living.food === 0 && st.living.transit === 0 && st.living.allowance === 0)) {
  made++
  report('set living costs', await api('PUT', '/api/living', { food: 300_000, transit: 60_000, allowance: 200_000 }), [200])
}

// targets: one of each kind (the remainder is unique), the fixed one by name
const targets = [...(st.targets ?? [])]
for (const [kind, name] of [['living', 'Seed Living'], ['subscriptions', 'Seed Subscriptions'], ['remainder', 'Seed Remainder'], ['fixed', 'Seed Fixed']]) {
  const exists = kind === 'fixed' ? has(targets, name) : targets.some((t) => t.kind === kind)
  if (exists) continue
  const r = await create(`target ${name}`, '/api/targets', { name, kind })
  if (r.json?.id) targets.push({ ...r.json, kind, name })
}

// a subscription and a plan change for it
let sub = (st.subscriptions ?? []).find((x) => rowName(x) === 'Seed Service')
if (!sub) {
  const r = await create('subscription Seed Service', '/api/subscriptions', {
    name: 'Seed Service', category: 'tool', plan: 'Seed plan', amount: 10_000, currency: 'KRW', vat: 0,
    cycle: 'monthly', status: 'active', nextDate, path: 'direct', verified: false,
  })
  sub = r.json
}
if (sub?.id && !has(st.planChanges, 'Seed plan change')) {
  await create('plan change Seed plan change', '/api/plan-changes', { subId: sub.id, effective: nextDate, to: { amount: 12_000 }, note: 'Seed plan change' })
}

// a phase covering the current month (open-ended), with an amount for the fixed target
const covers = (p) => p.from <= ym && (p.to === null || p.to >= ym)
if (!(st.phases ?? []).some(covers)) {
  const fixed = targets.find((t) => t.name === 'Seed Fixed' && t.kind === 'fixed')
  await create('phase Seed phase', '/api/phases', { label: 'Seed', name: 'Seed phase', from: '2000-01', to: null, amounts: fixed?.id ? { [fixed.id]: 100_000 } : {} })
}

// a check item
if (!has(st.checks, 'Seed check item')) await create('check Seed check item', '/api/checks', { text: 'Seed check item', done: false })

console.log(`${made} row(s) written`)
process.exit(bad ? 1 : 0)
