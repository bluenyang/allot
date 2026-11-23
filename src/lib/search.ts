// Search (spec 013 S-19): find subscriptions, spendings, living items, accounts, cards, allocation targets, plan events and
// check items by name and memo in the state the app already has (no server round trip). Pure: the header search dialog
// and the MCP `search` tool use the same matching. A match is a case-insensitive part of the text, as typed (Korean
// included: both sides are NFC-normalized, so a decomposed and a composed syllable match).
import type { Account, AllocationTarget, Card, CheckItem, LivingItem, PlanEvent, Spending, Subscription } from '../data/types'

/** The kinds, in the order the results are grouped. */
export const SEARCH_KINDS = ['subscription', 'spending', 'livingItem', 'account', 'card', 'target', 'event', 'check'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

/** The part of the state search reads. */
export interface SearchState {
  subscriptions: Subscription[]
  spendings?: Spending[]
  livingItems?: LivingItem[]
  accounts: Account[]
  cards?: Card[]
  targets: AllocationTarget[]
  events: PlanEvent[]
  checks: CheckItem[]
}

export interface SearchHit {
  kind: SearchKind
  id: string
  /** the name (an event's title, a check item's text) */
  name: string
  /** the memo; '' when the row has none (events and check items have none) */
  note: string
  /** where the query was found, and at which character of that text (of its normalized form) */
  field: 'name' | 'note'
  at: number
  /** the page that shows the row (an app path) */
  path: string
}

/** The text search compares: NFC, lower case. */
export const fold = (s: string) => s.normalize('NFC').toLowerCase()

/** The query as compared: trimmed, inner runs of white space as one space, folded. */
export const foldQuery = (q: string) => fold(q.trim().replace(/\s+/g, ' '))

interface Row { kind: SearchKind; id: string; name: string; note: string; path: string }

/** The page of a spending: the 일반 tab for one paid at once, the 할부 tab for the others (as the 지출 page splits them). */
const spendingPath = (s: Spending) => (s.how === 'lump' ? '/spend/general' : '/spend/inst')
/** The page of an account: a Savings / Investment item its menu, any other account the pay split's account table. */
const accountPath = (a: Account) => (a.group === 'saving' ? '/saving' : a.group === 'invest' ? '/invest' : '/pay')

function rows(st: SearchState, kind: SearchKind): Row[] {
  switch (kind) {
    case 'subscription': return st.subscriptions.map((x) => ({ kind, id: x.id, name: x.name, note: x.note ?? '', path: '/spend/subs' }))
    case 'spending': return (st.spendings ?? []).map((x) => ({ kind, id: x.id, name: x.name, note: x.note ?? '', path: spendingPath(x) }))
    case 'livingItem': return (st.livingItems ?? []).map((x) => ({ kind, id: x.id, name: x.name, note: x.note ?? '', path: '/living' }))
    case 'account': return st.accounts.map((x) => ({ kind, id: x.id, name: x.name, note: x.note ?? '', path: accountPath(x) }))
    case 'card': return (st.cards ?? []).map((x) => ({ kind, id: x.id, name: x.name, note: x.note ?? '', path: '/pay' }))
    case 'target': return st.targets.map((x) => ({ kind, id: x.id, name: x.name, note: x.note ?? '', path: '/pay' }))
    case 'event': return st.events.map((x) => ({ kind, id: x.id, name: x.title, note: '', path: '/events' }))
    case 'check': return st.checks.map((x) => ({ kind, id: x.id, name: x.text, note: '', path: '/' }))
  }
}

/**
 * Every row whose name or memo holds `query`, grouped by kind in SEARCH_KINDS order (only `kinds`, when given). In a
 * kind: name matches before memo matches, a match at the start first, then the order of the list. An empty query finds nothing.
 */
export function search(st: SearchState, query: string, kinds: readonly SearchKind[] = SEARCH_KINDS): SearchHit[] {
  const q = foldQuery(query)
  if (!q) return []
  const out: SearchHit[] = []
  for (const kind of SEARCH_KINDS) {
    if (!kinds.includes(kind)) continue
    const hits: (SearchHit & { order: number })[] = []
    rows(st, kind).forEach((r, order) => {
      const inName = fold(r.name).indexOf(q)
      const inNote = inName < 0 && r.note ? fold(r.note).indexOf(q) : -1
      if (inName >= 0) hits.push({ ...r, field: 'name', at: inName, order })
      else if (inNote >= 0) hits.push({ ...r, field: 'note', at: inNote, order })
    })
    hits.sort((a, b) => (a.field === b.field ? 0 : a.field === 'name' ? -1 : 1) || (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) || a.order - b.order)
    for (const { order: _o, ...h } of hits) out.push(h)
  }
  return out
}

/**
 * A text cut into the parts before, at and after the match, for a highlight. When the text's normalized form has another
 * length (it was not typed in NFC), the match cannot be placed: the whole text comes back unmarked.
 */
export function markParts(text: string, query: string): { text: string; hit: boolean }[] {
  const q = foldQuery(query)
  const f = fold(text)
  const at = q ? f.indexOf(q) : -1
  if (at < 0 || f.length !== text.length) return [{ text, hit: false }]
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + q.length), hit: true },
    { text: text.slice(at + q.length), hit: false },
  ].filter((p) => p.text)
}
