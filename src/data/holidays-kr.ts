// Built-in holiday set 'kr' (spec 007 S-9): the public holidays of the Republic of Korea as rules.
// Source: 「관공서의 공휴일에 관한 규정」 (대통령령) — 제2조 공휴일, 제3조 대체공휴일 — as amended
// 2013-11 (설날·추석·어린이날 대체, from 2014), 2021-07 (삼일절·광복절·개천절·한글날, from 2021-08)
// and 2023-05 (부처님오신날·기독탄신일, from 2023-05). Lunar dates use the Korean lunar calendar
// (RSCALE=DANGI, see src/lib/holidays.ts). Election days and one-off holidays have no rule: users add
// them as RDATE in a set of their own.
//
// substitute.on: the weekdays that move the holiday to the next business day; a holiday that falls
// on another holiday also moves. 설날·추석 count as one three-day block (제3조 제1항).
import type { HolidayRule } from './types'

export const KR_NAME = '대한민국 공휴일'
export const KR_NAME_EN = 'South Korea public holidays'

/** English names of the built-in holidays, by their Korean rule name (spec 008 S-9). */
export const KR_NAMES_EN: Record<string, string> = {
  '신정': "New Year's Day",
  '설날 전날': 'Day before Seollal',
  '설날': 'Seollal (Lunar New Year)',
  '설날 다음날': 'Day after Seollal',
  '삼일절': 'Independence Movement Day',
  '어린이날': "Children's Day",
  '부처님오신날': "Buddha's Birthday",
  '현충일': 'Memorial Day',
  '광복절': 'Liberation Day',
  '추석 전날': 'Day before Chuseok',
  '추석': 'Chuseok',
  '추석 다음날': 'Day after Chuseok',
  '개천절': 'National Foundation Day',
  '한글날': 'Hangul Day',
  '기독탄신일': 'Christmas Day',
}

export const KR_RULES: HolidayRule[] = [
  { name: '신정', rrule: 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1' },
  { name: '설날 전날', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=-1', substitute: { on: ['SU'], since: 2014 } },
  { name: '설날', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1', substitute: { on: ['SU'], since: 2014 } },
  { name: '설날 다음날', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=2', substitute: { on: ['SU'], since: 2014 } },
  { name: '삼일절', rrule: 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1', substitute: { on: ['SA', 'SU'], since: 2021 } },
  { name: '어린이날', rrule: 'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=5', substitute: { on: ['SA', 'SU'], since: 2014 } },
  { name: '부처님오신날', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=8', substitute: { on: ['SA', 'SU'], since: 2023 } },
  { name: '현충일', rrule: 'FREQ=YEARLY;BYMONTH=6;BYMONTHDAY=6' },
  { name: '광복절', rrule: 'FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=15', substitute: { on: ['SA', 'SU'], since: 2021 } },
  { name: '추석 전날', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=14', substitute: { on: ['SU'], since: 2014 } },
  { name: '추석', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=15', substitute: { on: ['SU'], since: 2014 } },
  { name: '추석 다음날', rrule: 'RSCALE=DANGI;FREQ=YEARLY;BYMONTH=8;BYMONTHDAY=16', substitute: { on: ['SU'], since: 2014 } },
  { name: '개천절', rrule: 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=3', substitute: { on: ['SA', 'SU'], since: 2021 } },
  { name: '한글날', rrule: 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=9', substitute: { on: ['SA', 'SU'], since: 2021 } },
  { name: '기독탄신일', rrule: 'FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25', substitute: { on: ['SA', 'SU'], since: 2023 } },
]

/** Built-in sets by id. Their rules ship with the app; a holiday_set row only turns one off. */
export const BUILTIN_SETS: Record<string, { name: string; rules: HolidayRule[] }> = {
  kr: { name: KR_NAME, rules: KR_RULES },
}
