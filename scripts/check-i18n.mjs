// spec 008 V-8: no Hangul in the screen code outside the allowed places. The Korean text lives in
// src/i18n/ko.ts; the only other places are the data and logic that name Korean things (the
// built-in holidays, the stored event kinds), and comments. Check only: it changes nothing.
//   node scripts/check-i18n.mjs        exit 0 = clean, 1 = a file has Hangul outside the allowlist
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const ALLOWED = new Set([
  'src/i18n/ko.ts', // the Korean messages
  'src/i18n/en.ts', // the native name of the Korean language in the language list
  'src/data/holidays-kr.ts', // the built-in holidays (names are data) and their English names
  'src/data/types.ts', // EventKind: the stored Korean kinds
  'src/lib/labels.ts', // maps the stored Korean event kinds to message keys
  'src/lib/holidays.ts', // names the substitute holidays it computes (대체공휴일)
  'src/lib/holiday-names.ts', // reads that name back to translate it
])
const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.(vue|ts)$/.test(f) ? [p] : []
  })
}

/** The code without its comments: block comments, HTML comments, and // to the end of the line (not the // of a URL). */
function code(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
    .join('\n')
}

let bad = 0
for (const file of files(join(ROOT, 'src'))) {
  const rel = relative(ROOT, file)
  if (ALLOWED.has(rel)) continue
  code(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
    if (HANGUL.test(line)) {
      bad++
      console.log(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
    }
  })
}
console.log(bad ? `FAIL: ${bad} line(s) with Hangul outside the allowlist` : 'PASS: no Hangul outside the allowlist')
process.exit(bad ? 1 : 0)
