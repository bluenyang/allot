// The month a spending round counts in and the month's outgoing rounds (spec 018 S-5, S-6, W-5): a card bill counts in
// the month of the pay before it (the pay whose actual date is the last one before the bill; A-14, A-32); every other
// round in the month whose period holds its date.
// Every expected value is worked out by hand in the comments. No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { AllocationTarget, Card, Settings, Spending, SpendingRound } from '../../src/data/types'
import { monthCtx, monthOutgo, outgoOf, roundYm, spendingIn, ymOfDate } from '../../src/lib/calc'

// Pay day 25, no weekend rule, calendar months.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const none: ReadonlySet<string> = new Set()
// c1 is paid from an account; c2 has no paying account; the basis card's usage period starts on the 12th
const CARDS: Card[] = [
  { id: 'c1', name: 'One', last4: '', accountId: 'pay-acc', billingDay: 14 },
  { id: 'c2', name: 'Two', last4: '', accountId: null, billingDay: 14 },
  { id: 'basis', name: 'Basis', last4: '', accountId: null, billingDay: 25, usageFrom: 12 },
]
const TARGETS: AllocationTarget[] = [
  { id: 't-s', name: 'Subs', kind: 'subscriptions', accountId: 'subs-acc' },
  { id: 't-r', name: 'Rest', kind: 'remainder' },
]
const ctxOfS = (s: Settings, off: ReadonlySet<string> = none) => monthCtx(s, CARDS, off)
const round = (no: number, date: string, amount: number, state: SpendingRound['state'] = 'left'): SpendingRound => ({ no, date, amount, state, edited: false })
const spending = (id: string, over: Partial<Spending>): Spending => ({
  id, name: id, category: '', bought: '2026-11-01', amount: 0, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'lump', payBy: 'card', count: 1, fee: 0,
  interval: null, cancelled: false, rounds: [], ...over,
})
const bill = { how: 'lump', payBy: 'card' } as const
const at = (date: string) => ({ date })

test('a card bill counts in the month of the last pay date before it: before, on and after the pay day (calendar basis)', () => {
  const ctx = ctxOfS(S)
  // 12-14: the pay before it is 11-25 → November
  assert.equal(roundYm(bill, at('2026-12-14'), ctx), '2026-11')
  // 12-25 is a pay date itself: the pay date before it, 11-25 → November
  assert.equal(roundYm(bill, at('2026-12-25'), ctx), '2026-11')
  // 12-26: the pay of 12-25 → December
  assert.equal(roundYm(bill, at('2026-12-26'), ctx), '2026-12')
  // across the year: 2027-01-14 → the pay of 12-25 → December 2026
  assert.equal(roundYm(bill, at('2027-01-14'), ctx), '2026-12')
  // an installment's rounds are card bills too
  assert.equal(roundYm({ how: 'installment', payBy: 'card' }, at('2026-12-14'), ctx), '2026-11')
})

test('a pay moved into the neighbouring calendar month still names its own month (calendar basis, A-14)', () => {
  // pay day 1, moved back off a weekend: 2026-11-01 is a Sunday, so November's pay is dated 10-30 (Friday);
  // October's pay is 10-01 (Thursday), December's 12-01 (Tuesday)
  const ctx = ctxOfS({ ...S, payDay: 1, payShift: 'before' })
  // 11-14: the pay before it is November's (10-30) → November, not October
  assert.equal(roundYm(bill, at('2026-11-14'), ctx), '2026-11')
  // 10-31: the pay before it is still November's (10-30) → November
  assert.equal(roundYm(bill, at('2026-10-31'), ctx), '2026-11')
  // 10-30 is that pay date itself: the pay before it, October's (10-01) → October
  assert.equal(roundYm(bill, at('2026-10-30'), ctx), '2026-10')
  // 12-01 is December's pay date: the pay before it is November's → November; 12-02 → December
  assert.equal(roundYm(bill, at('2026-12-01'), ctx), '2026-11')
  assert.equal(roundYm(bill, at('2026-12-02'), ctx), '2026-12')
})

