// Korean messages of the goal cards of Pending changes (spec 013 W-8). Loaded with the first screen
// (merged in src/i18n/index.ts); kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const goalsKo = {
  goals: {
    title: '목표 도달',
  },
} as const

export type GoalsMessages = Widen<typeof goalsKo>
