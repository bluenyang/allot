// spec 010 A-14: the session guard behind every store write after an await, no database.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionGuard } from '../../src/lib/session-guard'

test('work in the current session writes; work that started before a session change is dropped', () => {
  const g = createSessionGuard()
  const written: string[] = []
  const a = g.begin()
  assert.equal(a.alive(), true)
  assert.equal(a.ifCurrent(() => { written.push('a1'); return 1 }), 1)
  g.next()
  assert.equal(a.alive(), false)
  assert.equal(a.ifCurrent(() => { written.push('a2'); return 2 }), undefined)
  const b = g.begin()
  assert.equal(b.ifCurrent(() => { written.push('b1'); return 3 }), 3)
  assert.deepEqual(written, ['a1', 'b1'])
})

test('a scope stays dead after any number of later changes, and scopes are independent', () => {
  const g = createSessionGuard()
  const a = g.begin()
  g.next()
  const b = g.begin()
  g.next()
  g.next()
  assert.equal(a.alive(), false)
  assert.equal(b.alive(), false)
  assert.equal(g.begin().alive(), true)
})

test('a simulated save: the answer of the old session never lands, the new session is untouched', async () => {
  const g = createSessionGuard()
  const store = { settings: 'A-before' }
  let release!: () => void
  const slow = new Promise<void>((r) => { release = r })
  const s = g.begin()
  const save = (async () => { await slow; s.ifCurrent(() => { store.settings = 'A-saved' }) })()
  g.next()
  store.settings = 'B-loaded'
  release()
  await save
  assert.equal(store.settings, 'B-loaded')
})
