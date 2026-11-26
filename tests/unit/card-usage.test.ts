// spec 018 S-2 (W-2, V-4): a card's usage period. With a first day, a purchase is billed on the first billing date after
// the usage period that holds it has ended; without one, on the billing day of the month after the purchase, as before.
// Synthetic data, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addYm, cardBillDate, cardBillYm, monthDay, parseDate, planRounds, projectAccount, shiftOf, spendState, usagePeriod, ymd, type AccountState } from '../../src/lib/calc'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { Account, AllocationTarget, Card, DayShift, Settings, Spending } from '../../src/data/types'
import { card as cardBody } from '../../server/validation'

const none: ReadonlySet<string> = new Set()
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 25, transferDay: 26, billingDay: 14 }
const billing = (billingShift: DayShift, over: Partial<Settings> = {}): Settings => ({ ...S, ...over, billingShift })
const card = (billingDay: number | null, usageFrom: number | null) => ({ billingDay, usageFrom })
/** Every date from `from` to `to`, both included. */
function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = parseDate(from); ymd(d) <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(ymd(d))
  return out
}
const nextDay = (date: string) => { const d = parseDate(date); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) }

test('usagePeriod: from the first day of a month to the day before it in the next month', () => {
  assert.deepEqual(usagePeriod('2026-11-12', 12), { start: '2026-11-12', end: '2026-12-11' })
  assert.deepEqual(usagePeriod('2026-12-11', 12), { start: '2026-11-12', end: '2026-12-11' })
  assert.deepEqual(usagePeriod('2026-11-11', 12), { start: '2026-10-12', end: '2026-11-11' })
  assert.deepEqual(usagePeriod('2026-12-12', 12), { start: '2026-12-12', end: '2027-01-11' }) // over the year's end
  assert.deepEqual(usagePeriod('2026-10-18', 18), { start: '2026-10-18', end: '2026-11-17' })
})

test('usagePeriod: no first day is the calendar month, and so is a first day of 1', () => {
  for (const from of [null, undefined, 1]) {
    assert.deepEqual(usagePeriod('2026-11-01', from), { start: '2026-11-01', end: '2026-11-30' })
    assert.deepEqual(usagePeriod('2026-11-30', from), { start: '2026-11-01', end: '2026-11-30' })
    assert.deepEqual(usagePeriod('2026-02-14', from), { start: '2026-02-01', end: '2026-02-28' })
    assert.deepEqual(usagePeriod('2028-02-29', from), { start: '2028-02-01', end: '2028-02-29' })
  }
})

test('usagePeriod: a month shorter than the first day starts on its last day (February, the 31st)', () => {
  assert.deepEqual(usagePeriod('2026-01-31', 31), { start: '2026-01-31', end: '2026-02-27' })
  assert.deepEqual(usagePeriod('2026-02-27', 31), { start: '2026-01-31', end: '2026-02-27' })
  assert.deepEqual(usagePeriod('2026-02-28', 31), { start: '2026-02-28', end: '2026-03-30' })
  assert.deepEqual(usagePeriod('2026-03-31', 31), { start: '2026-03-31', end: '2026-04-29' })
  assert.deepEqual(usagePeriod('2026-04-30', 31), { start: '2026-04-30', end: '2026-05-30' })
  assert.deepEqual(usagePeriod('2026-02-28', 30), { start: '2026-02-28', end: '2026-03-29' })
  assert.deepEqual(usagePeriod('2028-02-29', 30), { start: '2028-02-29', end: '2028-03-29' }) // a leap year
  assert.deepEqual(usagePeriod('2028-02-28', 30), { start: '2028-01-30', end: '2028-02-28' })
})

test('usagePeriod: every date is in its period, and the periods follow each other without a gap or an overlap', () => {
  for (let from = 1; from <= 31; from++) {
    let prev: { start: string; end: string } | null = null
    for (const d of days('2026-01-01', '2028-03-31')) {
      const p = usagePeriod(d, from)
      assert.ok(p.start <= d && d <= p.end, `${d} in ${p.start}..${p.end} (first day ${from})`)
      if (prev && prev.start !== p.start) assert.equal(p.start, nextDay(prev.end), `first day ${from}: ${prev.end} then ${p.start}`)
      if (prev && prev.start === p.start) assert.equal(p.end, prev.end)
      prev = p
    }
  }
})

