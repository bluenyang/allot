// spec 018 S-8, S-9, S-12 (W-7, V-4): how a subscription is paid — a card, an account, or neither — and its charges in
// the balance projection. Synthetic data, no database.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { subscription as subBody } from '../../server/validation'
import { issueMessage } from '../../server/messages'

// ── the request body (S-12) ──
const OLD = { name: 'Stream', category: 'content', plan: 'Basic', amount: 9900, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2026-12-05', path: 'direct', verified: false }

test('subscription body: the 0.1.9 shape passes and names no way of paying, so the saved one stays', () => {
  const parsed = subBody.safeParse(OLD)
  assert.equal(parsed.success, true)
  // a key the body leaves out is not in the parsed row: the update writes no value for it
  assert.equal('cardId' in parsed.data!, false)
  assert.equal('accountId' in parsed.data!, false)
})

test('subscription body: a card, an account, null for either or both; never both set', () => {
  for (const pay of [{ cardId: 'c1' }, { accountId: 'a1' }, { cardId: null }, { accountId: null }, { cardId: null, accountId: null }, { cardId: 'c1', accountId: null }, { cardId: null, accountId: 'a1' }]) {
    const r = subBody.safeParse({ ...OLD, ...pay })
    assert.equal(r.success, true, JSON.stringify(pay))
    assert.deepEqual({ cardId: r.data!.cardId, accountId: r.data!.accountId }, { cardId: undefined, accountId: undefined, ...pay }, JSON.stringify(pay))
  }
  const both = subBody.safeParse({ ...OLD, cardId: 'c1', accountId: 'a1' })
  assert.equal(both.success, false)
  assert.equal(both.error!.issues[0]!.message, 'payOneOf')
  assert.equal(issueMessage('ko', both.error!.issues[0]), '구독의 결제 수단은 카드와 계좌 중 하나만 고를 수 있어요.')
  assert.equal(issueMessage('en', both.error!.issues[0]), 'A subscription is paid with a card or from an account, not both.')
  // an id is a text of at least one character, like a spending's card
  for (const bad of ['', 12, true, {}]) {
    assert.equal(subBody.safeParse({ ...OLD, cardId: bad }).success, false, `cardId ${JSON.stringify(bad)}`)
    assert.equal(subBody.safeParse({ ...OLD, accountId: bad }).success, false, `accountId ${JSON.stringify(bad)}`)
  }
})
