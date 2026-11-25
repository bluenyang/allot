// One ZIP per skill for claude.ai (Settings › Capabilities › Skills › Upload), spec 015 S-14: a plugin whose MCP
// address is a ${user_config} value brings no server to claude.ai, so the skills are uploaded on their own there.
//   node scripts/skills-zip.mjs        → dist-skills/<name>.zip (each holds <name>/SKILL.md; not committed)
// The ZIP writer is server/skill-zip.ts, which the server's download uses too (spec 017 S-4); Node runs the .ts import
// with its type stripping (Node 24 or later).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { skillNames, skillZip } from '../server/skill-zip.ts'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'dist-skills')

mkdirSync(OUT, { recursive: true })
for (const name of skillNames(join(ROOT, 'skills'))) {
  const z = skillZip(join(ROOT, 'skills'), name)
  writeFileSync(join(OUT, `${name}.zip`), z)
  console.log(`dist-skills/${name}.zip (${z.length} bytes)`)
}
