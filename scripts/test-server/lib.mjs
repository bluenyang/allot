// Shared by cleanup.mjs and seed.mjs: the API client for the throwaway test server (:15174 only).
// The account comes from ADMIN_EMAIL / ADMIN_PASSWORD (scripts/test-server/run.sh loads them by name).
export const TEST_BASE = 'http://127.0.0.1:15174'

/** Exits 1 unless BASE is exactly the throwaway test server: these scripts write and delete rows. */
export function requireTestServer() {
  if (process.env.BASE !== TEST_BASE) {
    console.log(`refuse: BASE is not the test server (${TEST_BASE})`)
    process.exit(1)
  }
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
  requireTestServer()
  let cookie = ''
  const api = async (method, path, body) => {
    const r = await fetch(TEST_BASE + path, {
      method,
      headers: { 'content-type': 'application/json', origin: TEST_BASE, ...(cookie ? { cookie } : {}) },
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
