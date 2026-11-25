// Shared by cleanup.mjs and seed.mjs: the API client for the throwaway test server (:15174) or the throwaway API of
// disposable.sh (127.0.0.1:15184), nothing else. The account comes from ADMIN_EMAIL / ADMIN_PASSWORD (run.sh and
// disposable.sh set them by name).
export const TEST_BASE = 'http://127.0.0.1:15174'
export const DISPOSABLE_BASE = 'http://127.0.0.1:15184'

/** Exits 1 unless BASE is exactly one of the throwaway servers: these scripts write and delete rows. Returns BASE. */
export function requireTestServer() {
  const base = process.env.BASE
  if (base !== TEST_BASE && base !== DISPOSABLE_BASE) {
    console.log(`refuse: BASE is not a throwaway server (${TEST_BASE} or ${DISPOSABLE_BASE})`)
    process.exit(1)
  }
  return base
}

/**
 * The list resources of /api/state: state key → API path, in the order cleanup.mjs deletes them: a spending before
 * its card and account (a buffer use keeps both, spec 013 S-9), a balance record or a card before its account.
 */
export const LISTS = {
  planChanges: 'plan-changes', phases: 'phases', subscriptions: 'subscriptions', events: 'events', checks: 'checks',
  spendings: 'spendings', cards: 'cards', balances: 'balances', livingItems: 'living-items',
  accounts: 'accounts', debts: 'debts', remainderSplit: 'remainder-split', targets: 'targets',
}

/** Signs in once and returns { api, state }. */
export async function connect() {
  const base = requireTestServer()
  let cookie = ''
  const api = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = r.headers.getSetCookie?.() ?? []
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ')
    const t = await r.text()
    let json = null
    try { json = t ? JSON.parse(t) : null } catch { json = t }
    return { status: r.status, json }
  }
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) { console.log('ADMIN_EMAIL and ADMIN_PASSWORD must be set'); process.exit(1) }
  const s = await api('POST', '/api/auth/sign-in/email', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  if (s.status !== 200) { console.log(`sign-in failed: ${s.status}${s.status === 429 ? ' (login limit: wait a minute)' : ''}`); process.exit(1) }
  return { api, state: async () => (await api('GET', '/api/state')).json }
}

/** The text a row is known by in the lists. */
export const rowName = (row) => String(row.name ?? row.text ?? row.title ?? row.note ?? '').trim()