test('the examples of S-2: the first billing date after the usage period ends', () => {
  // billing day 14, first day 1: bought in November → December 14th
  assert.equal(cardBillDate('2026-11-10', card(14, 1), S, none), '2026-12-14')
  assert.equal(cardBillDate('2026-11-01', card(14, 1), S, none), '2026-12-14')
  assert.equal(cardBillDate('2026-11-30', card(14, 1), S, none), '2026-12-14')
  // billing day 25, first day 12: November 12th … December 11th → December 25th; the day before → November 25th
  for (const d of days('2026-11-12', '2026-12-11')) assert.equal(cardBillDate(d, card(25, 12), S, none), '2026-12-25', d)
  assert.equal(cardBillDate('2026-11-11', card(25, 12), S, none), '2026-11-25')
  assert.equal(cardBillDate('2026-12-12', card(25, 12), S, none), '2027-01-25')
  // billing day 1, first day 18: October 18th … November 17th → December 1st
  for (const d of days('2026-10-18', '2026-11-17')) assert.equal(cardBillDate(d, card(1, 18), S, none), '2026-12-01', d)
  assert.equal(cardBillDate('2026-10-17', card(1, 18), S, none), '2026-11-01')
  assert.equal(cardBillDate('2026-11-18', card(1, 18), S, none), '2027-01-01')
})

test('the billing date is strictly after the period\'s last day', () => {
  // first day 12, billing day 12: the period ends on the 11th, the bill is the next day
  assert.equal(cardBillDate('2026-11-20', card(12, 12), S, none), '2026-12-12')
  // billing day 11 is the period's last day itself: the bill is the 11th of the month after
  assert.equal(cardBillDate('2026-11-20', card(11, 12), S, none), '2027-01-11')
})

test('February and the 31st: the billing day and the first day are both cut to the month\'s length', () => {
  // first day 15, billing day 31: the period January 15th … February 14th is billed on February's last day
  assert.equal(cardBillDate('2026-01-20', card(31, 15), S, none), '2026-02-28')
  assert.equal(cardBillDate('2028-01-20', card(31, 15), S, none), '2028-02-29')
  // first day 31, billing day 30: January 31st … February 27th → February 28th; February 28th … March 30th → April 30th
  assert.equal(cardBillDate('2026-01-31', card(30, 31), S, none), '2026-02-28')
  assert.equal(cardBillDate('2026-02-28', card(30, 31), S, none), '2026-04-30')
  // first day 31, billing day 31: March 31st … April 29th → April 30th
  assert.equal(cardBillDate('2026-03-31', card(31, 31), S, none), '2026-04-30')
  assert.equal(cardBillDate('2026-12-31', card(14, 1), S, none), '2027-01-14')
})

test('a card without its own billing day uses the settings\' one, with and without a usage period', () => {
  assert.equal(cardBillDate('2026-11-20', card(null, 12), { ...S, billingDay: 25 }, none), '2026-12-25')
  assert.equal(cardBillDate('2026-11-05', card(null, 12), { ...S, billingDay: 25 }, none), '2026-11-25')
  assert.equal(cardBillDate('2026-11-20', { usageFrom: 12 }, { ...S, billingDay: 25 }, none), '2026-12-25')
  assert.equal(cardBillDate('2026-11-20', null, { ...S, billingDay: 25 }, none), '2026-12-25')
  assert.equal(cardBillDate('2026-11-20', undefined, { ...S, billingDay: 25 }, none), '2026-12-25')
})

test('no first day: the formula up to 0.1.9, the billing day of the month after the purchase, for every date, day and rule', () => {
  const off = new Set(['2026-03-02', '2026-09-24', '2026-09-25', '2026-12-25', '2027-01-01'])
  for (const shift of ['none', 'before', 'after'] as const) {
    for (let day = 1; day <= 31; day++) {
      const s = billing(shift, { billingDay: 32 - day })
      for (const d of days('2026-01-01', '2027-02-28')) {
        const old = monthDay(addYm(d.slice(0, 7), 1), day, shiftOf(s, 'billing'), off).date
        assert.equal(cardBillDate(d, card(day, null), s, off), old, `${d} day ${day} ${shift}`)
        assert.equal(cardBillDate(d, { billingDay: day }, s, off), old)
        // a first day of 1 gives the same dates as none
        assert.equal(cardBillDate(d, card(day, 1), s, off), old, `${d} day ${day} ${shift}, first day 1`)
        // the settings' billing day, for a card without its own and for no card
        const oldSet = monthDay(addYm(d.slice(0, 7), 1), s.billingDay, shiftOf(s, 'billing'), off).date
        assert.equal(cardBillDate(d, card(null, null), s, off), oldSet)
        assert.equal(cardBillDate(d, null, s, off), oldSet)
      }
    }
  }
})

