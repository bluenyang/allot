// The bell's list and read marks (spec 013 S-20), read from the store. The list is buildNotices() over the state; the
// read marks are the account's (spec 016 S-1, src/lib/notice-marks.ts), so every browser and device shows the same.
// Shared by every bell (the phone bar's and the header's).
import { computed } from 'vue'
import { needsHolidays, ymd } from './calc'
import { goalCards, maturityCards, maturityKey } from './goals'
import { offDays } from './holidays-lazy'
import { buildNotices, keptMarks, unreadCount } from './notices'
import { store } from './store'
import { localToday } from './now'
import { marks, saveMarks } from './notice-marks'

/** The notifications now. The yearly contribution needs the holidays only when dates move off them (as the goal check). */
export const notices = computed(() => {
  const now = ymd(localToday())
  const year = Number(now.slice(0, 4))
  const off: ReadonlySet<string> = !needsHolidays(store.settings, store.schedules)
    ? new Set()
    : offDays(store.holidaySets, `${year - 1}-11-01`, `${year + 1}-03-01`) ?? new Set()
  return buildNotices(store, now, off, {
    proposals: store.pendingProposals,
    goalAccounts: goalCards.value.map((c) => c.alert.account.id),
    maturities: maturityCards.value.map((c) => maturityKey(c.alert.account.id, c.alert.month)),
  })
})

export const unread = computed(() => unreadCount(notices.value, marks.read))
export const isRead = (id: string) => marks.read.has(id)

/** The read marks of notices no longer listed: dropped when a mark is saved (as before, `keptMarks`). */
const stale = () => {
  const kept = new Set(keptMarks(notices.value, marks.read))
  return [...marks.read].filter((id) => !kept.has(id))
}

/** Mark one notice read (the marks of notices no longer listed are dropped then). */
export function markRead(id: string) {
  void saveMarks({ read: { add: [id], drop: stale() } })
}
export function markAllRead() {
  void saveMarks({ read: { add: notices.value.map((n) => n.id), drop: stale() } })
}
