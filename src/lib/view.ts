// Screen state shared by the shell and the pages (spec 007 S-15): the dashboard's month (the header
// moves it). `notReady` is the short "준비 중" toast for controls that are drawn from the design but
// have no feature yet; it goes through the shell's toast (spec 010 S-5).
import { reactive } from 'vue'
import { t, type MessageKey } from '../i18n'
import { today, ymOf } from './calc'
import { showToast } from './toast'

export const view = reactive({ ym: ymOf(today()) })

/** Say that a control is not there yet (it is drawn as in the design). `what` is a message key. */
export function notReady(what: MessageKey) {
  showToast(t('shell.notReady', { what: t(what) }), { ms: 2500 })
}
