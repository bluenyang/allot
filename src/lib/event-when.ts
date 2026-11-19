// The 시기 of a schedule event (spec 010 S-9, S-10): what the form takes is what it took before —
// `YYYY-MM` or `YYYY-MM~MM` (same year; the end may be before the start). Pure; no UI.
export type WhenMode = 'one' | 'range' | 'raw'
export interface WhenParts { mode: WhenMode; one: string; from: string; to: string; raw: string }

/** The pattern the server and the form accept. */
export const WHEN_RE = /^\d{4}-\d{2}(~\d{2})?$/

/** Split a stored value into the form's fields; a value that fits neither shape stays as text (`raw`). */
export function whenParts(when: string): WhenParts {
  // What a month picker can hold exactly: a year from 0001 and a month 01..12. `2027-13`, `2027-00`, `0000-01`,
  // `2027-11~99` fit the server's pattern but not a picker: they stay as text, verbatim.
  const one = /^((?!0000)\d{4}-(?:0[1-9]|1[0-2]))$/.exec(when)
  if (one) return { mode: 'one', one: one[1]!, from: one[1]!, to: one[1]!, raw: when }
  const range = /^((?!0000)\d{4})-(0[1-9]|1[0-2])~(0[1-9]|1[0-2])$/.exec(when)
  if (range) return { mode: 'range', one: `${range[1]}-${range[2]}`, from: `${range[1]}-${range[2]}`, to: `${range[1]}-${range[3]}`, raw: when }
  return { mode: 'raw', one: '', from: '', to: '', raw: when }
}

/** The stored string for the form's fields; `crossYear` when a range ends in another year (not stored yet). */
export function composeWhen(p: WhenParts): { when: string; crossYear: boolean } {
  if (p.mode === 'one') return { when: p.one, crossYear: false }
  if (p.mode === 'raw') return { when: p.raw, crossYear: false }
  if (/^\d{4}-\d{2}$/.test(p.from) && /^\d{4}-\d{2}$/.test(p.to) && p.from.slice(0, 4) !== p.to.slice(0, 4)) return { when: '', crossYear: true }
  return { when: /^\d{4}-\d{2}$/.test(p.to) ? `${p.from}~${p.to.slice(5)}` : p.from, crossYear: false }
}
