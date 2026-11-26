// English messages of the time zone and own monthly dates (spec 013 rc.3 W-18), typed against the Korean list (schedule.ko.ts).
import type { ScheduleMessages } from './schedule.ko'

export const scheduleEn: ScheduleMessages = {
  schedule: {
    title: 'Own dates',
    tzHint: '"Today" and "this month" on every screen and in the AI tools follow this time zone',
    tzSaved: 'Time zone changed',
    listLabel: 'My own dates',
    monthlyN: 'Day {n} of every month',
    editLabel: 'Edit {name}',
    noAccount: 'No account',
    addTitle: 'Add a date',
    editTitle: 'Edit the date',
    desc: 'A day that comes back every month, besides pay, transfer and card billing. It shows on the calendar and the schedule, and moves off weekends and holidays the way you pick below. No amount is kept.',
    name: 'Name',
    namePh: 'e.g. Maintenance fee',
    needName: 'Enter a name',
    day: 'Day of the month',
    dayOf: 'Day {n}',
    dayHint: 'A day a month does not have (such as the 31st) is that month\'s last day',
    account: 'Account',
    accountNone: 'None',
    direction: 'Money',
    dirIn: 'Money in',
    dirOut: 'Money out',
    note: 'Note',
    foot: 'Saved to the change history',
    kind: {
      in: 'In',
      out: 'Out',
    },
  },
}
