// Parsing and formatting for MoneyInput (spec 010 S-5, S-10). A text field replaces `type="number"`
// and must take every value that field took: integers, decimals, an exponent, a sign, zero, with or
// without thousands separators. Empty (and text no number input would hold) stays "empty".
// Pure: no DOM, tested without a database (tests/unit/money-input.test.ts).

export type Parsed = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'bad' }

const NUM = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

/** Thousands separators and spaces are dropped; the minus sign U+2212 counts as "-". */
const strip = (s: string) => s.replace(/[,\s_]/g, '').replace(/−/g, '-')

/** What the field means: nothing typed, a number, or text that is not a number (a number input holds "" for that). */
export function parseMoney(text: string): Parsed {
  const s = strip(text)
  if (s === '') return { kind: 'empty' }
  if (!NUM.test(s)) return { kind: 'bad' }
  const n = Number(s)
  if (!Number.isFinite(n)) return { kind: 'bad' }
  return { kind: 'ok', value: n === 0 ? 0 : n }
}

const group = (int: string) => int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** The text shown while typing: the whole part grouped by thousands, the rest as typed ("1234.50" → "1,234.50", "-" stays). */
export function groupMoney(text: string): string {
  const s = strip(text)
  const m = /^([+-]?)(\d*)(\.\d*)?$/.exec(s)
  if (!m) return text
  return `${m[1]}${group(m[2]!)}${m[3] ?? ''}`
}

/** A stored number as text: 1234567 → "1,234,567", 12.5 → "12.5", empty → "". */
export function moneyText(n: number | '' | null | undefined): string {
  if (n === '' || n === null || n === undefined || !Number.isFinite(n)) return ''
  const s = String(n)
  return /e/i.test(s) ? s : groupMoney(s)
}

/** The value the model holds for a parse: the number, or the field's "empty" (`''` or `null`) for empty and non-numbers. */
export function moneyValue(p: Parsed, empty: '' | null): number | '' | null {
  return p.kind === 'ok' ? p.value : empty
}

/** True when the model already says what the text says (so a model change that came from typing leaves the text alone). */
export function sameMoney(text: string, model: number | '' | null | undefined): boolean {
  const p = parseMoney(text)
  return p.kind === 'ok' ? model === p.value : model === '' || model === null || model === undefined
}
