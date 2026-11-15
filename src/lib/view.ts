// Screen state shared by the shell and the pages (spec 007 S-15): the dashboard's month (the header
// moves it) and the short "준비 중" notice for controls drawn from the design that have no feature yet.
import { reactive } from 'vue'
import { today, ymOf } from './calc'

export const view = reactive({ ym: ymOf(today()), notice: '' })

let timer: ReturnType<typeof setTimeout> | undefined
/** Say that a control is not there yet (the user chose "모양만 그대로" for these). */
export function notReady(what: string) {
  view.notice = `${what}: 준비 중이에요.`
  clearTimeout(timer)
  timer = setTimeout(() => { view.notice = '' }, 2500)
}
