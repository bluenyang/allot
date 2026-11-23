// backup.mjs <file> — dump the staging database (docker/compose.dev.yaml, container allot-dev-db-1) to <file>, mode 600.
// pg_dump runs inside the database container with its own user and database names (read there, never here); only the
// size and the exit are printed, never the dump. Refuses to overwrite a file. Used by stage.sh before a switch.
import { closeSync, existsSync, openSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

/** stdout of a command in a container (trimmed), or null. The value stays in this process: only same/differs is printed. */
const inside = (container, args) => {
  const r = spawnSync('docker', ['exec', container, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return r.status === 0 ? r.stdout.trim() : null
}

const file = process.argv[2]
if (!file) { console.error('usage: node backup.mjs <file>'); process.exit(2) }
if (existsSync(file)) { console.error(`backup: ${file} exists; not overwritten`); process.exit(2) }
// the database dumped is the one the api uses (retro review S-2): its DATABASE_URL's name against POSTGRES_DB
const apiDb = inside('allot-dev-api-1', ['node', '-e', 'process.stdout.write(new URL(process.env.DATABASE_URL).pathname.slice(1))'])
const dbDb = inside('allot-dev-db-1', ['sh', '-c', 'printf %s "$POSTGRES_DB"'])
const same = !!apiDb && apiDb === dbDb
console.log(`backup: the api's database and POSTGRES_DB are ${same ? 'the same' : 'not the same (or unreadable)'}`)
if (!same) process.exit(1)
const fd = openSync(file, 'wx', 0o600)
const r = spawnSync('docker', ['exec', 'allot-dev-db-1', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'], { stdio: ['ignore', fd, 'ignore'] })
closeSync(fd)
const status = r.error || r.status === null ? 1 : r.status
const size = statSync(file).size
// a dump of the app's database holds its tables (not printed)
const app = status === 0 && /CREATE TABLE public\.settings\b/.test(readFileSync(file, 'utf8'))
console.log(`backup: pg_dump exit=${status}, ${size} bytes, the app's tables ${app ? 'present' : 'MISSING'}`)
process.exit(status === 0 && size > 0 && app ? 0 : 1)
