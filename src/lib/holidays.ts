// Holiday rule sets (spec 007 S-9). Pure: shared by the server (validation) and the front end.
// Gregorian rules go to rrule-temporal; Korean lunar rules (RSCALE=DANGI) are ours, because the
// library does not know DANGI and would silently compute them as Gregorian.
import { RRuleTemporal } from 'rrule-temporal'

const DAY = /^-?\d{1,2}$/

/** Split an RRULE body (FREQ=YEARLY;BYMONTH=1;…) into upper-case keys. */
export function parseRule(rrule: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of rrule.trim().replace(/^RRULE:/i, '').split(';')) {
    if (!part) continue
    const i = part.indexOf('=')
    out.set((i < 0 ? part : part.slice(0, i)).trim().toUpperCase(), i < 0 ? '' : part.slice(i + 1).trim().toUpperCase())
  }
  return out
}

const GREGORIAN_KEYS = new Set(['FREQ', 'RSCALE', 'BYMONTH', 'BYMONTHDAY', 'BYDAY', 'BYSETPOS', 'INTERVAL', 'SKIP'])
const DANGI_KEYS = new Set(['FREQ', 'RSCALE', 'BYMONTH', 'BYMONTHDAY'])

/** Why this RRULE body cannot be a holiday rule, or null when it can. */
export function ruleProblem(rrule: string): string | null {
  if (rrule.length > 200) return '규칙이 너무 길어요.'
  const r = parseRule(rrule)
  if (r.get('FREQ') !== 'YEARLY') return '공휴일 규칙은 FREQ=YEARLY만 쓸 수 있어요.'
  const scale = r.get('RSCALE') ?? 'GREGORIAN'
  if (scale === 'DANGI') {
    for (const k of r.keys()) if (!DANGI_KEYS.has(k)) return `음력 규칙(RSCALE=DANGI)에는 ${k}를 쓸 수 없어요.`
    const m = r.get('BYMONTH') ?? ''
    const d = r.get('BYMONTHDAY') ?? ''
    if (!/^\d{1,2}$/.test(m) || +m < 1 || +m > 12) return '음력 규칙의 BYMONTH는 1~12 하나예요(윤달은 쓸 수 없어요).'
    if (!DAY.test(d) || +d === 0 || +d > 30 || +d < -2) return '음력 규칙의 BYMONTHDAY는 1~30 또는 -1, -2 하나예요.'
    return null
  }
  if (scale !== 'GREGORIAN') return `RSCALE=${scale}는 쓸 수 없어요. 양력은 생략, 음력은 DANGI예요.`
  for (const k of r.keys()) if (!GREGORIAN_KEYS.has(k)) return `규칙에 ${k}를 쓸 수 없어요.`
  // The library accepts some out-of-range values silently (BYMONTH=13 gives no date): check them here.
  const list = (k: string) => (r.get(k) ?? '').split(',').filter(Boolean)
  const intIn = (v: string, lo: number, hi: number) => /^[+-]?\d+$/.test(v) && +v !== 0 && Math.abs(+v) >= lo && Math.abs(+v) <= hi
  if (list('BYMONTH').some((v) => !/^\d+$/.test(v) || +v < 1 || +v > 12)) return 'BYMONTH는 1~12예요.'
  if (list('BYMONTHDAY').some((v) => !intIn(v, 1, 31))) return 'BYMONTHDAY는 1~31 또는 -1~-31이에요.'
  if (list('BYDAY').some((v) => !/^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/.test(v))) return 'BYDAY는 MO~SU, 몇째 주는 1MO·-1FR처럼 써요.'
  if (list('BYSETPOS').some((v) => !intIn(v, 1, 366))) return 'BYSETPOS 값이 범위를 벗어났어요.'
  if (r.has('INTERVAL') && !/^[1-9]\d?$/.test(r.get('INTERVAL')!)) return 'INTERVAL은 1~99예요.'
  try {
    const rule = new RRuleTemporal({ rruleString: `DTSTART;VALUE=DATE:20000101\nRRULE:${[...r].map(([k, v]) => `${k}=${v}`).join(';')}` })
    // 2000 is a leap year, so 2/29 rules count; four years cover every yearly rule with INTERVAL ≤ 4.
    if (!rule.between(new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2003, 11, 31)), true).length) return '이 규칙으로는 날짜가 나오지 않아요.'
  } catch (e) {
    return `규칙을 읽지 못했어요: ${(e as Error).message}`
  }
  return null
}
