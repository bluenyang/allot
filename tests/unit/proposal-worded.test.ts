// review rc3-1 F-5: a proposal row's values are worded with its table — a currency's buffer is a percent, an
// account's buffer an amount. Synthetic; no browser, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { worded } from '../../src/lib/proposals'
import { store } from '../../src/lib/store'
import type { Account, Card } from '../../src/data/types'

test('buffer: a percent on foreign_currency, money elsewhere', () => {
  assert.equal(worded('buffer', 2, { code: 'EUR', rate: 1500, buffer: 2 }, 'foreign_currency'), '2%')
  assert.equal(worded('buffer', 2.5, null, 'foreign_currency'), '2.5%')
  assert.equal(worded('buffer', null, null, 'foreign_currency'), '—')
  const krw = worded('buffer', 2, null, 'bank_account')
  assert.notEqual(krw, '2%')
  assert.equal(krw, worded('buffer', 2)) // no table: as before
  // a currency's other fields read as before
  assert.equal(worded('rate', 1500, null, 'foreign_currency'), '1500')
})

// spec 018 S-8 (W-7): a row's card and account read by name, in a proposal's preview as in the history
test('cardId, accountId and the settings\' monthBasisCardId read as the card\'s or the account\'s name', () => {
  const [cards, accounts] = [store.cards, store.accounts]
  try {
    store.cards = [{ id: 'c1', name: 'Blue card', last4: '', accountId: 'a1', billingDay: null } as Card]
    store.accounts = [{ id: 'a1', name: 'Bills account', role: '', inflow: '', outflow: '' } as Account]
    for (const table of ['subscription', 'spending', undefined]) {
      assert.equal(worded('cardId', 'c1', null, table), 'Blue card')
      assert.equal(worded('cardId', null, null, table), '—')
    }
    for (const table of ['subscription', 'card', 'allocation_target', 'schedule_item', 'income_item', 'account_balance']) {
      assert.equal(worded('accountId', 'a1', null, table), 'Bills account', table)
      assert.equal(worded('accountId', null, null, table), '—', table)
    }
    assert.equal(worded('monthBasisCardId', 'c1', null, 'settings'), 'Blue card')
    assert.equal(worded('monthBasisCardId', null, null, 'settings'), '—')
    // one that is gone (or another list's id) reads as stored
    assert.equal(worded('cardId', 'gone', null, 'subscription'), 'gone')
    assert.equal(worded('accountId', 'c1', null, 'subscription'), 'c1')
  } finally {
    store.cards = cards
    store.accounts = accounts
  }
})
