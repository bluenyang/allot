// spec 013 S-20: the bell's notifications, computed from the state with the calc functions the pages use.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bufferGauge, monthMoney, yearContribution, type AccountState } from '../../src/lib/calc'
import { buildNotices, keptMarks, unreadCount, type Notice } from '../../src/lib/notices'
import type { Account, Spending, SpendingRound, Subscription } from '../../src/data/types'

const none: ReadonlySet<string> = new Set()
const sub = (id: string, nextDate: string, over: Partial<Subscription> = {}): Subscription =>
  ({ id, name: `E2E-${id}`, category: 'tool', plan: 'basic', amount: 10_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate, path: 'direct', verified: false, ...over })
const acc = (id: string, over: Partial<Account> = {}): Account => ({ id, name: `E2E-${id}`, role: '', inflow: '', outflow: '', ...over })
const round = (no: number, date: string, amount: number, state: SpendingRound['state'] = 'left'): SpendingRound => ({ no, date, amount, state, edited: false })
const spend = (id: string, over: Partial<Spending>): Spending => ({
  id, name: `E2E-${id}`, category: 'home', bought: '2026-11-01', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'installment', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false, rounds: [], ...over,
})

const base: AccountState = {
  settings: { netPay: 3_000_000, fxRate: 1400, fxBuffer: 5, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000, dayShift: 'none' },
  living: { food: 0, transit: 0, allowance: 0 },
  livingItems: [],
  targets: [{ id: 't-fix', name: 'Fixed', kind: 'fixed' }, { id: 't-rest', name: 'Rest', kind: 'remainder' }],
  phases: [{ id: 'p1', label: 'P1', name: 'one', from: '2026-01', to: null, amounts: { 't-fix': 1_000_000 } }],
  subscriptions: [sub('s-in', '2026-11-23'), sub('s-today', '2026-11-20'), sub('s-out', '2026-11-25'), sub('s-off', '2026-11-21', { status: 'cancelled' })],
  planChanges: [],
  spendings: [
    spend('inst', { rounds: [round(1, '2026-11-14', 100_000, 'paid'), round(2, '2026-11-22', 100_000), round(3, '2026-12-14', 100_000)] }),
    spend('gone', { cancelled: true, rounds: [round(1, '2026-11-21', 100_000)] }),
    spend('lump', { how: 'lump', count: 1, rounds: [round(1, '2026-11-20', 50_000)] }),
    spend('merged', { rounds: [round(1, '2026-11-21', 1, 'merged')] }),
  ],
  accounts: [acc('pay')],
  balances: [],
  cards: [],
}
const TODAY = '2026-11-20'
const pending = { proposals: 0, goalAccounts: [] as string[] }

test('charges and rounds from today to three days on, by date; cancelled, merged and paid ones are not', () => {
  const n = buildNotices(base, TODAY, none, pending)
  assert.deepEqual(n.map((x) => x.id), ['charge:s-today:2026-11-20', 'round:lump:1:2026-11-20', 'round:inst:2:2026-11-22', 'charge:s-in:2026-11-23'])
  const c = n[0] as Extract<Notice, { kind: 'charge' }>
  assert.deepEqual([c.group, c.path, c.dday, c.amount, c.name], ['pay', '/spend/subs', 0, 10_000, 'E2E-s-today'])
  const r = n[2] as Extract<Notice, { kind: 'round' }>
  assert.deepEqual([r.path, r.dday, r.round, r.of, r.amount, r.how, r.payBy], ['/spend/inst', 2, 2, 3, 100_000, 'installment', 'card'])
  assert.equal((n[1] as Extract<Notice, { kind: 'round' }>).path, '/spend/general')
  // a wider window takes the charge of the 25th too
  assert.ok(buildNotices(base, TODAY, none, pending, 5).some((x) => x.id === 'charge:s-out:2026-11-25'))
})

test('pending: AI proposals and goal cards first, with ids that change when what waits changes', () => {
  const n = buildNotices(base, TODAY, none, { proposals: 3, goalAccounts: ['b', 'a'] })
  assert.deepEqual(n.slice(0, 2).map((x) => [x.kind, x.id, x.group, x.path]), [['proposals', 'proposals:3', 'pending', '/pending'], ['goals', 'goals:a,b', 'pending', '/pending']])
  assert.equal((n[1] as Extract<Notice, { kind: 'goals' }>).count, 2)
  assert.equal(buildNotices(base, TODAY, none, pending).filter((x) => x.group === 'pending').length, 0)
})

