// spec 007 V-7 (b): user colours keep every text pair at 4.5:1, light and dark; the defaults equal
// the tokens in src/style.css. Also the display formats (S-8).
//   pnpm test:unit
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ACCENT_PRESETS, DEFAULT_ACCENT, DEFAULT_PRIMARY, GROUND, PRIMARY_PRESETS, contrast, derive } from '../../src/lib/theme'
import { dateText, money, moneyClass } from '../../src/lib/format'

/** The pairs the theme promises (spec 007 S-7), per mode. */
function problems(primary: string, accent: string): string[] {
  const out: string[] = []
  for (const mode of ['light', 'dark'] as const) {
    const t = derive(primary, accent, mode)
    const g = GROUND[mode]
    const pairs: [string, string, string, number][] = [
      ['primary-text', t['primary-text']!, 'surface', 4.5], ['primary-text', t['primary-text']!, 'surface-2', 4.5],
      ['primary-text', t['primary-text']!, 'primary-soft', 4.5], ['primary-ink', t['primary-ink']!, 'primary', 4.5],
      ['accent-text', t['accent-text']!, 'surface', 4.5], ['accent-text', t['accent-text']!, 'accent-soft', 4.5],
      ['accent-ink', t['accent-ink']!, 'accent', 4.5],
    ]
    const bg: Record<string, string> = { surface: g.surface, 'surface-2': g.surface2, 'primary-soft': t['primary-soft']!, primary: t.primary!, 'accent-soft': t['accent-soft']!, accent: t.accent! }
    for (const [name, fg, on, min] of pairs) {
      const r = contrast(fg, bg[on]!)
      if (r < min) out.push(`${mode} ${primary}/${accent}: ${name} ${fg} on ${on} ${bg[on]} = ${r.toFixed(2)}`)
    }
  }
  return out
}

test('presets: every primary × accent passes in light and dark', () => {
  const bad = PRIMARY_PRESETS.flatMap(([p]) => ACCENT_PRESETS.flatMap(([a]) => problems(p, a)))
  assert.deepEqual(bad, [])
})

test('500 random colours (fixed seed) and the extremes pass', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31)
  const hex = () => '#' + Math.floor(rand() * 0x1000000).toString(16).padStart(6, '0').toUpperCase()
  const colours = [...Array.from({ length: 500 }, hex), '#FFFFFF', '#000000', '#FFFF00', '#00FFFF', '#808080', '#767676']
  const bad: string[] = []
  for (let i = 0; i < colours.length; i++) bad.push(...problems(colours[i]!, colours[(i * 7 + 3) % colours.length]!))
  assert.deepEqual(bad, [])
})

test('the default colours derive exactly the tokens in style.css', () => {
  const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8')
  const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]!.toUpperCase()]))
  const light = tokens(css.match(/^:root\{([\s\S]*?)\n\}/m)?.[1] ?? '')
  const dark = tokens(css.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/)?.[1] ?? '')
  for (const [mode, have] of [['light', light], ['dark', dark]] as const) {
    for (const [k, v] of Object.entries(derive(DEFAULT_PRIMARY, DEFAULT_ACCENT, mode))) assert.equal(have[k], v, `${mode} --${k}`)
  }
})

test('display formats: units, negatives, dates', () => {
  const p = (amountUnit: 'won' | 'thousand' | 'man', negative: 'minus' | 'paren' | 'red' = 'minus') => ({ amountUnit, negative, dateFormat: 'iso' as const })
  assert.equal(money(1_020_000, p('won')), '₩1,020,000')
  assert.equal(money(1_020_000, p('thousand')), '1,020천원')
  assert.equal(money(1_020_000, p('man')), '102만원')
  assert.equal(money(129_200, p('man')), '12.9만원')
  assert.equal(money(-12_000, p('won')), '−₩12,000')
  assert.equal(money(-12_000, p('won', 'paren')), '(₩12,000)')
  assert.equal(money(-12_000, p('won', 'red')), '−₩12,000')
  assert.equal(moneyClass(-12_000, p('won', 'red')), 'neg-amt')
  assert.equal(moneyClass(-12_000, p('won')), '')
  assert.equal(money(-0.4, p('won')), '₩0')
  const d = (dateFormat: 'iso' | 'dot' | 'us') => ({ amountUnit: 'won' as const, negative: 'minus' as const, dateFormat })
  assert.equal(dateText('2026-11-14', d('iso')), '2026-11-14')
  assert.equal(dateText('2026-11-14', d('dot')), '2026. 11. 14.')
  assert.equal(dateText('2026-11-14', d('us')), '11/14/2026')
  assert.equal(dateText(new Date(2026, 0, 5), d('dot')), '2026. 01. 05.')
})
