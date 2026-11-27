// spec 018 S-7 (W-6, V-4): everything that lists charges shows the plan in force on each charge's date — the notices,
// the calendar, the MCP schedule and overview, and the window after the subscription transfer. No database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlanChange, Settings, Subscription } from '../../src/data/types'
import { leftoverAfterTransfer, type AccountState } from '../../src/lib/calc'
import { buildNotices, type Notice } from '../../src/lib/notices'
import { calendarEvents } from '../../src/lib/calendar-events'
import { store } from '../../src/lib/store'
import { overview, schedule, type Data } from '../../server/mcp/views'

const settings: Settings = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000, payShift: 'none', transferShift: 'none', billingShift: 'none' }
const sub = (id: string, over: Partial<Subscription> = {}): Subscription =>
  ({ id, name: `Sub ${id}`, category: 'tool', plan: 'Basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-11-27', path: 'direct', verified: false, ...over })
// Both are charged on the 27th. On 11/30 one moves to a dearer plan and the other is cancelled: the charges of 11/27 are
// the old plan's and both are still made; from December only the first is charged, at the new amount.
const subscriptions = [sub('up'), sub('end', { amount: 5_000 })]
const planChanges: PlanChange[] = [
  { id: 'c-up', subId: 'up', effective: '2026-11-30', to: { plan: 'Pro', amount: 30_000 }, note: '' },
  { id: 'c-end', subId: 'end', effective: '2026-11-30', to: { status: 'cancelled' }, note: '' },
]

test('notices: the charge amounts are the plans of the charge date', () => {
  const st: AccountState = {
    settings, living: { food: 0, transit: 0, allowance: 0 }, livingItems: [], targets: [{ id: 't-rest', name: 'Rest', kind: 'remainder' }], phases: [],
    subscriptions, planChanges, spendings: [], accounts: [], balances: [], cards: [],
  }
  const charges = (today: string) => buildNotices(st, today, new Set(), { proposals: 0, goalAccounts: [] })
    .filter((n): n is Extract<Notice, { kind: 'charge' }> => n.kind === 'charge').map((n) => [n.id, n.amount])
  assert.deepEqual(charges('2026-11-25'), [['charge:up:2026-11-27', 10_000], ['charge:end:2026-11-27', 5_000]])
  assert.deepEqual(charges('2026-12-25'), [['charge:up:2026-12-27', 30_000]])
})

test('calendar: the subscription events of a month carry the charge date\'s amount, and a cancelled plan has none after its date', () => {
  Object.assign(store.settings, settings)
  store.subscriptions = subscriptions
  store.planChanges = planChanges
  const subs = (from: string, to: string) => calendarEvents(from, to).filter((e) => e.kind === 'sub').map((e) => [e.date, e.name, e.krw])
  assert.deepEqual(subs('2026-11-01', '2026-12-01'), [['2026-11-27', 'Sub up', 10_000], ['2026-11-27', 'Sub end', 5_000]])
  assert.deepEqual(subs('2026-12-01', '2027-01-01'), [['2026-12-27', 'Sub up', 30_000]])
  store.subscriptions = []
  store.planChanges = []
})

test('MCP get_schedule and get_overview: the charges of a month name the plan and the amount of their date', () => {
  const d: Data = {
    settings, living: { food: 0, transit: 0, allowance: 0 }, targets: [{ id: 't-subs', name: 'Subscription account', kind: 'subscriptions' }, { id: 't-rest', name: 'Rest', kind: 'remainder' }],
    subscriptions, planChanges, phases: [], events: [], checks: [], accounts: [], debts: [], remainderSplit: [], holidaySets: [],
  }
  const months = schedule(d, '2026-11', 2).months
  const pays = (m: (typeof months)[number]) => m.payments.map((p) => [p.date, p.subscriptionId, p.plan, p.amountKrw])
  assert.deepEqual(pays(months[0]!), [['2026-11-27', 'up', 'Basic', 10_000], ['2026-11-27', 'end', 'Basic', 5_000]])
  assert.deepEqual(pays(months[1]!), [['2026-12-27', 'up', 'Pro', 30_000]])
  // the change is listed in the month of its date, as before
  assert.deepEqual(months[0]!.planChanges.map((c) => c.id), ['c-up', 'c-end'])
  const o = overview(d, '2026-11')
  assert.deepEqual(o.payments.map((p) => [p.date, p.subscriptionId, p.plan, p.amountKrw]), [['2026-11-27', 'up', 'Basic', 10_000], ['2026-11-27', 'end', 'Basic', 5_000]])
  // the month's transfer stays by month: November already counts the new plan and leaves the cancelled one out
  assert.deepEqual(o.subscriptionTransfer.items.map((i) => [i.subscriptionId, i.monthlyKrw]), [['up', 30_000]])
  assert.equal(o.subscriptionTransfer.transferKrw, 30_000)
})

test('the window after the transfer: what is paid in it is each charge at its date\'s plan; the transfer stays the month\'s', () => {
  // transfer day 26: November's window is 11/26 … 12/25 and holds the two charges of 11/27
  const nov = leftoverAfterTransfer({ subscriptions, planChanges, settings }, '2026-11')
  assert.deepEqual([nov.from, nov.to, nov.count, nov.paid, nov.transfer, nov.left], ['2026-11-26', '2026-12-25', 2, 15_000, 30_000, 15_000])
  // December's window (12/26 … 1/25) holds the charge of 12/27 at the new amount
  const dec = leftoverAfterTransfer({ subscriptions, planChanges, settings }, '2026-12')
  assert.deepEqual([dec.count, dec.paid, dec.transfer, dec.left], [1, 30_000, 30_000, 0])
})