test('this month\'s remainder short, as monthMoney works it out', () => {
  const short: AccountState = { ...base, phases: [{ ...base.phases[0]!, amounts: { 't-fix': 3_200_000 } }] }
  assert.ok(monthMoney(short, '2026-11').dist.remainder < 0)
  const n = buildNotices(short, TODAY, none, pending).filter((x) => x.group === 'budget')
  assert.deepEqual(n.map((x) => [x.kind, x.id, x.path]), [['remainderShort', 'remainder:2026-11', '/pay']])
  assert.equal((n[0] as Extract<Notice, { kind: 'remainderShort' }>).remainder, monthMoney(short, '2026-11').dist.remainder)
  assert.equal(buildNotices(base, TODAY, none, pending).filter((x) => x.group === 'budget').length, 0)
})

test('a yearly limit used 90% or more, and over it, by yearContribution', () => {
  const lim = (annualLimit: number | null): AccountState => ({
    ...base,
    accounts: [acc('isa', { group: 'invest', annualLimit })],
    balances: [{ id: 'b1', accountId: 'isa', date: '2026-02-01', amount: 9_000_000, deposit: 9_000_000 }],
  })
  const st = lim(10_000_000)
  assert.equal(yearContribution(st.accounts[0]!, st, none, 2026), 9_000_000)
  const near = buildNotices(st, TODAY, none, pending).find((x) => x.kind === 'yearLimit') as Extract<Notice, { kind: 'yearLimit' }>
  assert.deepEqual([near.id, near.contribution, near.limit, near.over, near.path, near.year], ['limit:isa:2026:near', 9_000_000, 10_000_000, false, '/invest', 2026])
  const over = buildNotices(lim(8_000_000), TODAY, none, pending).find((x) => x.kind === 'yearLimit') as Extract<Notice, { kind: 'yearLimit' }>
  assert.deepEqual([over.id, over.over], ['limit:isa:2026:over', true])
  assert.equal(buildNotices(lim(10_000_001 * 1.2), TODAY, none, pending).some((x) => x.kind === 'yearLimit'), false, 'under 90%')
  assert.equal(buildNotices(lim(null), TODAY, none, pending).some((x) => x.kind === 'yearLimit'), false, 'no limit')
})

test('a buffer short: buffer uses through its cards took more than it holds', () => {
  const use = spend('buf', { how: 'buffer', count: 2, cardId: 'c1', refillFrom: '2026-12-25', rounds: [round(1, '2026-12-25', 300_000), round(2, '2027-01-25', 300_000)] })
  const st = (buffer: number): AccountState => ({ ...base, accounts: [acc('liv', { buffer })], cards: [{ id: 'c1', name: 'E2E-Card', last4: '', accountId: 'liv', billingDay: null }], spendings: [use] })
  const short = st(500_000)
  assert.deepEqual(bufferGauge(short.accounts[0]!, short, TODAY), { buffer: 500_000, used: 600_000, left: -100_000 })
  const n = buildNotices(short, TODAY, none, pending).filter((x) => x.kind === 'bufferShort') as Extract<Notice, { kind: 'bufferShort' }>[]
  assert.deepEqual(n.map((x) => [x.id, x.buffer, x.used, x.left, x.path]), [['buffer:liv', 500_000, 600_000, -100_000, '/pay']])
  assert.equal(buildNotices(st(600_000), TODAY, none, pending).some((x) => x.kind === 'bufferShort'), false, 'exactly enough is not short')
})

test('read marks: the unread count, and only the marks of listed notices are kept', () => {
  const n = buildNotices(base, TODAY, none, { proposals: 1, goalAccounts: [] })
  assert.equal(unreadCount(n, new Set()), n.length)
  const read = new Set(['proposals:1', 'charge:s-today:2026-11-20', 'charge:gone:2026-10-01'])
  assert.equal(unreadCount(n, read), n.length - 2)
  assert.deepEqual(keptMarks(n, read), ['proposals:1', 'charge:s-today:2026-11-20'])
})
