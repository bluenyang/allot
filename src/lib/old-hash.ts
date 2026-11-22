// The hash addresses of 0.1.5 and before (#home, #spend/<tab>, #settings/<tab>, #account, #subs, …)
// as the history addresses that replaced them (spec 012 S-1, S-2). Pure: the router calls it on
// every navigation and replaces the address with the answer.
//
// The hash is the raw one (as in `location.hash`, not decoded by the router): head and tab are
// compared raw, the query is decoded once — as the 0.1.5 `read()` and `checkAdd` did.
// `#app-login?return=…` (the mobile app's sign-in, spec 006 S-6) and an empty hash give null and are
// left alone; any other hash that is not an old app address shows the overview, as `read()` did.

export interface NewAddress { path: string; query: Record<string, string | null> }

export const SPEND_TABS = ['general', 'inst', 'subs'] as const
export const SETTINGS_TABS = ['general', 'theme', 'ai', 'security'] as const
const PLAIN = ['pay', 'events', 'pending', 'history', 'admin', 'dev']

/** The query of a hash (`#spend/subs?x=1&add` → { x: '1', add: null }); a key without a value is null. */
function hashQuery(q: string): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [k, v] of new URLSearchParams(q)) out[k] = v === '' ? null : v
  return out
}

/** The 0.1.5 trigger for the add editor, on the raw query: `add` at the start or after `&`, not followed by a word character. */
const RAW_ADD = /(^|&)add\b/

export function fromOldHash(hash: string): NewAddress | null {
  if (!hash.startsWith('#')) return null
  if (hash.startsWith('#app-login')) return null
  const body = hash.slice(1)
  const at = body.indexOf('?')
  const [head = '', sub = ''] = (at < 0 ? body : body.slice(0, at)).split('/')
  const rawQuery = at < 0 ? '' : body.slice(at + 1)
  const query = hashQuery(rawQuery)
  // `#subs?add%61` opened the editor in 0.1.5 (raw test); the decoded key is `adda`, so add the key the page looks for.
  if (RAW_ADD.test(rawQuery) && !Object.keys(query).some((k) => /^add(?!\w)/.test(k))) query.add = null
  const tab = (tabs: readonly string[]) => (tabs.includes(sub) ? sub : tabs[0]!)
  if (head === '' || head === 'home') return { path: '/', query }
  if (head === 'account') return { path: '/settings/security', query }
  if (head === 'subs') return { path: '/spend/subs', query }
  if (head === 'spend') return { path: `/spend/${tab(SPEND_TABS)}`, query }
  if (head === 'settings') return { path: `/settings/${tab(SETTINGS_TABS)}`, query }
  if (PLAIN.includes(head)) return { path: `/${head}`, query }
  return { path: '/', query } // unknown: the overview, as `read()` showed
}

/**
 * The raw hash of a navigation, from its full path (`/spend/subs?y=1#settings/ai` → `#settings/ai`).
 * vue-router keeps the hash raw in `fullPath` for a string location (and for the initial navigation and
 * popstate, which resolve a string built from `window.location`); only `to.hash` is decoded.
 */
export function rawHashOf(fullPath: string): string {
  const at = fullPath.indexOf('#')
  return at < 0 ? '' : fullPath.slice(at)
}
