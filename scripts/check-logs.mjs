// check-logs.mjs — verify that check logs are evidence: every step/cleanup block has a rev line,
// a "$ " command line (without any "|") and an exit= line.
//   node scripts/check-logs.mjs <file|dir>...      (pnpm check:logs <file|dir>...)
// Exit 0 only when nothing is reported. Logs come from scripts/check-run.sh.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function hasPipe(cmd) {
  return cmd.includes('|')
}

// Returns problems as { line, problem } for one log's text.
export function checkLog(text) {
  const lines = text.split('\n')
  const problems = []
  const starts = []
  lines.forEach((l, i) => { if (/^=== (step|cleanup):/.test(l)) starts.push(i) })
  if (starts.length === 0) return [{ line: 1, problem: 'not a runner log (no "=== step:" block)' }]
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length
    const block = lines.slice(s, end)
    const name = lines[s]
    if (!block.some((l) => l.startsWith('rev '))) problems.push({ line: s + 1, problem: `${name}: no rev line` })
    const ci = block.findIndex((l) => l.startsWith('$ '))
    if (ci < 0) problems.push({ line: s + 1, problem: `${name}: no command line ("$ ")` })
    else if (hasPipe(block[ci].slice(2))) problems.push({ line: s + ci + 1, problem: `${name}: command line contains a pipe "|"` })
    if (!block.some((l) => /^exit=\d+$/.test(l))) problems.push({ line: s + 1, problem: `${name}: no exit= line` })
  })
  return problems
}

function collect(path, out) {
  if (statSync(path).isDirectory()) {
    for (const e of readdirSync(path).sort()) collect(join(path, e), out)
  } else if (path.endsWith('.log') || out.explicit.has(path)) out.files.push(path)
}

function main(args) {
  if (args.length === 0) { console.error('usage: node scripts/check-logs.mjs <file|dir>...'); return 2 }
  const out = { files: [], explicit: new Set(args.filter((a) => !statSync(a).isDirectory())) }
  for (const a of args) collect(a, out)
  let bad = 0
  for (const f of out.files) {
    for (const p of checkLog(readFileSync(f, 'utf8'))) { bad++; console.log(`${f}:${p.line}: ${p.problem}`) }
  }
  console.log(`${out.files.length} log(s) checked, ${bad} problem(s)`)
  return bad === 0 ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
