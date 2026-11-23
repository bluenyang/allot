// spec 013 W-5: the accounts table helpers of 월급 분배 (this month's money in, unlinked targets), no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { accountMonthIn, bankLine, targetsOf, unlinkedTargets } from '../../src/lib/accounts'
import type { AccountState } from '../../src/lib/calc'
import type { Account, AllocationTarget, Phase, Settings, Spending } from '../../src/data/types'

const S: Settings = { netPay: 3_000_000, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 16, subRound: 10_000, dayShift: 'none', savingSplit: 'amount' }
const P: Phase = { id: 'p1', label: '', name: 'one', from: '2026-01', to: null, amounts: { tf: 200_000, tg: 50_000 } }
const acc = (id: string, over: Partial<Account> = {}): Account =>
  ({ id, name: `E2E-${id}`, role: '', inflow: '', outflow: '', buffer: 0, goal: null, annualLimit: null, group: null, amount: 0, ratio: null, from: null, stopFrom: null, goalAck: null, amounts: {}, ...over })
const T: AllocationTarget[] = [
  { id: 'tl', name: 'Living', kind: 'living', accountId: 'life' },
  { id: 'tf', name: 'Fixed', kind: 'fixed', accountId: 'life' },
  { id: 'tg', name: 'Gone', kind: 'fixed', accountId: 'nowhere' },
  { id: 'tu', name: 'Subs', kind: 'subscriptions' },
  { id: 'ts', name: 'Save', kind: 'saving' },
  { id: 'tr', name: 'Rest', kind: 'remainder' },
]
const buffer = (over: Partial<Spending> = {}): Spending => ({
  id: 'sp', name: 'E2E-buy', category: '', bought: '2026-05-10', amount: 300_000, currency: 'KRW', fxRate: null, fxBuffer: null, how: 'buffer', payBy: 'card', count: 3, fee: 0,
  interval: null, cancelled: false, cardId: 'c1', refillFrom: '2026-06-25',
  rounds: [
    { no: 1, date: '2026-06-25', amount: 100_000, state: 'left', edited: false },
    { no: 2, date: '2026-07-25', amount: 100_000, state: 'left', edited: false },
    { no: 3, date: '2026-08-25', amount: 100_000, state: 'left', edited: false },
  ],
  ...over,
})
const state = (over: Partial<AccountState> = {}): AccountState => ({
  settings: S, phases: [P], targets: T, living: { food: 0, transit: 0, allowance: 0 },
  livingItems: [{ id: 'li', name: 'E2E-food', kind: '', payMethod: '', amount: 400_000, from: null, code: null, amounts: {} }],
  subscriptions: [], planChanges: [], spendings: [], accounts: [acc('life'), acc('sv', { group: 'saving', amount: 120_000 })], balances: [], cards: [], ...over,
})

test('this month into an account: its linked targets, a Savings item its item amount', () => {
  const st = state()
  // living 400,000 + fixed 200,000
  assert.equal(accountMonthIn(st.accounts[0]!, st, '2026-06'), 600_000)
  assert.equal(accountMonthIn(st.accounts[1]!, st, '2026-06'), 120_000)
  // an item that starts later sends nothing yet
  const later = state({ accounts: [acc('life'), acc('sv', { group: 'saving', amount: 120_000, from: '2026-07' })] })
  assert.equal(accountMonthIn(later.accounts[1]!, later, '2026-06'), 0)
})

test('this month into an account: the buffer refills of the month through its cards (S-8)', () => {
  const st = state({ cards: [{ id: 'c1', name: 'E2E-card', last4: '', accountId: 'life', billingDay: null }], spendings: [buffer()] })
  assert.equal(accountMonthIn(st.accounts[0]!, st, '2026-07'), 700_000)
  assert.equal(accountMonthIn(st.accounts[0]!, st, '2026-09'), 600_000)
  // a cancelled buffer use refills only what was paid already; a merged round is not a refill
  const cancelled = buffer({ cancelled: true, rounds: [{ no: 1, date: '2026-07-25', amount: 100_000, state: 'paid', edited: false }, { no: 2, date: '2026-07-26', amount: 100_000, state: 'left', edited: false }, { no: 3, date: '2026-07-27', amount: 5, state: 'merged', edited: false }] })
  const st2 = state({ cards: st.cards, spendings: [cancelled] })
  assert.equal(accountMonthIn(st2.accounts[0]!, st2, '2026-07'), 700_000)
  // a card of another account does not count
  const other = state({ cards: [{ id: 'c1', name: 'E2E-card', last4: '', accountId: 'sv', billingDay: null }], spendings: [buffer()] })
  assert.equal(accountMonthIn(other.accounts[0]!, other, '2026-07'), 600_000)
  assert.equal(accountMonthIn(other.accounts[1]!, other, '2026-07'), 220_000)
})

test('unlinked targets: not the remainder or the Savings / Investment totals; a link to a gone account counts as none', () => {
  const st = state()
  assert.deepEqual(unlinkedTargets(T, st.accounts).map((x) => x.id), ['tg', 'tu'])
  assert.deepEqual(targetsOf(T, 'life').map((x) => x.id), ['tl', 'tf'])
})

test('the bank line under an account name', () => {
  assert.equal(bankLine({ bank: 'E2E Bank', last4: '0123' }), 'E2E Bank …0123')
  assert.equal(bankLine({ bank: '', last4: '0123' }), '…0123')
  assert.equal(bankLine({ bank: 'E2E Bank', last4: '' }), 'E2E Bank')
  assert.equal(bankLine({}), '')
})
