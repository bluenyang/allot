// Korean messages of accounts, balance records and cards on the Salary allocation page (spec 013 W-5, W-6, W-11). Loaded with the first screen
// (merged in src/i18n/index.ts); kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const accountsKo = {
  accounts: {
    title: '통장',
  },
} as const

export type AccountsMessages = Widen<typeof accountsKo>
