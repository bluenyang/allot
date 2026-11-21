// spec 011 V-2 (rounds) and V-3 (month sums feed the transfer and the distribution), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  distributionAt, leftoverAfterTransfer, monthMoney, monthlyKrw, num, payOffEarly, planAt, planRounds, replan, spendState, upcomingSpendRounds, spendingIn, spendingKrw, transferAt,
} from '../../src/lib/calc'
import type { Distribution, TransferCalc } from '../../src/lib/calc'
import type { AllocationTarget, Living, Phase, PlanChange, Settings, Spending, SpendingRound, Subscription } from '../../src/data/types'

const S: Settings = { netPay: 3_000_000, fxRate: 1380, fxBuffer: 3, payDay: 25, transferDay: 1, billingDay: 16, subRound: 10_000, dayShift: 'none' }
const none: ReadonlySet<string> = new Set()
const dates = (r: SpendingRound[]) => r.map((x) => x.date)
const amounts = (r: SpendingRound[]) => r.map((x) => x.amount)

// ---------- V-2 ----------
test('USD 49 at 1,380 with a 3% buffer = 69,649; KRW stays as is', () => {
  assert.equal(spendingKrw(49, 'USD', S), 69_649)
  assert.equal(spendingKrw(49, 'USD', { fxRate: 1380, fxBuffer: 0 }), 67_620)
  assert.equal(spendingKrw(123_456, 'KRW', S), 123_456)
})

test('1,290,000 + fee 35,000 over 6 on a card: 220,830 x5, last 220,850', () => {
  const r = planRounds({ bought: '2026-11-18', how: 'installment', payBy: 'card', count: 6, principal: 1_290_000, fee: 35_000 }, S, none)
  assert.deepEqual(amounts(r), [220_830, 220_830, 220_830, 220_830, 220_830, 220_850])
  assert.equal(r.reduce((a, x) => a + x.amount, 0), 1_325_000)
  assert.deepEqual(r.map((x) => x.no), [1, 2, 3, 4, 5, 6])
  assert.ok(r.every((x) => x.state === 'left' && x.edited === false))
  assert.deepEqual(dates(r), ['2026-12-16', '2027-01-16', '2027-02-16', '2027-03-16', '2027-04-16', '2027-05-16'])
})

test('1,899,000 over 12 interest free: 158,250 each', () => {
  const r = planRounds({ bought: '2026-11-18', how: 'installment', payBy: 'card', count: 12, principal: 1_899_000, fee: 0 }, S, none)
  assert.equal(r.length, 12)
  assert.deepEqual(amounts(r), Array(12).fill(158_250))
  assert.equal(r[11]!.date, '2027-11-16')
})

test('the fee applies only to a card installment', () => {
  const lump = planRounds({ bought: '2026-11-18', how: 'lump', payBy: 'card', count: 1, principal: 100_000, fee: 5_000 }, S, none)
  assert.deepEqual(amounts(lump), [100_000])
  const split = planRounds({ bought: '2026-11-18', how: 'split', payBy: 'salary', count: 2, principal: 100_000, fee: 5_000, interval: 'monthly' }, S, none)
  assert.deepEqual(amounts(split), [50_000, 50_000])
})

test('card: bought 2026-11-18 bills 2026-12-16; bought 2026-12-02 bills 2027-01-16', () => {
  const a = planRounds({ bought: '2026-11-18', how: 'lump', payBy: 'card', count: 1, principal: 50_000 }, S, none)
  assert.deepEqual(dates(a), ['2026-12-16'])
  assert.deepEqual(amounts(a), [50_000])
  const b = planRounds({ bought: '2026-12-02', how: 'lump', payBy: 'card', count: 1, principal: 50_000 }, S, none)
  assert.deepEqual(dates(b), ['2027-01-16'])
})

test('card: a billing day on Saturday moves to Friday with dayShift before', () => {
  assert.equal(new Date('2026-05-16T00:00:00').getDay(), 6)
  const r = planRounds({ bought: '2026-04-10', how: 'lump', payBy: 'card', count: 1, principal: 10_000 }, { ...S, dayShift: 'before' }, none)
  assert.deepEqual(dates(r), ['2026-05-15'])
  const plain = planRounds({ bought: '2026-04-10', how: 'lump', payBy: 'card', count: 1, principal: 10_000 }, S, none)
  assert.deepEqual(dates(plain), ['2026-05-16'])
  const holiday = planRounds({ bought: '2026-04-10', how: 'lump', payBy: 'card', count: 1, principal: 10_000 }, { ...S, dayShift: 'after' }, new Set(['2026-05-18']))
  assert.deepEqual(dates(holiday), ['2026-05-19'])
})

