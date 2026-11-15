// The holiday-set editor's rows (spec 007 S-9, review 1 R7): one row per rule, with the fields the
// screen edits. A row keeps the rule it came from, so fields the screen does not show (EXDATE, the
// substitute's `since`, an RDATE next to an RRULE) survive an edit.
import type { HolidayRule } from '../data/types'

export type SubChoice = '' | 'SU' | 'SA' | 'SA,SU'
export interface RuleRow { name: string; kind: 'rrule' | 'dates'; rrule: string; dates: string; sub: SubChoice; orig?: HolidayRule }

const subOf = (r: HolidayRule): SubChoice => (r.substitute ? ([...r.substitute.on].sort().join(',') as SubChoice) : '')

export const emptyRow = (): RuleRow => ({ name: '', kind: 'dates', rrule: '', dates: '', sub: '' })

export const toRows = (rules: HolidayRule[]): RuleRow[] => rules.map((r) => ({
  name: r.name, kind: r.rrule ? 'rrule' : 'dates', rrule: r.rrule ?? '', dates: (r.rdate ?? []).join(', '), sub: subOf(r), orig: r,
}))

export function toRules(rows: RuleRow[]): HolidayRule[] {
  return rows.map((row) => {
    const { substitute: oldSub, rrule: _r, rdate: oldDates, ...rest } = row.orig ?? { name: '' }
    const rule: HolidayRule = { ...rest, name: row.name.trim() }
    if (row.kind === 'rrule') {
      rule.rrule = row.rrule.trim()
      if (oldDates?.length) rule.rdate = oldDates // an RRULE row does not show its extra dates: keep them
    } else {
      rule.rdate = row.dates.split(/[,\s]+/).filter(Boolean)
    }
    if (row.sub) rule.substitute = { on: row.sub.split(',') as ('SA' | 'SU')[], ...(oldSub?.since ? { since: oldSub.since } : {}) }
    return rule
  })
}
