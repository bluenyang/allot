// spec 018 S-1 (W-1, V-4): each date has its own weekend and holiday rule — the pay day, the transfer day, the card
// billing day and every schedule item — and the one rule of the bodies up to 0.1.9 (`dayShift`) fills the three.
// Synthetic data, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardBillDate, leftoverAfterTransfer, monthDates, needsHolidays, nextTransferYm, payDayFrom, planRounds, shiftOf, spendState } from '../../src/lib/calc'
import { scheduleItemsIn } from '../../src/lib/schedule-items'
import { DEFAULT_SETTINGS } from '../../src/data/defaults'
import type { DayShift, ScheduleItem, Settings, Spending } from '../../src/data/types'
import { scheduleItem, settings, settingsRow } from '../../server/validation'

const none: ReadonlySet<string> = new Set()
// November 2026: the 14th, 21st and 28th are Saturdays, the 15th and 22nd Sundays. December 2026: the 26th is a Saturday.
const S: Settings = { ...DEFAULT_SETTINGS, netPay: 3_000_000, payDay: 21, transferDay: 22, billingDay: 14 }
const rules = (payShift: DayShift, transferShift: DayShift, billingShift: DayShift): Settings => ({ ...S, payShift, transferShift, billingShift })

test('shiftOf: the rule of each date, none when it is not set', () => {
  const s = rules('before', 'after', 'none')
  assert.deepEqual([shiftOf(s, 'pay'), shiftOf(s, 'transfer'), shiftOf(s, 'billing')], ['before', 'after', 'none'])
  assert.deepEqual([shiftOf({}, 'pay'), shiftOf({}, 'transfer'), shiftOf({}, 'billing')], ['none', 'none', 'none'])
})

test('monthDates: each of the three dates moves by its own rule', () => {
  const d = monthDates('2026-11', rules('before', 'after', 'none'), none)
  assert.deepEqual([d.pay.date, d.pay.shifted], ['2026-11-20', 'before']) // Saturday the 21st → Friday
  assert.deepEqual([d.transfer.date, d.transfer.shifted], ['2026-11-23', 'after']) // Sunday the 22nd → Monday
  assert.deepEqual([d.billing.date, d.billing.shifted], ['2026-11-14', null]) // Saturday the 14th stays
  const other = monthDates('2026-11', rules('none', 'none', 'after'), none)
  assert.deepEqual([other.pay.date, other.transfer.date, other.billing.date], ['2026-11-21', '2026-11-22', '2026-11-16'])
})

test('the same rule on all three gives the dates the one rule gave', () => {
  for (const r of ['none', 'before', 'after'] as const) {
    const d = monthDates('2026-11', rules(r, r, r), none)
    const want = { none: ['2026-11-21', '2026-11-22', '2026-11-14'], before: ['2026-11-20', '2026-11-20', '2026-11-13'], after: ['2026-11-23', '2026-11-23', '2026-11-16'] }[r]
    assert.deepEqual([d.pay.date, d.transfer.date, d.billing.date], want, r)
  }
})

test('planRounds: card rounds follow the billing rule, also with a billing day of the card\'s own', () => {
  const card = { bought: '2026-10-10', how: 'lump', payBy: 'card', count: 1, principal: 10_000 } as const
  assert.equal(planRounds(card, rules('before', 'before', 'after'), none)[0]!.date, '2026-11-16')
  // the pay and transfer rules do not move a card round
  assert.equal(planRounds(card, rules('before', 'after', 'none'), none)[0]!.date, '2026-11-14')
  // the card's own billing day (the 21st, a Saturday) uses the billing rule too
  assert.equal(planRounds({ ...card, billingDay: 21 }, rules('none', 'none', 'before'), none)[0]!.date, '2026-11-20')
  assert.equal(planRounds({ ...card, billingDay: 21 }, rules('after', 'after', 'none'), none)[0]!.date, '2026-11-21')
  // an installment: every round by the billing rule (2026-11-14 Sat, 2026-12-14 Mon, 2027-01-14 Thu)
  const inst = planRounds({ ...card, how: 'installment', count: 3 }, rules('none', 'none', 'before'), none)
  assert.deepEqual(inst.map((r) => r.date), ['2026-11-13', '2026-12-14', '2027-01-14'])
})

