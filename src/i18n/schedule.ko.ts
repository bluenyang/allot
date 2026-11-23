// Korean messages of the time zone and own monthly dates (spec 013 rc.3 W-18).
// Merged in src/i18n/index.ts; kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const scheduleKo = {
  schedule: {
    title: '기준 일정',
    tzHint: '화면의 "오늘"·"이번 달"과 AI 도구가 이 시간대를 따라요',
    tzSaved: '시간대를 바꿨어요',
  },
} as const

export type ScheduleMessages = Widen<typeof scheduleKo>
