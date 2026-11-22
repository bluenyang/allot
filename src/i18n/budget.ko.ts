// Korean messages of the Living, Savings and Investment pages (spec 013 W-3, W-4). Loaded with the first screen
// (merged in src/i18n/index.ts); kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const budgetKo = {
  budget: {
    title: '예산',
  },
} as const

export type BudgetMessages = Widen<typeof budgetKo>
