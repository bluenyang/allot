// The 지출 page's lazily loaded messages (spec 011 V-8): the 일반 and 할부 tabs, the editors and the payoff dialog
// speak through keys that are not in the first screen's bundle. The page loader awaits `loadSpendingMessages()`
// before the page renders; both languages are merged, so a language switch later needs no new load.
import { i18n } from './index'

let loading: Promise<void> | null = null

export function loadSpendingMessages(): Promise<void> {
  loading ??= Promise.all([import('./spending.ko'), import('./spending.en')])
    .then(([ko, en]) => {
      i18n.global.mergeLocaleMessage('ko', ko.spendingKo)
      i18n.global.mergeLocaleMessage('en', en.spendingEn)
    })
    .catch((e) => { loading = null; throw e })
  return loading
}
