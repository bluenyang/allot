// Parsing and formatting for MoneyInput (spec 010 S-5, S-10). A text field replaces `type="number"`
// and must take every value that field took: integers, decimals, an exponent, a sign, zero, with or
// without thousands separators. Empty (and text no number input would hold) stays "empty".
// Pure: no DOM, tested without a database (tests/unit/money-input.test.ts).

export type Parsed = { kind: 'empty' } | { kind: 'ok'; value: number } | { kind: 'bad' }

// Why separators are strict (spec 010 S-10, review A-2): a type="number" field holds "" for text that is not
// a number, and a browser's number input does not read "1,00" or "12,50" as 100 or 1250. So a comma is
// accepted only as thousands grouping of the whole part ("1,000", "1,234,567", also with spaces); any other
// comma, and underscores, make the text "not a number" = the field's empty value (+ aria-invalid), exactly what
// the number field reports today. Nothing the number field accepted is refused: it accepted no commas at all.
const NUM = /^([+-]?)(\d{1,3}(?:[, ]\d{3})+|\d+)?(\.\d*)?(e[+-]?\d+)?$/i

/** The minus sign U+2212 counts as "-". */
const norm = (s: string) => s.trim().replace(/\u2212/g, '-')
const SEP = /[, ]/g

/** What the field means: nothing typed, a number, or text that is not a number (a number input holds "" for that). */
export function parseMoney(text: string): Parsed {
  const s = norm(text)
  if (s === '') return { kind: 'empty' }
  const m = NUM.exec(s)
  if (!m || (m[2] === undefined && (m[3] === undefined || m[3] === '.'))) return { kind: 'bad' }
  if (m[4] !== undefined && m[2] === undefined && m[3] === undefined) return { kind: 'bad' }
  const n = Number(`${m[1]}${(m[2] ?? '').replace(SEP, '')}${m[3] ?? ''}${m[4] ?? ''}`)
  if (!Number.isFinite(n)) return { kind: 'bad' }
  return { kind: 'ok', value: n === 0 ? 0 : n }
}

const group = (int: string) => int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** The text shown while typing: the whole part grouped by thousands, the rest as typed ("1234.50" → "1,234.50", "-" stays). */
export function groupMoney(text: string): string {
  const s = norm(text).replace(SEP, '')
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

const nonSep = (s: string) => s.replace(SEP, '').length
const canonical = (t: string) => t === '' || groupMoney(t) === t

/**
 * The field's text after an edit. `prev` is the text before, `raw` what the input holds now, `caret` its caret,
 * `inputType` the InputEvent type. Typing or deleting in a grouped number regroups it ("1,234" + 5 → "12,345");
 * a paste or any text with a comma not in thousands position is kept as it is and reads as "not a number".
 * Deleting a generated separator (Delete before "1|,234", Backspace after it) removes the neighbouring digit instead.
 */
export function editMoney(prev: string, raw: string, caret: number, inputType = ''): { text: string; caret: number } {
  let i = 0
  while (i < prev.length && i < raw.length && prev[i] === raw[i]) i++
  let j = 0
  while (j < prev.length - i && j < raw.length - i && prev[prev.length - 1 - j] === raw[raw.length - 1 - j]) j++
  const removed = prev.slice(i, prev.length - j)
  const added = raw.slice(i, raw.length - j)
  let base = raw
  let at = caret
  if (/^delete/.test(inputType) && added === '' && removed.length === 1 && /[, ]/.test(removed) && canonical(prev)) {
    const k = inputType.endsWith('Forward') ? i : i - 1
    if (k >= 0 && k < raw.length) { base = raw.slice(0, k) + raw.slice(k + 1); at = k }
  }
  const text = canonical(prev) && !/[, ]/.test(added) ? groupMoney(base) : parseMoney(base).kind === 'ok' ? groupMoney(base) : base
  const want = nonSep(base.slice(0, at))
  let n = 0, pos = 0
  while (pos < text.length && n < want) { if (!/[, ]/.test(text[pos]!)) n++; pos++ }
  return { text, caret: at >= base.length ? text.length : pos }
}
