// The bell's list and read marks (spec 013 S-20), read from the store. The list is buildNotices() over the state; the
// read marks stay in this browser only (localStorage; a blocked storage keeps them for this page only), so another
// browser or device starts unread. Shared by every bell (the phone bar's and the header's).
import { computed, ref } from 'vue'
import { ymd } from './calc'
import { goalCards, maturityCards, maturityKey } from './goals'
import { offDays } from './holidays-lazy'
import { buildNotices, keptMarks, unreadCount } from './notices'
import { store } from './store'
import { localToday } from './now'

const KEY = 'allot.notices.read'

function load(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
const read = ref<Set<string>>(load())

/** The notifications now. The yearly contribution needs the holidays only when dates move off them (as the goal check). */
export const notices = computed(() => {
  const now = ymd(localToday())
  const year = Number(now.slice(0, 4))
  const off: ReadonlySet<string> = (store.settings.dayShift ?? 'none') === 'none'
    ? new Set()
    : offDays(store.holidaySets, `${year - 1}-11-01`, `${year + 1}-03-01`) ?? new Set()
  return buildNotices(store, now, off, {
    proposals: store.pendingProposals,
    goalAccounts: goalCards.value.map((c) => c.alert.account.id),
    maturities: maturityCards.value.map((c) => maturityKey(c.alert.account.id, c.alert.month)),
  })
})

export const unread = computed(() => unreadCount(notices.value, read.value))
export const isRead = (id: string) => read.value.has(id)

function save(next: Set<string>) {
  read.value = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch { /* storage blocked: the marks last for this page only */ }
}

/** Mark one notice read (the marks of notices no longer listed are dropped then). */
export function markRead(id: string) {
  save(new Set([...keptMarks(notices.value, read.value), id]))
}
export function markAllRead() {
  save(new Set(notices.value.map((n) => n.id)))
}
