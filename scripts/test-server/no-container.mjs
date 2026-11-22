// no-container.mjs <name> — exit 0 when no container (running or not) is named exactly <name>,
// 1 when one remains, 2 when docker fails. Used by down.sh; no `|` in any argument (check-run.sh refuses it).
import { spawnSync } from 'node:child_process'

const name = process.argv[2]
if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) { console.error('usage: node no-container.mjs <container-name>'); process.exit(2) }
const r = spawnSync('docker', ['ps', '-a', '-q', '-f', `name=^${name}$`], { encoding: 'utf8' })
if (r.error || r.status !== 0) { console.error(`docker ps failed: ${r.error?.message ?? r.stderr.trim()}`); process.exit(2) }
const left = r.stdout.trim()
if (left) { console.log(`container ${name} still exists: ${left}`); process.exit(1) }
console.log(`no container named ${name}`)