test('planRounds: the refills of a buffer use follow the pay rule', () => {
  const use = { bought: '2026-11-18', how: 'buffer', payBy: 'card', count: 3, principal: 300_000, refillFrom: '2026-11-25' } as const
  const s = (pay: DayShift, billing: DayShift): Settings => ({ ...rules(pay, 'none', billing), payDay: 26 })
  // 2026-12-26 is a Saturday, 2027-01-26 a Tuesday; the first refill is the date given
  assert.deepEqual(planRounds(use, s('before', 'none'), none).map((r) => r.date), ['2026-11-25', '2026-12-25', '2027-01-26'])
  assert.deepEqual(planRounds(use, s('after', 'before'), none).map((r) => r.date), ['2026-11-25', '2026-12-28', '2027-01-26'])
  // the billing rule does not move a refill
  assert.deepEqual(planRounds(use, s('none', 'before'), none).map((r) => r.date), ['2026-11-25', '2026-12-26', '2027-01-26'])
})

test('payDayFrom and cardBillDate take the pay rule and the billing rule', () => {
  const s = (pay: DayShift, billing: DayShift): Settings => ({ ...rules(pay, 'none', billing), payDay: 26 })
  assert.equal(payDayFrom('2026-12-01', s('after', 'before'), none), '2026-12-28')
  assert.equal(payDayFrom('2026-12-01', s('none', 'after'), none), '2026-12-26')
  assert.equal(cardBillDate('2026-10-10', { billingDay: 14 }, s('after', 'before'), none), '2026-11-13')
  assert.equal(cardBillDate('2026-10-10', { billingDay: 14 }, s('before', 'none'), none), '2026-11-14')
})

test('the transfer day\'s own rule: the month a stop starts and the window after the transfer', () => {
  // today is Sunday the 22nd, the transfer day: moved to Monday it is still to come, as set it is today
  assert.equal(nextTransferYm('2026-11-22', rules('none', 'after', 'none'), none), '2026-11')
  assert.equal(nextTransferYm('2026-11-22', rules('after', 'none', 'after'), none), '2026-12')
  const state = (settings: Settings) => ({ subscriptions: [], planChanges: [], settings })
  // December 22nd is a Tuesday: the window ends the day before it
  const moved = leftoverAfterTransfer(state(rules('none', 'after', 'none')), '2026-11', none)
  assert.deepEqual([moved.from, moved.to], ['2026-11-23', '2026-12-21'])
  const kept = leftoverAfterTransfer(state(rules('after', 'none', 'after')), '2026-11', none)
  assert.deepEqual([kept.from, kept.to], ['2026-11-22', '2026-12-21'])
})

test('spendState: a card spending without rounds waits for the bill by the billing rule', () => {
  const sp = {
    id: 's', name: 'x', category: 'home', bought: '2026-10-10', amount: 10_000, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, rounds: [],
  } as unknown as Spending
  // the bill of 2026-11-14 (Saturday) moves to Monday the 16th: on the 15th it is still to come
  assert.equal(spendState(sp, '2026-11-15', rules('none', 'none', 'after'), none), 'billing')
  assert.equal(spendState(sp, '2026-11-15', rules('after', 'after', 'none'), none), 'planned')
})

test('scheduleItemsIn: each item moves by its own rule', () => {
  const item = (id: string, day: number, shift: DayShift): ScheduleItem => ({ id, name: id, day, accountId: null, direction: 'out', shift })
  // all three on Saturday the 14th
  const got = scheduleItemsIn([item('stay', 14, 'none'), item('later', 14, 'after'), item('earlier', 14, 'before')], '2026-11', none)
  assert.deepEqual(got.map((x) => [x.item.id, x.at.date, x.at.shifted]), [['earlier', '2026-11-13', 'before'], ['stay', '2026-11-14', null], ['later', '2026-11-16', 'after']])
  // a holiday on the Monday pushes only the item that moves after
  const hol = scheduleItemsIn([item('stay', 14, 'none'), item('later', 14, 'after')], '2026-11', new Set(['2026-11-16']))
  assert.deepEqual(hol.map((x) => x.at.date), ['2026-11-14', '2026-11-17'])
})

test('needsHolidays: only when one of the four rules moves a date', () => {
  const item = (shift: DayShift) => ({ shift })
  assert.equal(needsHolidays(rules('none', 'none', 'none')), false)
  assert.equal(needsHolidays(rules('none', 'none', 'none'), [item('none'), item('none')]), false)
  assert.equal(needsHolidays({}), false)
  assert.equal(needsHolidays({}, [{}]), false)
  assert.equal(needsHolidays(rules('before', 'none', 'none')), true)
  assert.equal(needsHolidays(rules('none', 'after', 'none')), true)
  assert.equal(needsHolidays(rules('none', 'none', 'before')), true)
  assert.equal(needsHolidays(rules('none', 'none', 'none'), [item('none'), item('after')]), true)
})