test('salary and subs lump are on the purchase day', () => {
  for (const payBy of ['salary', 'subs'] as const) {
    const r = planRounds({ bought: '2026-11-18', how: 'lump', payBy, count: 1, principal: 77_000 }, S, none)
    assert.deepEqual(dates(r), ['2026-11-18'])
    assert.deepEqual(amounts(r), [77_000])
  }
})

test('split monthly from the 31st: Feb end, then back to the 31st', () => {
  const r = planRounds({ bought: '2026-12-05', how: 'split', payBy: 'salary', count: 5, principal: 500_000, interval: 'monthly', first: '2026-12-31' }, S, none)
  assert.deepEqual(dates(r), ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
})

test('split defaults to the purchase day for the first date', () => {
  const r = planRounds({ bought: '2026-11-18', how: 'split', payBy: 'subs', count: 3, principal: 100_000, interval: 'monthly' }, S, none)
  assert.deepEqual(dates(r), ['2026-11-18', '2026-12-18', '2027-01-18'])
  assert.deepEqual(amounts(r), [33_330, 33_330, 33_340])
})

test('split biweekly: every 14 days', () => {
  const r = planRounds({ bought: '2026-12-20', how: 'split', payBy: 'salary', count: 4, principal: 400_000, interval: 'biweekly' }, S, none)
  assert.deepEqual(dates(r), ['2026-12-20', '2027-01-03', '2027-01-17', '2027-01-31'])
  assert.deepEqual(amounts(r), [100_000, 100_000, 100_000, 100_000])
})

test('split custom: the given dates, and a count mismatch is refused', () => {
  const given = ['2026-12-01', '2026-12-09', '2027-02-14']
  const r = planRounds({ bought: '2026-11-18', how: 'split', payBy: 'salary', count: 3, principal: 90_000, interval: 'custom', dates: given }, S, none)
  assert.deepEqual(dates(r), given)
  assert.throws(() => planRounds({ bought: '2026-11-18', how: 'split', payBy: 'salary', count: 3, principal: 90_000, interval: 'custom', dates: given.slice(0, 2) }, S, none), RangeError)
})

test('round count must be 1..60', () => {
  const base = { bought: '2026-11-18', how: 'installment', payBy: 'card', principal: 600_000 } as const
  assert.throws(() => planRounds({ ...base, count: 0 }, S, none), RangeError)
  assert.throws(() => planRounds({ ...base, count: 61 }, S, none), RangeError)
  assert.equal(planRounds({ ...base, count: 60 }, S, none).length, 60)
  assert.equal(planRounds({ ...base, count: 1 }, S, none).length, 1)
})

test('payOffEarly merges every left round into one sum; paid rounds stay', () => {
  const r = planRounds({ bought: '2026-11-18', how: 'installment', payBy: 'card', count: 6, principal: 1_290_000, fee: 35_000 }, S, none)
  r[0]!.state = 'paid'
  r[1]!.state = 'paid'
  const out = payOffEarly(r, '2027-03-01')
  assert.equal(out.length, 7)
  assert.deepEqual(out.map((x) => x.state), ['paid', 'paid', 'merged', 'merged', 'merged', 'merged', 'left'])
  const last = out[6]!
  assert.equal(last.no, 7)
  assert.equal(last.date, '2027-03-01')
  assert.equal(last.amount, 220_830 * 3 + 220_850)
  assert.equal(last.amount, r.filter((x) => x.state === 'left').reduce((a, x) => a + x.amount, 0))
  assert.equal(r[2]!.state, 'left') // the input is not changed
  assert.equal(payOffEarly(r, '2027-03-01', 600_000)[6]!.amount, 600_000)
})

function spending(over: Partial<Spending>): Spending {
  return { id: 'x', name: 'n', category: 'life', bought: '2026-11-18', amount: 0, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy: 'salary', count: 1, fee: 0, interval: null, cancelled: false, rounds: [], ...over }
}
const round = (no: number, date: string, amount: number, state: SpendingRound['state'] = 'left'): SpendingRound => ({ no, date, amount, state, edited: false })

test('spendingIn: calendar month, split by account and kind, merged and cancelled-left leave out', () => {
  const lump = spending({ id: 'a', how: 'lump', payBy: 'card', rounds: [round(1, '2026-12-16', 100_000)] })
  const inst = spending({ id: 'b', how: 'installment', payBy: 'card', count: 3, rounds: [round(1, '2026-12-16', 30_000), round(2, '2027-01-16', 30_000), round(3, '2027-02-16', 30_000)] })
  const sub = spending({ id: 'c', how: 'lump', payBy: 'subs', rounds: [round(1, '2026-12-31', 67_620)] })
  const sal = spending({ id: 'd', how: 'split', payBy: 'salary', count: 2, rounds: [round(1, '2026-12-01', 5_000), round(2, '2026-12-15', 7_000)] })
  const merged = spending({ id: 'e', how: 'installment', payBy: 'card', count: 2, rounds: [round(1, '2026-12-16', 999, 'merged'), round(2, '2026-12-16', 888)] })
  const dec = spendingIn([lump, inst, sub, sal, merged], '2026-12')
  assert.equal(dec.subs, 67_620)
  assert.equal(dec.general, 100_000)
  assert.equal(dec.installment, 30_000 + 5_000 + 7_000 + 888)
  assert.equal(dec.remainder, 100_000 + 30_000 + 12_000 + 888)
  assert.equal(dec.items.length, 6)
  assert.equal(spendingIn([lump, inst, sub, sal, merged], '2027-01').remainder, 30_000)
  assert.equal(spendingIn([lump, inst, sub, sal, merged], '2026-11').items.length, 0)
})

test('spendingIn: a cancelled spending keeps its paid rounds and drops its left ones', () => {
  const c = spending({ cancelled: true, how: 'installment', payBy: 'card', count: 3, rounds: [round(1, '2026-12-16', 40_000, 'paid'), round(2, '2027-01-16', 40_000), round(3, '2027-02-16', 40_000)] })
  assert.equal(spendingIn([c], '2026-12').remainder, 40_000)
  assert.equal(spendingIn([c], '2027-01').remainder, 0)
  assert.equal(spendingIn([c], '2027-02').items.length, 0)
  const subsC = spending({ cancelled: true, payBy: 'subs', rounds: [round(1, '2026-12-05', 9_000)] })
  assert.equal(spendingIn([subsC], '2026-12').subs, 0)
})

test('spendState: cancelled, paid, billing (card, bought..bill date), planned', () => {
  const card = spending({ payBy: 'card', rounds: [round(1, '2026-12-16', 100_000)] })
  assert.equal(spendState(card, '2026-11-17', S, none), 'planned') // before it was bought
  assert.equal(spendState(card, '2026-11-18', S, none), 'billing')
  assert.equal(spendState(card, '2026-12-15', S, none), 'billing')
  assert.equal(spendState(card, '2026-12-16', S, none), 'planned')
  assert.equal(spendState({ ...card, rounds: [round(1, '2026-12-16', 100_000, 'paid')] }, '2026-11-20', S, none), 'paid')
  assert.equal(spendState({ ...card, cancelled: true, rounds: [round(1, '2026-12-16', 100_000, 'paid')] }, '2026-11-20', S, none), 'cancelled')
  const sal = spending({ payBy: 'salary', rounds: [round(1, '2026-11-18', 50_000)] })
  assert.equal(spendState(sal, '2026-11-19', S, none), 'planned')
})

// ---------- V-3 ----------
// The functions as they were before spec 011, copied verbatim as the reference.
function transferBefore(subs: Subscription[], changes: PlanChange[], s: Settings, ym: string): TransferCalc {
  let monthlySum = 0
  let yearlyMonthly = 0
  let usdMonthly = 0
  const items: TransferCalc['items'] = []
  for (const base of subs) {
    const p = planAt(base, changes, ym)
    if (p.status !== 'active') continue
    const m = monthlyKrw(p, s)
    if (p.cycle === 'yearly') yearlyMonthly += m
    else monthlySum += m
    if (p.currency === 'USD') usdMonthly += m
    items.push({ sub: p, monthly: m })
  }
  items.sort((a, b) => b.monthly - a.monthly)
  const buffer = (usdMonthly * s.fxBuffer) / 100
  const raw = monthlySum + yearlyMonthly + buffer
  const needed = Math.ceil(raw / 1000) * 1000
  const transfer = Math.ceil(needed / s.subRound) * s.subRound
  return { monthlySum, yearlyMonthly, usdMonthly, buffer, needed, transfer, items }
}
function distributionBefore(ym: string, netPay: number, phases: Phase[], targets: AllocationTarget[], living: Living, subs: Subscription[], changes: PlanChange[], s: Settings): Distribution {
  const phase = phases.find((p) => p.from <= ym && (p.to === null || ym <= p.to)) ?? null
  const livingSum = living.food + living.transit + living.allowance
  const subsTransfer = transferBefore(subs, changes, s, ym).transfer
  const amountOf = (t: AllocationTarget) =>
    t.kind === 'living' ? livingSum : t.kind === 'subscriptions' ? subsTransfer : t.kind === 'fixed' ? (phase?.amounts[t.id] ?? 0) : 0
  const remainderTarget = targets.find((t) => t.kind === 'remainder') ?? null
  const others = targets.filter((t) => t.kind !== 'remainder').reduce((sum, t) => sum + amountOf(t), 0)
  const remainder = netPay - others
  const rows = targets
    .map((t) => ({ key: t.id, name: t.name, kind: t.kind, amount: t.kind === 'remainder' ? remainder : amountOf(t), detail: t.note || '' }))
    .filter((r) => r.amount !== 0 || r.kind === 'remainder')
  return {
    phase, rows, remainder, remainderTarget,
    living: targets.some((t) => t.kind === 'living') ? livingSum : 0,
    subscriptions: targets.some((t) => t.kind === 'subscriptions') ? subsTransfer : 0,
  }
}

function rng(seed: number) {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 2 ** 32
  }
}

