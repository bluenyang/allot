// review 1 R7: the holiday-set editor keeps every rule field through an edit.
//   pnpm test:unit
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toRows, toRules } from '../../src/lib/holiday-rows'
import type { HolidayRule } from '../../src/data/types'

const rules: HolidayRule[] = [
  { name: '반복', rrule: 'FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=17', rdate: ['2031-01-02'], exdate: ['2030-07-17'], substitute: { on: ['SA'], since: 2025 } },
  { name: '날짜', rdate: ['2031-02-03', '2031-02-04'], exdate: ['2031-02-04'], substitute: { on: ['SA', 'SU'] } },
  { name: '대체 없음', rrule: 'FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1' },
]

test('unchanged rows give back the same rules', () => {
  assert.deepEqual(toRules(toRows(rules)), rules)
})

test('editing a name or a substitute keeps the fields the screen does not show', () => {
  const rows = toRows(rules)
  rows[0]!.name = '반복2'
  rows[1]!.sub = 'SU'
  const out = toRules(rows)
  assert.deepEqual(out[0], { ...rules[0], name: '반복2' })
  assert.deepEqual(out[1], { ...rules[1], substitute: { on: ['SU'] } })
  rows[2]!.sub = 'SA'
  assert.deepEqual(toRules(rows)[2]!.substitute, { on: ['SA'] })
})

test('switching a row from dates to a rule and back', () => {
  const rows = toRows([rules[1]!])
  rows[0]!.kind = 'rrule'
  rows[0]!.rrule = 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=3'
  const r = toRules(rows)[0]!
  assert.equal(r.rrule, 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=3')
  assert.deepEqual(r.exdate, ['2031-02-04'])
})