test('the pay basis: a card bill counts in the month whose period holds its date, except a bill dated on a pay date', () => {
  // pay day 25 names a month by its end: "2026-12" = 11-25 … 12-24, "2027-01" = 12-25 … 01-24
  const ctx = ctxOfS({ ...S, monthBasis: 'pay' })
  // 12-14: the pay of 11-25, the first day of "2026-12" — the period that holds 12-14
  assert.equal(roundYm(bill, at('2026-12-14'), ctx), '2026-12')
  assert.equal(ymOfDate('2026-12-14', ctx), '2026-12')
  // 12-26: the pay of 12-25, the first day of "2027-01" — the period that holds 12-26
  assert.equal(roundYm(bill, at('2026-12-26'), ctx), '2027-01')
  assert.equal(ymOfDate('2026-12-26', ctx), '2027-01')
  // 12-25 opens "2027-01", but a bill dated on a pay date is paid with the pay before it (11-25): "2026-12"
  assert.equal(ymOfDate('2026-12-25', ctx), '2027-01')
  assert.equal(roundYm(bill, at('2026-12-25'), ctx), '2026-12')
  // every other day of two periods: the same month as the date's own
  for (let d = 26; d <= 31; d++) assert.equal(roundYm(bill, at(`2026-11-${d}`), ctx), '2026-12')
  for (let d = 1; d <= 24; d++) { const date = `2026-12-${String(d).padStart(2, '0')}`; assert.equal(roundYm(bill, at(date), ctx), ymOfDate(date, ctx), date) }
  // named by the start ("2026-11" = 11-25 … 12-24): the same dates, one name earlier
  const start = ctxOfS({ ...S, monthBasis: 'pay', monthNaming: 'start' })
  assert.deepEqual(['2026-12-14', '2026-12-25', '2026-12-26'].map((d) => roundYm(bill, at(d), start)), ['2026-11', '2026-11', '2026-12'])
})

test('the card basis: the month whose usage period holds the pay date before the bill', () => {
  // the basis card's period starts on the 12th, named by its start: "2026-11" = 11-12 … 12-11, "2026-12" = 12-12 … 01-11
  const ctx = ctxOfS({ ...S, monthBasis: 'card', monthBasisCardId: 'basis' })
  // 12-14 lies in "2026-12", but the pay before it, 11-25, lies in "2026-11"
  assert.equal(ymOfDate('2026-12-14', ctx), '2026-12')
  assert.equal(roundYm(bill, at('2026-12-14'), ctx), '2026-11')
  // 12-26: the pay of 12-25, in "2026-12"
  assert.equal(roundYm(bill, at('2026-12-26'), ctx), '2026-12')
})

