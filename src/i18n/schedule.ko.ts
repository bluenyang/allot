// Korean messages of the time zone and own monthly dates (spec 013 rc.3 W-18).
// Merged in src/i18n/index.ts; kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const scheduleKo = {
  schedule: {
    title: '기준 일정',
  },
} as const

export type ScheduleMessages = Widen<typeof scheduleKo>