test('V-3 (a): without spendings, transferAt and distributionAt equal the pre-change functions (200 random datasets)', () => {
  const rnd = rng(20261121)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  for (let k = 0; k < 200; k++) {
    const s: Settings = { netPay: int(1_500_000, 6_000_000), fxRate: int(1000, 1600), fxBuffer: int(0, 8), payDay: 25, transferDay: int(1, 28), billingDay: 16, subRound: [1000, 5000, 10_000, 50_000][int(0, 3)]!, dayShift: 'none' }
    const subs: Subscription[] = Array.from({ length: int(0, 8) }, (_, i) => {
      const usdPlan = rnd() < 0.5
      return {
        id: `s${i}`, name: `n${i}`, category: 'tool', nextDate: `2026-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`, path: 'direct', verified: true,
        plan: 'p', amount: usdPlan ? int(1, 200) + int(0, 99) / 100 : int(1, 300) * 100, currency: usdPlan ? 'USD' : 'KRW', vat: usdPlan ? int(0, 10) : 0,
        cycle: rnd() < 0.3 ? 'yearly' : 'monthly', status: (['active', 'active', 'cancelled', 'company'] as const)[int(0, 3)]!,
      }
    })
    const changes: PlanChange[] = subs.filter(() => rnd() < 0.4).map((b, i) => ({
      id: `c${i}`, subId: b.id, effective: rnd() < 0.8 ? `2026-${String(int(1, 12)).padStart(2, '0')}-01` : null, to: { amount: int(1, 300) * 100 }, note: '',
    }))
    const ym = `2026-${String(int(1, 12)).padStart(2, '0')}`
    const t = transferAt(subs, changes, s, ym)
    assert.deepEqual(t, transferBefore(subs, changes, s, ym), `transfer ${k}`)
    assert.deepEqual(transferAt(subs, changes, s, ym, 0), t, `transfer extra 0 ${k}`)
    const targets: AllocationTarget[] = [
      { id: 'liv', name: 'L', kind: 'living' }, { id: 'sub', name: 'S', kind: 'subscriptions' }, { id: 'fix', name: 'F', kind: 'fixed' },
      ...(rnd() < 0.7 ? [{ id: 'rem', name: 'R', kind: 'remainder' as const }] : []),
    ]
    const phases: Phase[] = [{ id: 'p', label: 'P', name: 'P', from: '2026-01', to: null, amounts: { fix: int(0, 1_000_000) } }]
    const living: Living = { food: int(0, 600_000), transit: int(0, 100_000), allowance: int(0, 300_000) }
    const d = distributionAt(ym, s.netPay, phases, targets, living, subs, changes, s)
    assert.deepEqual(d, distributionBefore(ym, s.netPay, phases, targets, living, subs, changes, s), `distribution ${k}`)
    assert.deepEqual(distributionAt(ym, s.netPay, phases, targets, living, subs, changes, s, 0), d, `distribution 0 ${k}`)
  }
})

