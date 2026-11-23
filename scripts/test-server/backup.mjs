// backup.mjs <file> — dump the staging database (docker/compose.dev.yaml, container allot-dev-db-1) to <file>, mode 600.
// pg_dump runs inside the database container with its own user and database names (read there, never here); only the
// size and the exit are printed, never the dump. Refuses to overwrite a file. Used by stage.sh before a switch.
import { closeSync, existsSync, openSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const file = process.argv[2]
if (!file) { console.error('usage: node backup.mjs <file>'); process.exit(2) }
if (existsSync(file)) { console.error(`backup: ${file} exists; not overwritten`); process.exit(2) }
const fd = openSync(file, 'wx', 0o600)
const r = spawnSync('docker', ['exec', 'allot-dev-db-1', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"'], { stdio: ['ignore', fd, 'ignore'] })
closeSync(fd)
const status = r.error || r.status === null ? 1 : r.status
const size = statSync(file).size
console.log(`backup: pg_dump exit=${status}, ${size} bytes`)
process.exit(status === 0 && size > 0 ? 0 : 1)
