// spec 016 S-2: this browser's old marks go to the account in requests of at most 500 marks (server/validation.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_PER_REQUEST, uploadChunks } from '../../src/lib/notice-marks'

test('nothing to send makes no request', () => {
  assert.deepEqual(uploadChunks([], []), [])
})

test('read marks and kept maturities go in requests of at most 500, in order', () => {
  const read = Array.from({ length: 1201 }, (_, i) => `charge:s${i}:2026-11-30`)
  const kept = ['a1@2026-11', 'a2@2026-10']
  const chunks = uploadChunks(read, kept)
  assert.equal(MAX_PER_REQUEST, 500)
  assert.deepEqual(chunks.map((c) => c.read?.add?.length ?? c.maturityKept?.add?.length), [500, 500, 201, 2])
  assert.deepEqual(chunks.flatMap((c) => c.read?.add ?? []), read)
  assert.deepEqual(chunks.at(-1), { maturityKept: { add: kept } })
})