const sub = (id: string, amount: number): Subscription => ({
  id, name: id, category: 'tool', nextDate: '2026-12-05', path: 'direct', verified: true, plan: 'p', amount, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active',
})

test('V-3 (b): subscriptions 155,400 + a subs-account one-off 67,620 with subRound 10,000 = 230,000', () => {
  const subs = [sub('a', 100_000), sub('b', 55_400)]
  assert.equal(transferAt(subs, [], S, '2026-12').transfer, 160_000)
  const one = spending({ payBy: 'subs', how: 'lump', rounds: [round(1, '2026-12-20', 67_620)] })
  const extra = spendingIn([one], '2026-12').subs
  assert.equal(extra, 67_620)
  const t = transferAt(subs, [], S, '2026-12', extra)
  assert.equal(t.monthlySum, 155_400)
  assert.equal(t.needed, 224_000)
  assert.equal(t.transfer, 230_000)
  assert.equal(transferAt(subs, [], S, '2027-01', spendingIn([one], '2027-01').subs).transfer, 160_000)
})

test('V-3 (b2): leftoverAfterTransfer counts a subs-account one-off in the transfer and as paid', () => {
  const subs = [sub('a', 100_000), sub('b', 55_400)]
  const state = { subscriptions: subs, planChanges: [], settings: S }
  const one = spending({ payBy: 'subs', how: 'lump', rounds: [round(1, '2026-12-20', 67_620)] })
  const base = leftoverAfterTransfer(state, '2026-12')
  const withOne = leftoverAfterTransfer(state, '2026-12', none, [one])
  assert.equal(withOne.transfer, 230_000)
  assert.equal(withOne.paid, base.paid + 67_620)
  assert.equal(withOne.count, base.count + 1)
  assert.equal(withOne.left, withOne.transfer - withOne.paid)
  assert.deepEqual(leftoverAfterTransfer(state, '2026-12', none, []), base)
  // a salary one-off or a round outside the window does not count
  const sal = spending({ payBy: 'salary', rounds: [round(1, '2026-12-20', 50_000)] })
  const out = spending({ payBy: 'subs', rounds: [round(1, '2027-02-20', 50_000)] })
  assert.deepEqual(leftoverAfterTransfer(state, '2026-12', none, [sal, out]), base)
})

