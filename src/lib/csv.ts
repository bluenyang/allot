// CSV export (spec 013 S-17): built in the browser from the state it holds (no server round trip), RFC 4180 —
// fields separated by commas, records by CRLF, a field with a comma, a quote or a line break in double quotes
// with its quotes doubled — and a UTF-8 BOM first, so a spreadsheet opens the Korean text right. Numbers are
// written as plain digits (no thousands separators, no unit). `toCsv` is pure; `downloadCsv` hands the file to
// the browser.
export type CsvCell = string | number | null | undefined

const BOM = '﻿'

/**
 * One field. A text that a spreadsheet would read as a formula (it starts with =, +, -, @, a tab or a CR) gets a
 * leading apostrophe, so a name never runs as one when the file is opened (OWASP "CSV injection"); numbers stay
 * numbers.
 */
export function csvField(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (typeof v === 'number') s = Number.isFinite(v) ? plainNumber(v) : ''
  else s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** A number as plain digits: `1234567`, `-500`, `12.5` — never `1.2e+21` or `1,234`. */
function plainNumber(n: number): string {
  if (Number.isInteger(n)) return BigInt(n).toString()
  const s = String(n)
  return /e/i.test(s) ? n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '') : s
}

/** The whole file: the BOM, then each row as one CRLF-terminated record. */
export function toCsv(rows: CsvCell[][]): string {
  return BOM + rows.map((r) => r.map(csvField).join(',') + '\r\n').join('')
}

/** Save the rows as a file in the browser (a Blob and a link; nothing leaves the machine). */
export function downloadCsv(name: string, rows: CsvCell[][]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
