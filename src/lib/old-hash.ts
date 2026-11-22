// The hash addresses of 0.1.5 and before (#home, #spend/<tab>, #settings/<tab>, #account, #subs, …)
// as the history addresses that replaced them (spec 012 S-1, S-2). Pure: the router calls it on
// every navigation and replaces the address with the answer.
//
// A hash that is not an old app address — `#app-login?return=…` (the mobile app's sign-in, spec 006
// S-6) or anything unknown — gives null and is left alone.

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

export function fromOldHash(hash: string): NewAddress | null {
  if (!hash.startsWith('#')) return null
  const body = hash.slice(1)
  const at = body.indexOf('?')
  const [head = '', sub = ''] = (at < 0 ? body : body.slice(0, at)).split('/')
  const query = at < 0 ? {} : hashQuery(body.slice(at + 1))
  const tab = (tabs: readonly string[]) => (tabs.includes(sub) ? sub : tabs[0]!)
  if (head === '' || head === 'home') return { path: '/', query }
  if (head === 'account') return { path: '/settings/security', query }
  if (head === 'subs') return { path: '/spend/subs', query }
  if (head === 'spend') return { path: `/spend/${tab(SPEND_TABS)}`, query }
  if (head === 'settings') return { path: `/settings/${tab(SETTINGS_TABS)}`, query }
  if (PLAIN.includes(head)) return { path: `/${head}`, query }
  return null
}
