// The skills download (spec 017 S-4), behind the session check in app.ts:
//   GET /api/skills             → { skills: [{ name, file, bytes }] }  (empty when this server has no skills/ folder)
//   GET /api/skills/<name>.zip  → application/zip, one skill for claude.ai (Customize › Skills › Upload)
// The folder is skills/ next to the server's working directory (SKILLS_DIR to choose): the image copies it in, the
// staging snapshot and a checkout have it. A name is served only when it is one of the folders found there; the
// request's text never becomes a path by itself. ZIPs are made once per process (the folder does not change).
import { Hono } from 'hono'
import { join } from 'node:path'
import type { AppEnv } from './app-env'
import { msg } from './messages'
import { skillNames, skillZip } from './skill-zip'

const root = () => process.env.SKILLS_DIR ?? join(process.cwd(), 'skills')
const cache = new Map<string, Buffer>()
const zipOf = (name: string) => {
  let z = cache.get(name)
  if (!z) cache.set(name, (z = skillZip(root(), name)))
  return z
}

export const skillRoutes = new Hono<AppEnv>()

skillRoutes.get('/', (c) => c.json({ skills: skillNames(root()).map((name) => ({ name, file: `${name}.zip`, bytes: zipOf(name).length })) }))

skillRoutes.get('/:file', (c) => {
  const m = /^(.+)\.zip$/.exec(c.req.param('file'))
  const name = m ? skillNames(root()).find((n) => n === m[1]) : undefined
  if (!name) return c.json({ error: msg(c, 'skillNotFound') }, 404)
  const body = zipOf(name)
  return c.body(new Uint8Array(body), 200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${name}.zip"`,
    'cache-control': 'private, no-store',
  })
})
