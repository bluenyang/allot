// "Today" on the screen, in the user's time zone (spec 013 S-22): the display setting, Asia/Seoul when it is not set.
// calc.ts stays pure (it takes the zone); this reads it from the store. Read inside a computed, it follows a change.
import { todayIn } from './calc'
import { store } from './store'

export const localToday = (): Date => todayIn(store.preferences.timezone)
