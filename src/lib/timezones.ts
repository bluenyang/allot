// The time zone picker of 설정 › 일반 (spec 013 S-22): every IANA zone the browser knows, each with its UTC offset now.
// Pure (no store, no DOM): the unit tests pass the list and the moment.
import { DEFAULT_TIMEZONE } from './calc'

/** The UTC offset of `tz` at `at`, as 'UTC+09:00' ('UTC+00:00' for UTC itself); null for a zone this runtime does not know. */
export function utcOffset(tz: string, at: Date = new Date()): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value
    if (!part) return null
    const off = part.replace(/^GMT/, '')
    return `UTC${off || '+00:00'}`
  } catch {
    return null
  }
}

/** "Asia/Seoul (UTC+09:00)"; the bare name when the offset is unknown. */
export function zoneLabel(tz: string, at: Date = new Date()): string {
  const off = utcOffset(tz, at)
  return off ? `${tz} (${off})` : tz
}

/** The zones this browser lists (empty when it cannot list them). */
export function supportedZones(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    return f ? f('timeZone') : []
  } catch {
    return []
  }
}

/**
 * The picker's options: the listed zones, plus the default zone and the saved one when the list lacks them (a zone the
 * browser does not list still shows and stays saved — no refusal), sorted by name.
 */
export function zoneOptions(saved: string | null | undefined, listed: readonly string[], at: Date = new Date()): { value: string; label: string }[] {
  const names = new Set(listed)
  names.add(DEFAULT_TIMEZONE)
  if (saved) names.add(saved)
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((z) => ({ value: z, label: zoneLabel(z, at) }))
}
