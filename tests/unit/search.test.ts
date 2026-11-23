// spec 013 S-19: the header search and the MCP `search` tool find rows by any part of their name or memo.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fold, foldQuery, markParts, search, SEARCH_KINDS, type SearchState } from '../../src/lib/search'
import type { Spending, Subscription } from '../../src/data/types'

const sub = (id: string, name: string, note?: string): Subscription =>
  ({ id, name, note, category: 'tool', plan: 'basic', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-11-20', path: 'direct', verified: false })
const spend = (id: string, name: string, how: Spending['how'], note?: string): Spending =>
  ({ id, name, note, category: 'home', bought: '2026-11-01', amount: 1000, currency: 'KRW', fxRate: null, fxBuffer: null, how, payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, rounds: [] })

const st: SearchState = {
  subscriptions: [sub('s1', 'Cloud Storage', 'family plan'), sub('s2', '실손 보험', '갱신 확인'), sub('s3', 'Music')],
  spendings: [spend('p1', 'E2E Laptop', 'installment', 'cloud backup'), spend('p2', 'E2E Desk', 'lump')],
  livingItems: [{ id: 'l1', name: '식비', kind: 'food', payMethod: 'card', amount: 1, from: null, code: 'food', amounts: {}, note: '보험 아님' }],
  accounts: [
    { id: 'a1', name: 'E2E Savings', role: '', inflow: '', outflow: '', group: 'saving' },
    { id: 'a2', name: 'E2E Invest', role: '', inflow: '', outflow: '', group: 'invest' },
    { id: 'a3', name: 'Pay account', role: '', inflow: '', outflow: '', note: 'CLOUD fees' },
  ],
  cards: [{ id: 'c1', name: 'E2E Card', last4: '1234', accountId: null, billingDay: null }],
  targets: [{ id: 't1', name: 'Emergency', kind: 'fixed', note: 'cloud' }],
  events: [{ id: 'e1', when: '2026-12', kind: '세금', title: '보험료 정산', state: 'todo' }],
  checks: [{ id: 'k1', text: 'Check the cloud bill', done: false }],
}

test('name and memo, any part, case-insensitive; grouped by kind in order, name matches first', () => {
  const r = search(st, 'CLOUD')
  assert.deepEqual(r.map((h) => [h.kind, h.id, h.field]), [
    ['subscription', 's1', 'name'],
    ['spending', 'p1', 'note'],
    ['account', 'a3', 'note'],
    ['target', 't1', 'note'],
    ['check', 'k1', 'name'],
  ])
  assert.deepEqual(SEARCH_KINDS, ['subscription', 'spending', 'livingItem', 'account', 'card', 'target', 'event', 'check'])
})

test('Korean as typed, in names and memos, also when the query is decomposed (NFD)', () => {
  assert.deepEqual(search(st, '보험').map((h) => [h.kind, h.id, h.field]), [['subscription', 's2', 'name'], ['livingItem', 'l1', 'note'], ['event', 'e1', 'name']])
  assert.deepEqual(search(st, '보험'.normalize('NFD')).map((h) => h.id), ['s2', 'l1', 'e1'])
  assert.deepEqual(search(st, '갱신').map((h) => [h.id, h.field, h.at]), [['s2', 'note', 0]])
})

test('in a kind: a match at the start before one inside, then the list order', () => {
  const s: SearchState = { ...st, subscriptions: [sub('x1', 'Big Plan'), sub('x2', 'Plan B'), sub('x3', 'Another plan'), sub('x4', 'Plan C')] }
  assert.deepEqual(search(s, 'plan', ['subscription']).map((h) => h.id), ['x2', 'x4', 'x1', 'x3'])
})

test('the page of each kind', () => {
  const page = (q: string) => search(st, q).map((h) => [h.id, h.path])
  assert.deepEqual(page('E2E'), [['p1', '/spend/inst'], ['p2', '/spend/general'], ['a1', '/saving'], ['a2', '/invest'], ['c1', '/pay']])
  assert.deepEqual(page('Music'), [['s3', '/spend/subs']])
  assert.deepEqual(page('식비'), [['l1', '/living']])
  assert.deepEqual(page('Pay acc'), [['a3', '/pay']])
  assert.deepEqual(page('Emergency'), [['t1', '/pay']])
  assert.deepEqual(page('정산'), [['e1', '/events']])
  assert.deepEqual(page('bill'), [['k1', '/']])
})

test('only the kinds asked for; an empty or blank query finds nothing; inner spaces count as one', () => {
  assert.deepEqual(search(st, 'cloud', ['check', 'subscription']).map((h) => h.kind), ['subscription', 'check'])
  assert.deepEqual(search(st, ''), [])
  assert.deepEqual(search(st, '   '), [])
  assert.deepEqual(search(st, 'cloud    storage').map((h) => h.id), ['s1'])
  // lists the state may not have yet
  assert.deepEqual(search({ subscriptions: [], accounts: [], targets: [], events: [], checks: [] }, 'x'), [])
})

test('fold, foldQuery and the highlight parts', () => {
  assert.equal(fold('ABC 보험'), 'abc 보험')
  assert.equal(foldQuery('  Cloud   Storage '), 'cloud storage')
  assert.deepEqual(markParts('Cloud Storage', 'stor'), [{ text: 'Cloud ', hit: false }, { text: 'Stor', hit: true }, { text: 'age', hit: false }])
  assert.deepEqual(markParts('실손 보험', '보험'), [{ text: '실손 ', hit: false }, { text: '보험', hit: true }])
  assert.deepEqual(markParts('Cloud', 'x'), [{ text: 'Cloud', hit: false }])
  // a text not in NFC cannot be placed: unmarked
  const nfd = '보험'.normalize('NFD')
  assert.deepEqual(markParts(nfd, '보험'), [{ text: nfd, hit: false }])
})
