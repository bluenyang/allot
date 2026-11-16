// Screen state shared by the shell and the pages (spec 007 S-15): the dashboard's month (the header
// moves it) and the short "준비 중" notice for controls drawn from the design that have no feature yet.
import { reactive } from 'vue'
import { t, type MessageKey } from '../i18n'
import { today, ymOf } from './calc'

export const view = reactive({ ym: ymOf(today()), notice: '' })

let timer: ReturnType<typeof setTimeout> | undefined
/** Say that a control is not there yet (it is drawn as in the design). `what` is a message key. */
export function notReady(what: MessageKey) {
  view.notice = t('shell.notReady', { what: t(what) })
  clearTimeout(timer)
  timer = setTimeout(() => { view.notice = '' }, 2500)
}
