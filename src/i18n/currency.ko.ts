// Korean messages of the currency list and rate refresh (spec 013 rc.3 W-19).
// Merged in src/i18n/index.ts; kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const currencyKo = {
  currency: {
    title: '통화',
  },
} as const

export type CurrencyMessages = Widen<typeof currencyKo>