test('V-3 (c): the remainder target gets spendRemainder less', () => {
  const targets: AllocationTarget[] = [{ id: 'liv', name: 'L', kind: 'living' }, { id: 'sub', name: 'S', kind: 'subscriptions' }, { id: 'rem', name: 'R', kind: 'remainder' }]
  const living: Living = { food: 300_000, transit: 50_000, allowance: 150_000 }
  const subs = [sub('a', 100_000), sub('b', 55_400)]
  const a = distributionAt('2026-12', S.netPay, [], targets, living, subs, [], S)
  const b = distributionAt('2026-12', S.netPay, [], targets, living, subs, [], S, 130_000)
  assert.equal(a.remainder, 3_000_000 - 500_000 - 160_000)
  assert.equal(b.remainder, a.remainder - 130_000)
  assert.equal(b.rows.find((r) => r.key === 'rem')!.amount, a.rows.find((r) => r.key === 'rem')!.amount - 130_000)
  assert.equal(b.rows.find((r) => r.key === 'liv')!.amount, a.rows.find((r) => r.key === 'liv')!.amount)
  assert.equal(b.subscriptions, a.subscriptions)
  assert.equal(num(b.remainder), '2,210,000')
})

// ---------- W-3: monthMoney ----------
test('monthMoney: without spendings it equals the plain calls; with spendings both halves move', () => {
  const targets: AllocationTarget[] = [{ id: 'liv', name: 'L', kind: 'living' }, { id: 'sub', name: 'S', kind: 'subscriptions' }, { id: 'rem', name: 'R', kind: 'remainder' }]
  const living: Living = { food: 300_000, transit: 50_000, allowance: 150_000 }
  const subs = [sub('a', 100_000), sub('b', 55_400)]
  const st = { settings: S, phases: [] as Phase[], targets, living, subscriptions: subs, planChanges: [] as PlanChange[] }
  const plainT = transferAt(subs, [], S, '2026-12')
  const plainD = distributionAt('2026-12', S.netPay, [], targets, living, subs, [], S)
  for (const spendings of [undefined, []]) {
    const m = monthMoney({ ...st, spendings }, '2026-12')
    assert.deepEqual(m.transfer, plainT)
    assert.deepEqual(m.dist, plainD)
    assert.equal(m.spend.items.length, 0)
  }
  const sal = spending({ payBy: 'salary', how: 'lump', rounds: [round(1, '2026-12-10', 130_000)] })
  const card = spending({ payBy: 'card', how: 'installment', rounds: [round(1, '2026-12-16', 70_000)] })
  const bySubs = spending({ payBy: 'subs', how: 'lump', rounds: [round(1, '2026-12-20', 67_620)] })
  const m = monthMoney({ ...st, spendings: [sal, card, bySubs] }, '2026-12')
  assert.equal(m.transfer.transfer, 230_000)
  assert.equal(m.spend.general, 130_000)
  assert.equal(m.spend.installment, 70_000)
  // the subscription row follows the transfer; the remainder loses the transfer's rise and the salary/card rounds
  assert.equal(m.dist.subscriptions, 230_000)
  assert.equal(m.dist.remainder, plainD.remainder - (230_000 - 160_000) - 200_000)
  assert.equal(m.dist.rows.reduce((a, r) => a + r.amount, 0) + 200_000, S.netPay)
  // another month is untouched, and `pay` and `phases` pass through
  assert.deepEqual(monthMoney({ ...st, spendings: [sal, card, bySubs] }, '2027-01').dist, distributionAt('2027-01', S.netPay, [], targets, living, subs, [], S))
  assert.equal(monthMoney({ ...st, spendings: [sal] }, '2026-12', { pay: 4_000_000 }).dist.remainder, plainD.remainder + 1_000_000 - 130_000)
})