test('the month is found by the billing day as set, then the date moves by the billing rule', () => {
  // first day 18, billing day 1: September 18th … October 17th → November 1st 2026, a Sunday
  assert.equal(cardBillYm('2026-09-20', card(1, 18), S), '2026-11')
  assert.equal(cardBillDate('2026-09-20', card(1, 18), billing('none'), none), '2026-11-01')
  assert.equal(cardBillDate('2026-09-20', card(1, 18), billing('before'), none), '2026-10-30')
  assert.equal(cardBillDate('2026-09-20', card(1, 18), billing('after'), none), '2026-11-02')
  // the pay and transfer rules do not move it
  assert.equal(cardBillDate('2026-09-20', card(1, 18), { ...S, payShift: 'before', transferShift: 'after' }, none), '2026-11-01')
  // first day 12, billing day 12: December 12th 2026 is a Saturday; moved back it is the period's last day, and it stays this bill
  assert.equal(cardBillDate('2026-11-20', card(12, 12), billing('before'), none), '2026-12-11')
})

test('planRounds: a card\'s first round is the bill of the purchase, then one billing date a month', () => {
  const lump = (bought: string, c: { billingDay: number | null; usageFrom: number | null }) =>
    planRounds({ bought, how: 'lump', payBy: 'card', count: 1, principal: 100_000, ...c }, S, none).map((r) => r.date)
  assert.deepEqual(lump('2026-11-20', card(25, 12)), ['2026-12-25'])
  assert.deepEqual(lump('2026-11-05', card(25, 12)), ['2026-11-25'])
  assert.deepEqual(lump('2026-10-20', card(1, 18)), ['2026-12-01'])
  // no first day: the month after the purchase, as before
  assert.deepEqual(lump('2026-11-05', card(25, null)), ['2026-12-25'])
  assert.deepEqual(planRounds({ bought: '2026-11-05', how: 'lump', payBy: 'card', count: 1, principal: 100_000, billingDay: 25 }, S, none).map((r) => r.date), ['2026-12-25'])
  // the settings' billing day (14) when the card has none
  assert.deepEqual(lump('2026-11-20', card(null, 12)), ['2026-12-14'])
  assert.deepEqual(lump('2026-11-05', card(null, 12)), ['2026-11-14'])
  const inst = planRounds({ bought: '2026-11-05', how: 'installment', payBy: 'card', count: 3, principal: 300_000, ...card(25, 12) }, S, none)
  assert.deepEqual(inst.map((r) => r.date), ['2026-11-25', '2026-12-25', '2027-01-25'])
  assert.deepEqual(inst.map((r) => r.amount), [100_000, 100_000, 100_000])
})

test('planRounds: the rounds after the first follow the month of the bill, not the month a moved date falls in', () => {
  // the bill of November 1st 2026 (a Sunday) moves back to October 30th; the next round is still December's
  const r = planRounds({ bought: '2026-09-20', how: 'installment', payBy: 'card', count: 3, principal: 300_000, ...card(1, 18) }, billing('before'), none)
  assert.deepEqual(r.map((x) => x.date), ['2026-10-30', '2026-12-01', '2027-01-01'])
})

test('planRounds: what is not a card round does not read the usage period', () => {
  const base = { bought: '2026-11-05', count: 1, principal: 100_000, billingDay: 25 }
  for (const usageFrom of [null, 12]) {
    assert.deepEqual(planRounds({ ...base, how: 'lump', payBy: 'salary', usageFrom }, S, none).map((r) => r.date), ['2026-11-05'])
    assert.deepEqual(planRounds({ ...base, how: 'lump', payBy: 'subs', usageFrom }, S, none).map((r) => r.date), ['2026-11-05'])
    assert.deepEqual(planRounds({ ...base, how: 'split', payBy: 'card', count: 2, interval: 'monthly', usageFrom }, S, none).map((r) => r.date), ['2026-11-05', '2026-12-05'])
    assert.deepEqual(planRounds({ ...base, how: 'buffer', payBy: 'card', count: 2, usageFrom }, S, none).map((r) => r.date), ['2026-11-25', '2026-12-25'])
  }
})

