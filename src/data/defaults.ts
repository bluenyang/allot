// What a new account starts with before it saves anything (spec 006 S-7). Shared by the API
// (/api/state answers these when the rows do not exist yet) and the front end's empty store.
// Every value passes the settings rules (server/validation.ts), so the first save works as is:
// the exchange rate must be above 0.
import type { Living, Preferences, Settings } from './types'

export const DEFAULT_SETTINGS: Settings = { netPay: 0, fxRate: 1400, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000, dayShift: 'none' }
export const DEFAULT_LIVING: Living = { food: 0, transit: 0, allowance: 0 }
/** Display settings before the first save (spec 007): the canvas defaults. */
export const DEFAULT_PREFERENCES: Preferences = {
  themeMode: 'system', primary: null, accent: null, radius: 'base', density: 'base',
  dateFormat: 'iso', amountUnit: 'won', negative: 'minus',
}