// ---------- the request bodies ----------
const BODY = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 }
const row = (body: Record<string, unknown>) => settingsRow(settings.parse(body)) as Record<string, unknown>

test('a settings body with the old dayShift alone sets the three rules', () => {
  for (const r of ['none', 'before', 'after']) {
    const got = row({ ...BODY, dayShift: r })
    assert.deepEqual([got.payShift, got.transferShift, got.billingShift], [r, r, r])
    assert.equal('dayShift' in got, false, 'dayShift is no column')
  }
})

test('a rule the body names wins over dayShift, each on its own', () => {
  const one = row({ ...BODY, dayShift: 'before', payShift: 'after' })
  assert.deepEqual([one.payShift, one.transferShift, one.billingShift], ['after', 'before', 'before'])
  const all = row({ ...BODY, dayShift: 'before', payShift: 'none', transferShift: 'after', billingShift: 'none' })
  assert.deepEqual([all.payShift, all.transferShift, all.billingShift], ['none', 'after', 'none'])
})

// Review 1 finding 1: a client of 0.1.9 reads the state, changes `dayShift` and sends the whole row back — with the
// three rules it read. A rule sent back as it is saved is not a rule the body names.
test('with the saved row, a rule sent back as it is saved gives way to dayShift; a rule that differs wins', () => {
  const saved = { payShift: 'before', transferShift: 'none', billingShift: 'after' }
  const sent = (body: Record<string, unknown>) => {
    const got = settingsRow(settings.parse({ ...BODY, ...body }), saved) as Record<string, unknown>
    assert.equal('dayShift' in got, false, 'dayShift is no column')
    return [got.payShift, got.transferShift, got.billingShift]
  }
  // the whole row read back, only dayShift changed: the three rules take it
  assert.deepEqual(sent({ ...saved, dayShift: 'after' }), ['after', 'after', 'after'])
  assert.deepEqual(sent({ ...saved, dayShift: 'none' }), ['none', 'none', 'none'])
  // one rule changed with it: that one wins, the two sent back as saved take dayShift
  assert.deepEqual(sent({ ...saved, payShift: 'none', dayShift: 'after' }), ['none', 'after', 'after'])
  // all three differ from the saved ones: all three win
  assert.deepEqual(sent({ payShift: 'none', transferShift: 'after', billingShift: 'before', dayShift: 'before' }), ['none', 'after', 'before'])
  // dayShift alone, and the new keys alone, are as without a saved row
  assert.deepEqual(sent({ dayShift: 'before' }), ['before', 'before', 'before'])
  assert.deepEqual(sent({ ...saved }), ['before', 'none', 'after'])
  assert.deepEqual(sent({ transferShift: 'after' }), [undefined, 'after', undefined])
  assert.deepEqual(sent({}), [undefined, undefined, undefined])
  // no saved row yet (a first save): a named rule wins, as before
  const first = settingsRow(settings.parse({ ...BODY, dayShift: 'before', payShift: 'none' }), null) as Record<string, unknown>
  assert.deepEqual([first.payShift, first.transferShift, first.billingShift], ['none', 'before', 'before'])
})

test('without dayShift a rule left out is not in the row, so the saved value stays', () => {
  const plain = row(BODY)
  assert.equal('payShift' in plain || 'transferShift' in plain || 'billingShift' in plain || 'dayShift' in plain, false)
  const one = row({ ...BODY, transferShift: 'after' })
  assert.equal(one.transferShift, 'after')
  assert.equal('payShift' in one || 'billingShift' in one, false)
  // everything else of the body is the row as it was
  assert.deepEqual(plain, BODY)
})

test('a rule is one of the three values; a schedule item takes its own or none at all', () => {
  for (const k of ['payShift', 'transferShift', 'billingShift', 'dayShift']) {
    assert.equal(settings.safeParse({ ...BODY, [k]: 'sideways' }).success, false, k)
    assert.equal(settings.safeParse({ ...BODY, [k]: null }).success, false, k)
    for (const r of ['none', 'before', 'after']) assert.equal(settings.safeParse({ ...BODY, [k]: r }).success, true, `${k} ${r}`)
  }
  const item = { name: 'Rent', day: 10, accountId: null, direction: 'out' }
  const old = scheduleItem.parse(item) as Record<string, unknown>
  assert.equal('shift' in old, false, 'a body in the 0.1.9 shape is taken, without a shift')
  assert.equal(scheduleItem.parse({ ...item, shift: 'before' }).shift, 'before')
  assert.equal(scheduleItem.safeParse({ ...item, shift: 'sideways' }).success, false)
})
