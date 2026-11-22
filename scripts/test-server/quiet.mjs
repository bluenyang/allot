// quiet.mjs <command...> — run a command with stdin, stdout and stderr all discarded, print only the
// fixed line `<program> … exit=<status>` (no argument values) and exit with the command's status
// (1 when it could not start or was killed by a signal). Used by stage.sh so that the output of
// `docker compose up --build`, which could hold env values, never reaches the runner's capture file.
import { spawnSync } from 'node:child_process'

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) { console.error('usage: node quiet.mjs <command...>'); process.exit(2) }
const r = spawnSync(cmd, args, { stdio: 'ignore' })
const status = r.error || r.status === null ? 1 : r.status
console.log(`${cmd} … exit=${status}`)
process.exit(status)