// ---------- S-8: the rounds the home and the calendar list ----------
test('upcomingSpendRounds lists left rounds of spendings that are not cancelled, in the window, by date', () => {
  const a = spending({ id: 'a', name: 'A', how: 'installment', count: 3, rounds: [round(1, '2026-12-16', 100), { ...round(2, '2027-01-16', 100), state: 'paid' }, round(3, '2027-02-16', 100)] })
  const b = spending({ id: 'b', name: 'B', how: 'lump', rounds: [round(1, '2026-12-05', 50)] })
  const c = spending({ id: 'c', name: 'C', cancelled: true, rounds: [round(1, '2026-12-06', 70)] })
  const m = spending({ id: 'm', name: 'M', how: 'installment', count: 3, rounds: [{ ...round(1, '2026-12-07', 30), state: 'merged' }, round(2, '2026-12-08', 30)] })
  const from = new Date(2026, 11, 5, 13, 30) // a clock time on the day does not matter
  const w = upcomingSpendRounds([a, b, c, m], from, 31)
  assert.deepEqual(w.map((x) => [x.spending.id, x.round.no, x.dday, x.krw]), [['b', 1, 0, 50], ['m', 2, 3, 30], ['a', 1, 11, 100]])
  assert.deepEqual(upcomingSpendRounds([a, b], from, 0).map((x) => x.spending.id), ['b']) // both ends are inclusive
  assert.deepEqual(upcomingSpendRounds([a], new Date(2026, 11, 5), 100).map((x) => x.round.no), [1, 3]) // the paid one is not due
})