test('projection: the bill of a buffer use leaves the account on the bill date of the card\'s usage period', () => {
  const acc = (id: string, over: Partial<Account> = {}): Account =>
    ({ id, name: id, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
  const pay = acc('pay', { buffer: 1_000_000 })
  const targets: AllocationTarget[] = [{ id: 'tr', name: 'Rest', kind: 'remainder' }]
  const use: Spending = {
    id: 's1', name: 'Desk', category: 'home', bought: '2026-11-05', amount: 400_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'buffer', payBy: 'card', count: 2, fee: 0, interval: null, cancelled: false, cardId: 'c1', refillFrom: '2027-01-25',
    rounds: planRounds({ bought: '2026-11-05', how: 'buffer', payBy: 'card', count: 2, principal: 400_000, refillFrom: '2027-01-25' }, S, none),
  }
  const st = (c: Card): AccountState => ({
    settings: S, phases: [], targets, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], subscriptions: [], planChanges: [],
    spendings: [use], accounts: [pay], cards: [c], balances: [{ id: 'b1', accountId: 'pay', date: '2026-11-01', amount: 1_000_000 }],
  })
  const out = (c: Card) => projectAccount(pay, st(c), none, '2026-11', 3)!.map((x) => [x.ym, x.outflow])
  const c1: Card = { id: 'c1', name: 'Card', last4: '', accountId: 'pay', billingDay: 25, usageFrom: null }
  // no first day: bought in November, billed on December 25th
  assert.deepEqual(out(c1), [['2026-11', 0], ['2026-12', 400_000], ['2027-01', 0]])
  assert.deepEqual(out({ ...c1, usageFrom: undefined }), [['2026-11', 0], ['2026-12', 400_000], ['2027-01', 0]])
  // first day 12: November 5th is in the period that ends on November 11th, billed on November 25th
  assert.deepEqual(out({ ...c1, usageFrom: 12 }), [['2026-11', 400_000], ['2026-12', 0], ['2027-01', 0]])
  // first day 28: the period October 28th … November 27th is billed on December 25th
  assert.deepEqual(out({ ...c1, usageFrom: 28 }), [['2026-11', 0], ['2026-12', 400_000], ['2027-01', 0]])
})

test('spendState: a card spending without rounds waits for the bill of its card\'s usage period', () => {
  const sp = {
    id: 's', name: 'x', category: 'home', bought: '2026-11-20', amount: 10_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, rounds: [],
  } as unknown as Spending
  // no card: the settings' billing day of the month after (December 14th)
  assert.equal(spendState(sp, '2026-12-13', S, none), 'billing')
  assert.equal(spendState(sp, '2026-12-14', S, none), 'planned')
  // billing day 25, first day 12: December 25th
  assert.equal(spendState(sp, '2026-12-24', S, none, card(25, 12)), 'billing')
  assert.equal(spendState(sp, '2026-12-25', S, none, card(25, 12)), 'planned')
  // a stored round is the bill, whatever the card says now (stored rounds are not worked out again)
  const stored = { ...sp, rounds: [{ no: 1, date: '2026-12-14', amount: 10_000, state: 'left', edited: false }] } as Spending
  assert.equal(spendState(stored, '2026-12-14', S, none, card(25, 12)), 'planned')
})

test('the card body: the first day is 1..31, null or left out; a body in the 0.1.9 shape passes and names no first day (S-12)', () => {
  const old = { name: 'Card', last4: '', accountId: null, billingDay: 25 }
  const parsed = cardBody.safeParse(old)
  assert.equal(parsed.success, true)
  // left out stays left out: the row that is written has no `usageFrom`, so the saved one stays
  assert.equal('usageFrom' in (parsed.data as object), false)
  for (const usageFrom of [1, 12, 31, null]) {
    const r = cardBody.safeParse({ ...old, usageFrom })
    assert.equal(r.success, true, String(usageFrom))
    assert.equal((r.data as { usageFrom?: number | null }).usageFrom, usageFrom)
  }
  for (const usageFrom of [0, 32, 1.5, -1, '12', true]) assert.equal(cardBody.safeParse({ ...old, usageFrom }).success, false, String(usageFrom))
})