// Review 3 F-2: on a card basis a pay that the pay rule moves across the edge of the card's period still names its own
// month — the month whose period holds the pay day as set — as A-14 does on the calendar basis. Otherwise one month
// took the bills of two and its neighbour none.
test('the card basis: a pay moved across the period\'s edge still names its own month (first day 12, pay day 12)', () => {
  // 2026-04-12 is a Sunday: with the rule "before" April's pay is dated 04-10, inside "2026-03" (03-12 … 04-11)
  const before = ctxOfS({ ...S, payDay: 12, payShift: 'before', monthBasis: 'card', monthBasisCardId: 'basis' })
  assert.equal(new Date(2026, 3, 12).getDay(), 0)
  assert.equal(ymOfDate('2026-04-10', before), '2026-03')
  // a bill of 04-10 is dated on that pay date: the pay before it, 03-12 (a Thursday) → March
  assert.equal(roundYm(bill, at('2026-04-10'), before), '2026-03')
  // 04-11 … 05-12: the pay of 04-10 is April's pay → April (it was March: two months of bills in one)
  for (const d of ['2026-04-11', '2026-04-12', '2026-04-30', '2026-05-11', '2026-05-12']) assert.equal(roundYm(bill, at(d), before), '2026-04', d)
  // 05-13: May's pay of 05-12 (a Tuesday) → May
  assert.equal(roundYm(bill, at('2026-05-13'), before), '2026-05')
  // the rule "after", pay day 11: 2026-04-11 is a Saturday, so April's pay is dated 04-13, inside "2026-04" (04-12 …),
  // but it is the pay of the month that holds the 11th as set: "2026-03" (03-12 … 04-11)
  const after = ctxOfS({ ...S, payDay: 11, payShift: 'after', monthBasis: 'card', monthBasisCardId: 'basis' })
  assert.equal(new Date(2026, 3, 11).getDay(), 6)
  assert.equal(roundYm(bill, at('2026-04-13'), after), '2026-02', 'dated on the pay date: the pay before it, 03-11, the pay of "2026-02" (02-12 … 03-11)')
  assert.equal(roundYm(bill, at('2026-04-14'), after), '2026-03')
  assert.equal(roundYm(bill, at('2026-05-11'), after), '2026-03', '05-11 is a pay date itself (a Monday): the pay before it')
  assert.equal(roundYm(bill, at('2026-05-12'), after), '2026-04')
  // no month takes two months of bills and none is left without: every month of two years counts 26 to 35 days of
  // bills, with each rule and a pay day on either side of the card's first day
  const p2 = (n: number) => String(n).padStart(2, '0')
  for (const payShift of ['none', 'before', 'after'] as const) {
    for (const payDay of [9, 10, 11, 12, 13, 14]) {
      const ctx = ctxOfS({ ...S, payDay, payShift, monthBasis: 'card', monthBasisCardId: 'basis' })
      const days = new Map<string, number>()
      for (let d = new Date(2026, 0, 1); d < new Date(2028, 0, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        const ym = roundYm(bill, at(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`), ctx)
        days.set(ym, (days.get(ym) ?? 0) + 1)
      }
      for (const [ym, n] of days) {
        if (ym < '2026-02' || ym > '2027-10') continue // the months at the ends are cut by the range of dates
        assert.equal(n >= 26 && n <= 35, true, `pay day ${payDay}, ${payShift}: ${ym} counts ${n} days of bills`)
      }
    }
  }
})

test('the pay date is the actual one: moved by the pay rule off a weekend or a holiday', () => {
  // 2026-10-25 is a Sunday: with 'before' the pay comes on Friday 10-23
  assert.equal(new Date(2026, 9, 25).getDay(), 0)
  const before = ctxOfS({ ...S, payShift: 'before' })
  // a bill of 10-23 is dated on the pay date: the pay before it, 09-25 → September
  assert.equal(roundYm(bill, at('2026-10-23'), before), '2026-09')
  // 10-24 and 10-25 come after the pay of 10-23 → October
  assert.equal(roundYm(bill, at('2026-10-24'), before), '2026-10')
  assert.equal(roundYm(bill, at('2026-10-25'), before), '2026-10')
  // without the rule the pay is on 10-25: a bill of 10-24 or 10-25 is September's, one of 10-26 October's
  const plain = ctxOfS(S)
  assert.deepEqual(['2026-10-24', '2026-10-25', '2026-10-26'].map((d) => roundYm(bill, at(d), plain)), ['2026-09', '2026-09', '2026-10'])
  // with 'after' the pay comes on Monday 10-26: a bill of 10-26 is September's, one of 10-27 October's
  const after = ctxOfS({ ...S, payShift: 'after' })
  assert.deepEqual(['2026-10-26', '2026-10-27'].map((d) => roundYm(bill, at(d), after)), ['2026-09', '2026-10'])
  // a holiday on Friday 12-25: with 'before' the pay comes on 12-24, so a bill of 12-25 is December's
  const holiday = ctxOfS({ ...S, payShift: 'before' }, new Set(['2026-12-25']))
  assert.deepEqual(['2026-12-24', '2026-12-25'].map((d) => roundYm(bill, at(d), holiday)), ['2026-11', '2026-12'])
  // the billing rule and the transfer rule do not move the pay date
  assert.equal(roundYm(bill, at('2026-10-24'), ctxOfS({ ...S, billingShift: 'before', transferShift: 'before' })), '2026-09')
})

test('every other round counts by its own date: a buffer refill, a split (also one paid by card), a salary or subscription-account round', () => {
  for (const s of [S, { ...S, monthBasis: 'pay' as const }, { ...S, monthBasis: 'card' as const, monthBasisCardId: 'basis' }]) {
    const ctx = ctxOfS(s)
    for (const date of ['2026-12-14', '2026-12-25', '2026-12-26']) {
      const own = ymOfDate(date, ctx)
      // a buffer use is paid by card, but its rounds are refills sent on pay days: 12-25 is in the month of 12-25
      assert.equal(roundYm({ how: 'buffer', payBy: 'card' }, at(date), ctx), own, `refill ${date} ${s.monthBasis}`)
      assert.equal(roundYm({ how: 'split', payBy: 'card' }, at(date), ctx), own, `card split ${date}`)
      assert.equal(roundYm({ how: 'split', payBy: 'salary' }, at(date), ctx), own, `split ${date}`)
      assert.equal(roundYm({ how: 'lump', payBy: 'salary' }, at(date), ctx), own, `salary ${date}`)
      assert.equal(roundYm({ how: 'lump', payBy: 'subs' }, at(date), ctx), own, `subs ${date}`)
      assert.equal(roundYm({ how: 'installment', payBy: 'salary' }, at(date), ctx), own, `salary installment ${date}`)
    }
  }
  // calendar basis, the refill of 12-25: December (a card bill of the same date would be November's)
  assert.equal(roundYm({ how: 'buffer', payBy: 'card' }, at('2026-12-25'), ctxOfS(S)), '2026-12')
})

// One made-up month list. Card bills dated 11-26 … 12-25 are November's, the others count by date.
const spendings: Spending[] = [
  spending('a', { cardId: 'c1', rounds: [round(1, '2026-12-14', 100_000)] }),
  spending('b', { how: 'installment', count: 2, cardId: 'c2', rounds: [round(1, '2026-12-14', 30_000), round(2, '2027-01-14', 30_000)] }),
  spending('c', { rounds: [round(1, '2026-12-14', 5_000)] }), // by card, no card chosen
  spending('d', { how: 'buffer', count: 2, cardId: 'c1', refillFrom: '2026-11-25', rounds: [round(1, '2026-11-25', 20_000), round(2, '2026-12-25', 20_000)] }),
  spending('e', { how: 'split', payBy: 'salary', count: 2, interval: 'custom', rounds: [round(1, '2026-11-30', 7_000), round(2, '2026-12-14', 7_000)] }),
  spending('f', { payBy: 'subs', rounds: [round(1, '2026-11-20', 9_000)] }),
  spending('g', { how: 'split', count: 2, interval: 'monthly', cardId: 'c1', rounds: [round(1, '2026-11-10', 4_000), round(2, '2026-12-10', 4_000)] }),
  // cancelled: only its paid round counts; and a merged round never does
  spending('h', { how: 'installment', count: 2, cardId: 'c1', cancelled: true, rounds: [round(1, '2026-12-14', 1_000, 'paid'), round(2, '2027-01-14', 1_000)] }),
  spending('i', { how: 'installment', count: 2, cardId: 'c1', rounds: [round(1, '2026-12-14', 999, 'merged')] }),
]
const state = { spendings, cards: CARDS, targets: TARGETS }

test('monthOutgo: the rounds a month counts, each with where it comes from, its kind and the account it goes through', () => {
  const ctx = ctxOfS(S)
  const row = (ym: string) => monthOutgo(state, ym, ctx).map((o) => [o.spending.id, o.round.no, o.amount, o.from, o.kind, o.accountId])
  assert.deepEqual(row('2026-11'), [
    ['a', 1, 100_000, 'remainder', 'card', 'pay-acc'], // bill of 12-14, the card's paying account
    ['b', 1, 30_000, 'remainder', 'card', null], // its card has no paying account
    ['c', 1, 5_000, 'remainder', 'card', null], // no card chosen
    ['d', 1, 20_000, 'remainder', 'refill', 'pay-acc'], // the refill of 11-25, by its date
    ['e', 1, 7_000, 'remainder', 'direct', null], // paid from the salary account on 11-30
    ['f', 1, 9_000, 'subs', 'direct', 'subs-acc'], // paid from the account of the subscriptions target
    ['g', 1, 4_000, 'remainder', 'card', 'pay-acc'], // a split paid by card on 11-10: by its date
    ['h', 1, 1_000, 'remainder', 'card', 'pay-acc'], // the paid round of a cancelled spending
  ])
  assert.deepEqual(row('2026-12'), [
    ['b', 2, 30_000, 'remainder', 'card', null], // bill of 2027-01-14, paid with the pay of 12-25
    ['d', 2, 20_000, 'remainder', 'refill', 'pay-acc'],
    ['e', 2, 7_000, 'remainder', 'direct', null],
    ['g', 2, 4_000, 'remainder', 'card', 'pay-acc'],
  ])
  assert.deepEqual(row('2027-01'), [])
  // every round that counts is in exactly one month
  const all = outgoOf(state, ctx)
  assert.equal(all.length, 12)
  assert.deepEqual([...new Set(all.map((o) => o.ym))].sort(), ['2026-11', '2026-12'])
  // without cards and targets no round names an account; the months are the same
  assert.deepEqual(monthOutgo({ spendings }, '2026-11', ctx).map((o) => o.accountId), Array(8).fill(null))
})

test('spendingIn is the sum of the month\'s outgoing rounds, with what goes through each paying account', () => {
  const ctx = ctxOfS(S)
  const nov = spendingIn(spendings, '2026-11', ctx, state)
  // subs: f 9,000. remainder: 100,000 + 30,000 + 5,000 + 20,000 + 7,000 + 4,000 + 1,000 = 167,000
  assert.equal(nov.subs, 9_000)
  assert.equal(nov.remainder, 167_000)
  // lump sums a and c = 105,000; the rest (installments, the refill, the splits) = 62,000
  assert.deepEqual([nov.general, nov.installment], [105_000, 62_000])
  assert.deepEqual(nov.items, monthOutgo(state, '2026-11', ctx))
  // pay-acc: its cards' rounds a 100,000 + g 4,000 + h 1,000 = 105,000 and the refill 20,000; the subscription-account round is not here (it is in the transfer)
  assert.deepEqual(nov.byAccount, [{ accountId: 'pay-acc', card: 105_000, refill: 20_000 }])
  const dec = spendingIn(spendings, '2026-12', ctx, state)
  assert.deepEqual([dec.subs, dec.remainder, dec.general, dec.installment], [0, 61_000, 0, 61_000])
  assert.deepEqual(dec.byAccount, [{ accountId: 'pay-acc', card: 4_000, refill: 20_000 }])
  // the sums do not need the cards and targets: without them only the accounts are missing
  const bare = spendingIn(spendings, '2026-11', ctx)
  assert.deepEqual([bare.subs, bare.remainder, bare.general, bare.installment, bare.byAccount], [9_000, 167_000, 105_000, 62_000, []])
})

test('a call that names no basis counts by the calendar month with the pay day on the 1st', () => {
  const sum = (ym: string) => spendingIn([spending('x', { rounds: [round(1, '2026-12-16', 50_000)] }), spending('y', { rounds: [round(1, '2026-12-01', 3_000)] })], ym).remainder
  // a bill of 12-16 follows the pay of 12-01: December; a bill dated on the 1st follows the pay of 11-01: November
  assert.equal(sum('2026-12'), 50_000)
  assert.equal(sum('2026-11'), 3_000)
})
