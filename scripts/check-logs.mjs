// check-logs.mjs — verify that check logs are evidence: every step/cleanup block has exactly one rev line,
// one "$ " command line (without any "|") and one exit= line, in that order, and ends with "=== end".
// Lines starting with ">" are command output and are ignored.
//   node scripts/check-logs.mjs [--revs] <file|dir>...      (pnpm check:logs [--revs] <file|dir>...)
// --revs also prints one line per log: `<file> rev=<the rev values, unique> exit=<last exit= value>`.
// Exit 0 only when nothing is reported. Logs come from scripts/check-run.sh.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function hasPipe(cmd) {
  return cmd.includes('|')
}

// Returns problems as { line, problem } for one log's text. Output lines (starting with ">") are
// ignored; each block must be: "=== step|cleanup:", rev, "$ " command, exit=<n>, "=== end".
export function checkLog(text) {
  const lines = text.split('\n')
  const problems = []
  const add = (i, problem) => problems.push({ line: i + 1, problem })
  let blocks = 0
  let cur = null
  const finish = (i) => {
    if (!cur) return
    const need = ['rev', 'cmd', 'exit']
    for (const k of need) if (cur[k].length !== 1) add(cur.start, `${cur.name}: expected exactly one ${k === 'cmd' ? '"$ " command line' : k === 'rev' ? 'rev line' : 'exit= line'}, found ${cur[k].length}`)
    if (need.every((k) => cur[k].length === 1) && !(cur.rev[0] < cur.cmd[0] && cur.cmd[0] < cur.exit[0])) add(cur.start, `${cur.name}: rev, command and exit= are out of order`)
    if (cur.cmd.length >= 1 && hasPipe(lines[cur.cmd[0]].slice(2))) add(cur.cmd[0], `${cur.name}: command line contains a pipe "|"`)
    if (!cur.ended) add(cur.start, `${cur.name}: block cut short (no "=== end")`)
    cur = null
  }
  lines.forEach((l, i) => {
    if (l.startsWith('>')) return
    const m = /^=== (step|cleanup): (.*)$/.exec(l)
    if (m) { finish(i); blocks++; cur = { name: l, start: i, rev: [], cmd: [], exit: [], ended: false }; return }
    if (!cur) return
    if (l === '=== end') { cur.ended = true; finish(i); return }
    if (l.startsWith('rev ')) cur.rev.push(i)
    else if (l.startsWith('$ ')) cur.cmd.push(i)
    else if (/^exit=\d+$/.test(l)) cur.exit.push(i)
  })
  finish(lines.length)
  if (blocks === 0) return [{ line: 1, problem: 'not a runner log (no "=== step:" block)' }]
  return problems
}

// The unique rev values (in order) and the last exit= value of one log's text (output lines are ignored).
export function summarize(text) {
  const revs = []
  let exit = null
  for (const l of text.split('\n')) {
    if (l.startsWith('>')) continue
    if (l.startsWith('rev ')) { const r = l.slice(4).trim(); if (!revs.includes(r)) revs.push(r) }
    else if (/^exit=\d+$/.test(l)) exit = l.slice(5)
  }
  return { revs, exit }
}

function collect(path, out) {
  if (statSync(path).isDirectory()) {
    for (const e of readdirSync(path).sort()) collect(join(path, e), out)
  } else if (path.endsWith('.log') || out.explicit.has(path)) out.files.push(path)
}

function main(argv) {
  const showRevs = argv.includes('--revs')
  const args = argv.filter((a) => a !== '--revs')
  if (args.length === 0) { console.error('usage: node scripts/check-logs.mjs [--revs] <file|dir>...'); return 2 }
  const out = { files: [], explicit: new Set(args.filter((a) => !statSync(a).isDirectory())) }
  for (const a of args) collect(a, out)
  let bad = 0
  for (const f of out.files) {
    const text = readFileSync(f, 'utf8')
    for (const p of checkLog(text)) { bad++; console.log(`${f}:${p.line}: ${p.problem}`) }
    if (showRevs) { const { revs, exit } = summarize(text); console.log(`${f} rev=${revs.join(',')} exit=${exit ?? 'none'}`) }
  }
  console.log(`${out.files.length} log(s) checked, ${bad} problem(s)`)
  if (out.files.length === 0) { console.log('no .log file found: nothing was checked'); return 1 }
  return bad === 0 ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
