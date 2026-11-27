// Screen state shared by the shell and the pages (spec 007 S-15): the dashboard's month (the header
// moves it). `notReady` is the short "준비 중" toast for controls that are drawn from the design but
// have no feature yet; it goes through the shell's toast (spec 010 S-5).
import { reactive, watch } from 'vue'
import { t, type MessageKey } from '../i18n'
import { showToast } from './toast'
import { monthKey, thisMonthKey, thisYm } from './month'
import { status } from './store'

export const view = reactive({ ym: thisYm() })

// "This month" is the month of the user's time zone (spec 013 S-22) and month basis (spec 018 S-3: the month whose period
// holds today). The module loads before the state does, so the value above is in the default zone and by the calendar;
// once a session's state has loaded (the zone and the basis are known), it starts again from that session's today
// (review rc3-1 F-3). Later loads (after a save) leave the month the user moved to alone.
watch(() => status.loaded, (loaded) => { if (loaded) view.ym = thisYm() }, { flush: 'sync' })
// When the user changes what a month is (spec 018 S-3, S-4), the month looked at goes back to this month: the name of
// today's month may be another one now.
watch(monthKey, () => { if (status.loaded) view.ym = thisYm() }, { flush: 'sync' })
// The holiday dates come after the first screen (their code is loaded lazily) and a holiday set can be edited: with a
// pay basis whose pay date a holiday moves, this month can then be another month than the one worked out before
// (review 2 F-1). The month looked at follows it as long as it still is what "this month" was; a month the user moved
// to stays.
watch(thisMonthKey, (_now, was) => { if (status.loaded && view.ym === was.slice(0, 7)) view.ym = thisYm() }, { flush: 'sync' })

/** Say that a control is not there yet (it is drawn as in the design). `what` is a message key. */
export function notReady(what: MessageKey) {
  showToast(t('shell.notReady', { what: t(what) }), { ms: 2500 })
}
