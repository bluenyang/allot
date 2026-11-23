// Currency helpers for the screens (spec 013 S-23): which codes a picker offers, a code's rate and buffer, how a foreign
// amount reads, and how many items use a code. Pure: the pages pass in what the store holds.
import type { Currency, ForeignCurrency, PlanChange, Settings, Spending, Subscription } from '../data/types'
import { usd } from './calc'

/** Codes offered when adding a currency (any three capitals may be typed too). KRW and USD are not in the list. */
export const COMMON_CODES = ['EUR', 'JPY', 'CNY', 'GBP', 'CAD', 'AUD', 'CHF', 'HKD', 'SGD', 'TWD', 'THB', 'VND', 'PHP', 'NZD', 'SEK'] as const

/**
 * The codes a currency picker offers: KRW, USD, then the list in its order. `current` (the item's stored code) is kept
 * when it is not among them, so an item never loses its value in the editor.
 */
export function currencyCodes(list: readonly ForeignCurrency[], current?: Currency): Currency[] {
  const codes: Currency[] = ['KRW', 'USD', ...list.map((c) => c.code).filter((c) => c !== 'KRW' && c !== 'USD')]
  if (current && !codes.includes(current)) codes.push(current)
  return [...new Set(codes)]
}

/** A code's rate (KRW per unit) and buffer %: the settings' for USD, the list's for another code; null for KRW or an unknown code. */
export function rateFor(code: Currency, settings: Pick<Settings, 'fxRate' | 'fxBuffer'>, list: readonly ForeignCurrency[]): { rate: number; buffer: number } | null {
  if (code === 'KRW') return null
  if (code === 'USD') return { rate: settings.fxRate, buffer: settings.fxBuffer }
  const c = list.find((x) => x.code === code)
  return c ? { rate: c.rate, buffer: c.buffer } : null
}

/** A foreign amount as text: "$12.50" for USD (as before), "EUR 12.50" for another code. */
export const fxAmount = (code: Currency, n: number): string =>
  code === 'USD' ? usd(n) : `${code} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A charge as the lists show it: "KRW 9,900", "USD 12.50 +10%", "EUR 8.00". */
export function chargeLabel(p: { currency: Currency; amount: number; vat?: number }, num: (n: number) => string): string {
  if (p.currency === 'KRW') return `KRW ${num(p.amount)}`
  return `${p.currency} ${p.amount.toFixed(2)}${p.vat ? ` +${p.vat}%` : ''}`
}

/** How many subscriptions (a plan change to the code counts for its subscription) and spendings use `code`. */
export function currencyUses(code: Currency, subs: readonly Subscription[], changes: readonly PlanChange[], spendings: readonly Spending[]): { subs: number; spendings: number } {
  const ids = new Set(subs.filter((s) => s.currency === code).map((s) => s.id))
  for (const c of changes) if (c.to.currency === code) ids.add(c.subId)
  return { subs: ids.size, spendings: spendings.filter((s) => s.currency === code).length }
}

/** A typed code as the API takes it: trimmed, upper case. Whether it is three capitals is the API's rule (S-26). */
export const normalCode = (s: string) => s.trim().toUpperCase()

/** A rate as text, its decimals kept (a rate below 10 won, e.g. JPY, has them): "1,380", "9.05". */
export const rateNum = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
