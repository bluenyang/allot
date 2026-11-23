// A fake rate service for the throwaway test server (spec 013 V-20): it answers like Frankfurter, so the automatic rate
// refresh can be tested without any request to the real api.frankfurter.app.
//   GET /latest?from=<CODE>&to=KRW → 200 { amount: 1, base, date, rates: { KRW: <rate> } } for a known code; 404 otherwise
//   GET /_log                      → the /latest requests seen so far ([{ at, from, to }]), for the tests
//   DELETE /_log                   → forget them
//   PUT /_rate?code=EUR&rate=1600  → change (or add) a code's rate; rate=none removes the code (it answers 404 then)
// Every request is also printed (one line each), so `docker logs` shows them. No dependencies.
//   docker run -d --name allot-fxfake --network allot-dev_default -p 127.0.0.1:15179:8080 \
//     -v <worktree>/tests/api:/fx:ro allot-dev-api node /fx/fx-fake.mjs
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8080)
const rates = new Map([['USD', 1388.5], ['EUR', 1512.34], ['JPY', 9.05], ['GBP', 1777.77]])
let seen = []

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake')
  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search}`)
  if (url.pathname === '/latest' && req.method === 'GET') {
    const from = (url.searchParams.get('from') ?? '').toUpperCase()
    const to = (url.searchParams.get('to') ?? '').toUpperCase()
    seen.push({ at: new Date().toISOString(), from, to })
    const rate = rates.get(from)
    if (to !== 'KRW' || rate === undefined) return send(res, 404, { message: 'not found' })
    return send(res, 200, { amount: 1, base: from, date: new Date().toISOString().slice(0, 10), rates: { KRW: rate } })
  }
  if (url.pathname === '/_log' && req.method === 'GET') return send(res, 200, seen)
  if (url.pathname === '/_log' && req.method === 'DELETE') { seen = []; return send(res, 200, seen) }
  if (url.pathname === '/_rate' && req.method === 'PUT') {
    const code = (url.searchParams.get('code') ?? '').toUpperCase()
    const r = url.searchParams.get('rate')
    if (!/^[A-Z]{3}$/.test(code)) return send(res, 400, { message: 'code' })
    if (r === 'none') rates.delete(code)
    else if (Number.isFinite(Number(r))) rates.set(code, Number(r))
    else return send(res, 400, { message: 'rate' })
    return send(res, 200, Object.fromEntries(rates))
  }
  send(res, 404, { message: 'not found' })
}).listen(PORT, () => console.log(`fake rate service on :${PORT}`))
