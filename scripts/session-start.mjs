#!/usr/bin/env node
// Claude Code SessionStart hook: the stdout becomes session context. It tells the session which
// delegation table applies on this machine: the personal one in .loctx/delegation.local.md (its
// `## Delegation` section, verbatim) or, when there is none, the Delegation block of AGENTS.md.
// It reads nothing else from .loctx/ and no env file. It always exits 0: a failure must not block a session.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HEADER = "This machine's delegation table (.loctx/delegation.local.md) — it replaces the table in AGENTS.md:"
const FALLBACK = 'No personal delegation table: follow the Delegation block in AGENTS.md.'

/** The `## Delegation` section of a markdown text: from its heading up to the next `## ` heading. */
export function delegationSection(text) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((l) => /^##\s+Delegation\s*$/.test(l))
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break }
  return lines.slice(start, end).join('\n').trimEnd()
}

/** The text to print for a project directory. */
export function sessionContext(dir) {
  let text
  try { text = readFileSync(join(dir, '.loctx', 'delegation.local.md'), 'utf8') } catch { return FALLBACK }
  const section = delegationSection(text)
  return section ? `${HEADER}\n\n${section}` : FALLBACK
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(sessionContext(process.env.CLAUDE_PROJECT_DIR || process.cwd()))
  } catch { /* never block a session */ }
  process.exit(0)
}
