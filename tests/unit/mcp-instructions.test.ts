// spec 015 S-15: the server instructions put the essentials in the first 512 characters (ChatGPT reads those),
// for each permission: what the connection may do, that a proposal changes nothing until confirmed, the time zone,
// and which tools to start with. A key and an OAuth app with the same permission get the same text.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { instructionsFor } from '../../server/mcp/instructions'

const cases = [
  ['read', null, /read-only/],
  ['screen', { id: 'k', name: 'n', confirm: 'ui' as const }, /Pending changes/],
  ['chat', { id: 'k', name: 'n', confirm: 'chat' as const }, /apply_proposal only after they agree/],
] as const

test('the first 512 characters hold the essentials, for each permission', () => {
  for (const [label, key, access] of cases) {
    const head = instructionsFor(key).slice(0, 512)
    assert.match(head, access, label)
    assert.match(head, /never changes anything until the user confirms/, label)
    assert.match(head, /time zone/, label)
    assert.match(head, /get_overview/, label)
  }
})

test('an OAuth app gets the same instructions as a key with the same permission', () => {
  assert.equal(instructionsFor({ id: 'c', name: 'App', confirm: 'chat', source: 'oauth' }), instructionsFor({ id: 'k', name: 'Key', confirm: 'chat' }))
})
