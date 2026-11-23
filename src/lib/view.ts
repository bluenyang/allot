// Screen state shared by the shell and the pages (spec 007 S-15): the dashboard's month (the header
// moves it). `notReady` is the short "준비 중" toast for controls that are drawn from the design but
// have no feature yet; it goes through the shell's toast (spec 010 S-5).
import { reactive, watch } from 'vue'
import { t, type MessageKey } from '../i18n'
import { ymOf } from './calc'
import { showToast } from './toast'
import { localToday } from './now'
import { status } from './store'

export const view = reactive({ ym: ymOf(localToday()) })

// "This month" is the month of the user's time zone (spec 013 S-22). The module loads before the state does, so the
// value above is in the default zone; once a session's state has loaded (the zone is known), it starts again from
// that session's today (review rc3-1 F-3). Later loads (after a save) leave the month the user moved to alone.
watch(() => status.loaded, (loaded) => { if (loaded) view.ym = ymOf(localToday()) }, { flush: 'sync' })

/** Say that a control is not there yet (it is drawn as in the design). `what` is a message key. */
export function notReady(what: MessageKey) {
  showToast(t('shell.notReady', { what: t(what) }), { ms: 2500 })
}
