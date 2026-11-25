// Exit 0 when nothing answers on 127.0.0.1:<port> for each port given, 1 when one is taken (review 1 F-4:
// a stale API from a killed run would answer the health check instead of the new one).
//   node scripts/test-server/port-free.mjs 15183 15184
import { connect } from 'node:net'

const ports = process.argv.slice(2).map(Number)
if (ports.length === 0 || ports.some((p) => !Number.isInteger(p) || p <= 0)) { console.log('usage: port-free.mjs <port>...'); process.exit(2) }
const taken = (port) => new Promise((done) => {
  const s = connect({ host: '127.0.0.1', port })
  s.setTimeout(2000)
  s.once('connect', () => { s.destroy(); done(true) })
  s.once('timeout', () => { s.destroy(); done(true) })
  s.once('error', () => done(false))
})
let bad = 0
for (const p of ports) {
  if (await taken(p)) { console.log(`port ${p} is taken: stop what listens there first`); bad++ } else console.log(`port ${p} is free`)
}
process.exit(bad ? 1 : 0)
