// review rc3-1 F-6: the "나" chip of 변경 내역 counts and lists the user's own sets only; the server's refresh sets
// (actor `system`) are under 전체 only. Synthetic.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byActor } from '../../src/lib/history-actor'

const sets = [
  { id: 'u1', actorKind: 'user' },
  { id: 's1', actorKind: 'system' },
  { id: 'k1', actorKind: 'api_key' },
  { id: 'u2', actorKind: 'user' },
]

test('each chip lists what it counts', () => {
  assert.deepEqual(byActor(sets, 'all').map((s) => s.id), ['u1', 's1', 'k1', 'u2'])
  assert.deepEqual(byActor(sets, 'me').map((s) => s.id), ['u1', 'u2'])
  assert.deepEqual(byActor(sets, 'ai').map((s) => s.id), ['k1'])
  assert.deepEqual(byActor([], 'me'), [])
})
