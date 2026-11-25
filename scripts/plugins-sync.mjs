// Copy the shared skills (skills/, the one source; the Gemini extension reads it there) and the repository's LICENSE into
// each Claude Code plugin (plugins/<name>/): an installed plugin cannot reach files outside its own folder (spec 015 W-8, A-25).
//   node scripts/plugins-sync.mjs          copy (replaces each plugin's skills/ folder)
// tests/unit/plugins.test.ts fails when a copy differs from skills/, so a skill edited in one place only is caught.
import { copyFileSync, cpSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
export const PLUGINS = ['allot', 'allot-key']
for (const p of PLUGINS) {
  const to = join(ROOT, 'plugins', p, 'skills')
  rmSync(to, { recursive: true, force: true })
  cpSync(join(ROOT, 'skills'), to, { recursive: true })
  copyFileSync(join(ROOT, 'LICENSE'), join(ROOT, 'plugins', p, 'LICENSE'))
  console.log(`plugins/${p}/skills ← skills/ (${readdirSync(to).length} skills), plugins/${p}/LICENSE ← LICENSE`)
}
