// The display formats bound to the signed-in user's settings (spec 007 S-8): what pages call.
import { dateText, money, moneyClass } from './format'
import { store } from './store'

export const fmtMoney = (n: number) => money(n, store.preferences)
export const fmtMoneyClass = (n: number) => moneyClass(n, store.preferences)
export const fmtDate = (d: string | Date) => dateText(d, store.preferences)
