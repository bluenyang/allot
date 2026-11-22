// Removes the rows an interrupted or failed run left on the throwaway test server (:15174 only):
// in every list of the test account, the rows whose name starts with a test marker. The seed rows
// ("Seed ...", scripts/test-server/seed.mjs) are not touched.
//   BASE=http://127.0.0.1:15174 ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/test-server/cleanup.mjs
import { LISTS, connect, rowName } from './lib.mjs'

const MARKERS = ['E2E-', 'V8-marker', 'V5-marker', 'V4-fixture']

const { api, state } = await connect()
const st = await state()
let bad = 0
let n = 0
for (const [key, path] of Object.entries(LISTS)) {
  for (const row of st[key] ?? []) {
    const name = rowName(row)
    if (!MARKERS.some((m) => name.startsWith(m))) continue
    const r = await api('DELETE', `/api/${path}/${row.id}`)
    n++
    console.log(`${r.status === 204 ? 'removed' : `FAIL ${r.status}`} ${key} ${name}`)
    if (r.status !== 204) bad++
  }
}
console.log(`${n} leftover row(s)`)
process.exit(bad ? 1 : 0)
