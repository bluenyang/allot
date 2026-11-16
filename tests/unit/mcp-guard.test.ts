import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hostAndOriginOk } from '../../server/mcp/guard'
import { FailureLimiter } from '../../server/mcp/limiter'

test('failure limiter: 20 failures block the address until the oldest ages out', () => {
  const l = new FailureLimiter(20, 600_000)
  const t0 = 1_000_000
  for (let i = 0; i < 19; i++) l.fail('1.2.3.4', t0 + i)
  assert.equal(l.blockedFor('1.2.3.4', t0 + 100), 0)
  l.fail('1.2.3.4', t0 + 19)
  assert.ok(l.blockedFor('1.2.3.4', t0 + 100) > 0)
  assert.equal(l.blockedFor('5.6.7.8', t0 + 100), 0, 'another address is not blocked')
  // the oldest failure leaves the window: 19 remain, so the address is free again
  assert.equal(l.blockedFor('1.2.3.4', t0 + 600_000 + 1), 0)
})

test('failure limiter: bounded memory forgets the least recently failing address', () => {
  const l = new FailureLimiter(1, 600_000, 3)
  for (const ip of ['a', 'b', 'c', 'd']) l.fail(ip, 1000)
  assert.equal(l.blockedFor('a', 1001), 0, 'a was forgotten')
  assert.ok(l.blockedFor('d', 1001) > 0)
})

test('host and origin: development accepts the address the request was sent to', () => {
  assert.equal(hostAndOriginOk('192.168.0.10:15173', undefined, {}), true)
  assert.equal(hostAndOriginOk('192.168.0.10:15173', 'http://192.168.0.10:15173', {}), true)
  assert.equal(hostAndOriginOk('192.168.0.10:15173', 'https://evil.example', {}), false)
  assert.equal(hostAndOriginOk('192.168.0.10:15173', 'not a url', {}), false)
})

test('host and origin: production accepts only the listed addresses', () => {
  const o = { trustedOrigins: ['https://allot.example.com'], publicUrl: 'https://allot.example.com' }
  assert.equal(hostAndOriginOk('allot.example.com', undefined, o), true)
  assert.equal(hostAndOriginOk('allot.example.com', 'https://allot.example.com', o), true)
  assert.equal(hostAndOriginOk('allot.example.com', 'https://evil.example', o), false)
  assert.equal(hostAndOriginOk('evil.example', undefined, o), false, 'a rebinding Host is refused')
  assert.equal(hostAndOriginOk(undefined, undefined, o), false)
  assert.equal(hostAndOriginOk('ALLOT.example.com', undefined, o), true, 'host names are case-insensitive')
})
