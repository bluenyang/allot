// spec 002 V-4: WCAG contrast of the palette in src/style.css, light and dark.
//   node tests/contrast.mjs   → exit 0 only when every pair meets its minimum
// Reads the tokens from the light `:root{…}` block and both dark blocks (which must be identical).
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

function tokens(block) {
  const out = {}
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase()
  return out
}
const light = tokens(css.match(/^:root\{([\s\S]*?)\n\}/m)?.[1] ?? '')
const darkMedia = tokens(css.match(/@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{([\s\S]*?)\}\}/)?.[1] ?? '')
const darkAttr = tokens(css.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/)?.[1] ?? '')

let failed = 0
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++ }

ok(Object.keys(light).length > 20, `light tokens found (${Object.keys(light).length})`)
ok(Object.keys(darkMedia).length > 20, `dark tokens found (${Object.keys(darkMedia).length})`)
ok(JSON.stringify(darkMedia) === JSON.stringify(darkAttr), 'both dark blocks are identical')

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

const PAIRS = [
  ['fg', 'bg', 7], ['fg', 'surface', 7],
  ['muted', 'surface', 4.5], ['muted', 'raised', 4.5],
  ['accent', 'surface', 4.5], ['accent', 'accent-soft', 4.5], ['accent-ink', 'accent', 4.5],
  ['side-fg', 'side', 7], ['side-muted', 'side', 4.5], ['#ffffff', 'side-active', 7],
  ['pos', 'pos-soft', 4.5], ['pos', 'surface', 4.5],
  ['neg', 'neg-soft', 4.5], ['neg', 'surface', 4.5],
  ['warn', 'warn-soft', 4.5], ['warn', 'surface', 4.5],
  ...[1, 2, 3, 4, 5, 6].flatMap((i) => [[`c${i}`, 'surface', 3], ['av-ink', `c${i}`, 4.5]]),
]

for (const [mode, t] of [['light', light], ['dark', darkMedia]]) {
  for (const [a, b, min] of PAIRS) {
    const ca = a.startsWith('#') ? a : t[a]
    const cb = b.startsWith('#') ? b : t[b]
    if (!ca || !cb) { ok(false, `${mode} ${a}/${b}: token missing`); continue }
    const r = ratio(ca, cb)
    ok(r >= min, `${mode} ${a} ${ca} on ${b} ${cb}: ${r.toFixed(2)} (min ${min})`)
  }
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
