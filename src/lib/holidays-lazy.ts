// The holiday code (rrule-temporal and the Temporal polyfill) is large, so the first screen does not
// carry it (spec 007 V-1): it is fetched the first time a holiday is needed — a calendar, the
// holiday settings, or monthly dates with a weekend/holiday shift other than 'none'.
import { shallowRef } from 'vue'
import type * as H from './holidays'
import type { HolidaySet } from '../data/types'

const mod = shallowRef<typeof H | null>(null)
let loading: Promise<typeof H> | null = null

export function loadHolidays(): Promise<typeof H> {
  loading ??= import('./holidays').then((m) => (mod.value = m))
  return loading
}

/**
 * Holiday dates of the sets that are on, between two YYYY-MM-DD dates; null until the code is
 * here (it starts loading on the first call). Reactive: callers in computed() update when it lands.
 */
export function offDays(sets: HolidaySet[], from: string, to: string): Set<string> | null {
  const m = mod.value
  if (!m) { void loadHolidays(); return null }
  return new Set(m.holidaysIn(m.enabledSets(sets), from, to).map((h) => h.date))
}
