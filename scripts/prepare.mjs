// `pnpm install` lifecycle: install git hooks on a host checkout only.
// Inside the Docker image there is no .git, so there is nothing to hook into.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (!existsSync('.git')) {
  console.log('prepare: no .git here (container build?) — skipping lefthook install')
  process.exit(0)
}
const r = spawnSync('pnpm', ['exec', 'lefthook', 'install'], { stdio: 'inherit' })
process.exit(r.status ?? 1)
