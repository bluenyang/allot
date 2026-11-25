// Start a command in the background for disposable.sh, or stop it.
//   node scripts/test-server/spawn.mjs <pidfile> <logfile> <command...>   start; its output goes to <logfile>
//   node scripts/test-server/spawn.mjs --stop <pidfile>                   stop the process group, if it runs
// The command gets this process's environment (values are passed by name, never on the command line).
import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const [a, b, ...rest] = process.argv.slice(2)
if (a === '--stop') {
  if (!b || !existsSync(b)) { console.log('no pid file: nothing to stop'); process.exit(0) }
  const pid = Number(readFileSync(b, 'utf8').trim())
  try { process.kill(-pid, 'SIGTERM'); console.log(`stopped process group ${pid}`) } catch { console.log(`process ${pid} was not running`) }
  rmSync(b, { force: true })
  process.exit(0)
}
if (!a || !b || rest.length === 0) { console.log('usage: spawn.mjs <pidfile> <logfile> <command...> | --stop <pidfile>'); process.exit(2) }
const out = openSync(b, 'a')
const child = spawn(rest[0], rest.slice(1), { detached: true, stdio: ['ignore', out, out] })
writeFileSync(a, String(child.pid))
child.unref()
console.log(`started ${rest.slice(0, 4).join(' ')} as process group ${child.pid}, output to ${b}`)