// ---------- replan: the one rule of the editor's warning and its save (A-40) ----------
{
  const R = (no: number, state: SpendingRound['state'] = 'left', edited = false): SpendingRound => ({ no, date: `2027-0${Math.min(no, 9)}-16`, amount: 100, state, edited })
  const fresh = (n: number) => Array.from({ length: n }, (_, i) => R(i + 1))
  const states = (r: SpendingRound[]) => r.map((x) => x.state[0]).join('')
  type Case = {
    name: string; old: SpendingRound[]; n: number; to: 'lump' | 'installment' | 'split'; lump?: 'left' | 'paid' | 'cancelled'
    states: string; kept: number; dropped: number; edited?: number; merged?: number; def?: 'left' | 'paid'
  }
  const cases: Case[] = [
    { name: 'installment, count up, paid at the first', old: [R(1, 'paid'), R(2), R(3)], n: 6, to: 'installment', states: 'plllll', kept: 1, dropped: 0 },
    { name: 'installment, count up, paid in the middle', old: [R(1), R(2, 'paid'), R(3)], n: 5, to: 'installment', states: 'lplll', kept: 1, dropped: 0 },
    { name: 'installment, count down, paid at the last round is removed', old: [R(1), R(2), R(3), R(4), R(5), R(6, 'paid')], n: 3, to: 'split', states: 'lll', kept: 0, dropped: 1 },
    { name: 'split, count down, paid first and last', old: [R(1, 'paid'), R(2), R(3, 'paid')], n: 2, to: 'split', states: 'pl', kept: 1, dropped: 1 },
    { name: 'a paid early-payoff round above the new count is removed', old: [R(1, 'merged'), R(2, 'merged'), R(3, 'merged'), R(4, 'paid')], n: 3, to: 'installment', states: 'lll', kept: 0, dropped: 1, merged: 3 },
    { name: 'a paid early-payoff round under the new count keeps its number', old: [R(1, 'paid'), R(2, 'merged'), R(3, 'paid')], n: 4, to: 'installment', states: 'plpl', kept: 2, dropped: 0, merged: 1 },
    { name: 'edited rounds are dropped, a paid edited one stays paid', old: [R(1, 'paid', true), R(2, 'left', true), R(3)], n: 3, to: 'installment', states: 'pll', kept: 1, dropped: 0, edited: 2 },
    { name: 'installment to lump, none paid', old: [R(1), R(2), R(3)], n: 1, to: 'lump', states: 'l', kept: 0, dropped: 0 },
    { name: 'installment to lump, some paid: left, the marks are dropped', old: [R(1, 'paid'), R(2), R(3)], n: 1, to: 'lump', lump: 'left', states: 'l', kept: 0, dropped: 1 },
    { name: 'installment to lump, every counted round paid: paid by default', old: [R(1, 'paid'), R(2, 'paid'), R(3, 'merged')], n: 1, to: 'lump', states: 'p', kept: 2, dropped: 0, def: 'paid', merged: 1 },
    { name: 'split to lump, chosen paid although not all were', old: [R(1, 'paid'), R(2)], n: 1, to: 'lump', lump: 'paid', states: 'p', kept: 1, dropped: 0, def: 'left' },
    { name: 'lump to installment, a paid lump keeps round 1', old: [R(1, 'paid')], n: 6, to: 'installment', states: 'plllll', kept: 1, dropped: 0, def: 'paid' },
    { name: 'lump to split, a left lump', old: [R(1)], n: 3, to: 'split', states: 'lll', kept: 0, dropped: 0 },
    { name: 'lump to lump: the chosen state, nothing counted as lost', old: [R(1, 'paid')], n: 1, to: 'lump', lump: 'left', states: 'l', kept: 0, dropped: 0, def: 'paid' },
    { name: 'lump to lump, paid again', old: [R(1, 'paid')], n: 1, to: 'lump', lump: 'paid', states: 'p', kept: 0, dropped: 0, def: 'paid' },
    { name: 'a cancelled lump stays left', old: [R(1)], n: 1, to: 'lump', lump: 'cancelled', states: 'l', kept: 0, dropped: 0 },
    { name: 'a cancelled lump that was paid is left', old: [R(1, 'paid')], n: 1, to: 'lump', lump: 'cancelled', states: 'l', kept: 0, dropped: 0 },
  ]
  for (const c of cases) {
    test(`replan: ${c.name}`, () => {
      const out = replan(c.old, fresh(c.n), c.to, c.lump)
      assert.equal(states(out.rounds), c.states)
      assert.equal(out.rounds.length, c.n)
      assert.ok(out.rounds.every((r) => !r.edited && r.date === `2027-0${Math.min(r.no, 9)}-16`), 'the new rounds are the calculated ones')
      assert.equal(out.keptPaid, c.kept)
      assert.equal(out.droppedPaid, c.dropped)
      assert.equal(out.droppedEdited, c.edited ?? 0)
      assert.equal(out.droppedMerged, c.merged ?? 0)
      if (c.def) assert.equal(out.lumpDefault, c.def)
      // what is paid after is what was kept: the warning counts and the saved rounds cannot differ
      assert.equal(out.rounds.filter((r) => r.state === 'paid').length, c.to === 'lump' ? (c.states === 'p' ? 1 : 0) : out.keptPaid)
    })
  }
}
