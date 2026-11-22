// spec 012 V-2: every hash address of 0.1.5 leads to its history address; others are left alone.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fromOldHash } from '../../src/lib/old-hash'

const CASES: [string, { path: string; query: Record<string, string | null> } | null][] = [
  ['#', { path: '/', query: {} }],
  ['#home', { path: '/', query: {} }],
  ['#pay', { path: '/pay', query: {} }],
  ['#spend', { path: '/spend/general', query: {} }],
  ['#spend/general', { path: '/spend/general', query: {} }],
  ['#spend/inst', { path: '/spend/inst', query: {} }],
  ['#spend/subs', { path: '/spend/subs', query: {} }],
  ['#spend/nope', { path: '/spend/general', query: {} }],
  ['#subs', { path: '/spend/subs', query: {} }],
  ['#subs?add', { path: '/spend/subs', query: { add: null } }],
  ['#spend/general?add', { path: '/spend/general', query: { add: null } }],
  ['#spend/inst?add', { path: '/spend/inst', query: { add: null } }],
  ['#spend/subs?x=1&add', { path: '/spend/subs', query: { x: '1', add: null } }],
  ['#events', { path: '/events', query: {} }],
  ['#pending', { path: '/pending', query: {} }],
  ['#history', { path: '/history', query: {} }],
  ['#settings', { path: '/settings/general', query: {} }],
  ['#settings/general', { path: '/settings/general', query: {} }],
  ['#settings/theme', { path: '/settings/theme', query: {} }],
  ['#settings/ai', { path: '/settings/ai', query: {} }],
  ['#settings/security', { path: '/settings/security', query: {} }],
  ['#settings/nope', { path: '/settings/general', query: {} }],
  ['#account', { path: '/settings/security', query: {} }],
  ['#admin', { path: '/admin', query: {} }],
  ['#dev', { path: '/dev', query: {} }],
  // not old app addresses: left alone
  ['#app-login?return=allot://auth', null],
  ['#app-login', null],
  ['', null],
  // unknown: the overview, as read() showed
  ['#nope', { path: '/', query: {} }],
  ['#nope?x=1', { path: '/', query: { x: '1' } }],
  // raw input, as read() and checkAdd saw it
  ['#subs?add%61', { path: '/spend/subs', query: { adda: null, add: null } }],
  ['#settings/ai?x=a%26b', { path: '/settings/ai', query: { x: 'a&b' } }],
  ['#%73ubs', { path: '/', query: {} }],
  ['#spend/subs?add=1', { path: '/spend/subs', query: { add: '1' } }],
  ['#subs?addx', { path: '/spend/subs', query: { addx: null } }],
]

for (const [hash, want] of CASES) {
  test(`fromOldHash(${JSON.stringify(hash)})`, () => assert.deepEqual(fromOldHash(hash), want))
}
