import { reactive } from 'vue'
import type {
  Account, AllocationTarget, Balance, Card, CheckItem, Debt, ForeignCurrency, HolidaySet, Living, LivingItem, Phase, PlanChange, PlanEvent, Preferences, Priced,
  RemainderSplit, ScheduleItem, Settings, MonthAdjust, Spending, Subscription,
} from '../data/types'
import { priced } from './calc'
import { ApiError, api } from './api'
import { t } from '../i18n'
import { createSessionGuard, type Scope } from './session-guard'
import { DEFAULT_LIVING, DEFAULT_PREFERENCES, DEFAULT_SETTINGS } from '../data/defaults'

// App state comes from the API (PostgreSQL). Every change goes to the API first;
// the store is updated from the server's answer, so what you see is what is saved.
export interface State {
  settings: Settings
  /** The old living row, from the three coded living items (spec 013 S-2). */
  living: Living
  livingItems: LivingItem[]
  balances: Balance[]
  cards: Card[]
  monthAdjusts: MonthAdjust[]
  /** Foreign currencies other than USD (spec 013 S-23) and the user's own monthly dates (S-22). */
  currencies: ForeignCurrency[]
  schedules: ScheduleItem[]
  targets: AllocationTarget[]
  subscriptions: Subscription[]
  planChanges: PlanChange[]
  phases: Phase[]
  events: PlanEvent[]
  checks: CheckItem[]
  accounts: Account[]
  debts: Debt[]
  remainderSplit: RemainderSplit[]
  preferences: Preferences
  holidaySets: HolidaySet[]
  spendings: Spending[]
  /** Proposals from an AI key that wait for the user (the sidebar badge; spec 009). */
  pendingProposals: number
}

const empty = (): State => ({
  settings: { ...DEFAULT_SETTINGS },
  living: { ...DEFAULT_LIVING },
  preferences: { ...DEFAULT_PREFERENCES },
  targets: [], subscriptions: [], planChanges: [], phases: [], events: [], checks: [], accounts: [], debts: [], remainderSplit: [], holidaySets: [], spendings: [],
  livingItems: [], balances: [], cards: [], monthAdjusts: [], currencies: [], schedules: [], pendingProposals: 0,
})

export const store = reactive<State>(empty())
export const status = reactive({ loaded: false, loading: false, error: '' })

// The state belongs to the signed-in session. `newSession` (called when the session changes) kills every
// load and save that started before it (src/lib/session-guard.ts): a stale answer, error or recovery
// reload never reaches the next account's store. Every write after an await goes through a scope.
const guard = createSessionGuard()
export const newSession = () => guard.next()
/** The current session, noted when a screen's save starts: a save that runs several requests checks it before each one (spec 010 A-20). */
export const sessionScope = (): Scope => guard.begin()

export async function loadState() {
  const s = guard.begin()
  s.ifCurrent(() => { status.loading = true })
  try {
    const next = await api<State>('GET', '/api/state')
    s.ifCurrent(() => {
      Object.assign(store, next)
      status.loaded = true
      status.error = ''
    })
  } catch (e) {
    s.ifCurrent(() => { status.error = message(e) })
  } finally {
    s.ifCurrent(() => { status.loading = false })
  }
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : t('api.offline'))

/** Run a save; on failure show the error and reload, so the screen never shows unsaved values. The writes go through `s`. */
async function save<T>(run: (s: Scope) => Promise<T>): Promise<T> {
  const s = guard.begin()
  try {
    const r = await run(s)
    s.ifCurrent(() => { status.error = '' })
    return r
  } catch (e) {
    if (s.alive()) {
      const msg = message(e)
      await loadState() // put the saved values back on screen…
      s.ifCurrent(() => { status.error = msg }) // …and keep saying why the change did not stick
    }
    throw e
  }
}

export const RESOURCES = {
  subscriptions: '/api/subscriptions',
  planChanges: '/api/plan-changes',
  phases: '/api/phases',
  events: '/api/events',
  checks: '/api/checks',
  accounts: '/api/accounts',
  debts: '/api/debts',
  remainderSplit: '/api/remainder-split',
  targets: '/api/targets',
  holidaySets: '/api/holiday-sets',
  spendings: '/api/spendings',
  livingItems: '/api/living-items',
  balances: '/api/balances',
  cards: '/api/cards',
  monthAdjusts: '/api/month-adjusts',
  currencies: '/api/currencies',
  schedules: '/api/schedules',
} as const

/** Lists whose delete also changes other rows on the server (unlinks, spec 013 S-9, S-13): reload the state after one. */
const RELOAD_AFTER_DELETE: readonly ListKey[] = ['accounts', 'cards', 'livingItems', 'phases'] // a phase takes its item amounts (review 1 F-6)
export type ListKey = keyof typeof RESOURCES

/** Create (no id) or replace an item; returns the saved item. */
export function saveItem<K extends ListKey>(key: K, item: State[K][number]): Promise<State[K][number]> {
  return save(async (s) => {
    const { id, ...body } = item as { id: string }
    const saved = await api<{ id: string }>(id ? 'PUT' : 'POST', id ? `${RESOURCES[key]}/${id}` : RESOURCES[key], body)
    s.ifCurrent(() => {
      // the list is read now, after the answer: the store may have been loaded again meanwhile
      const list = store[key] as { id: string }[]
      const i = list.findIndex((x) => x.id === saved.id)
      if (i >= 0) list[i] = saved
      else list.push(saved)
      // Mirrors the server: a target whose kind takes no phase amounts loses them (spec 013 S-3).
      if (key === 'targets' && !['fixed', 'saving', 'invest'].includes((saved as { kind?: string }).kind ?? '')) {
        for (const p of store.phases) delete p.amounts[saved.id]
      }
    })
    return saved as State[K][number]
  })
}

export function deleteItem(key: ListKey, id: string) {
  return save(async (s) => {
    await api('DELETE', `${RESOURCES[key]}/${id}`)
    s.ifCurrent(() => {
      const list = store[key] as { id: string }[]
      const i = list.findIndex((x) => x.id === id)
      if (i >= 0) list.splice(i, 1) // never splice(-1): a missing id removes nothing
      // Cascades in the DB, mirrored here: a subscription takes its plan changes, a target its phase amounts.
      if (key === 'subscriptions') store.planChanges = store.planChanges.filter((c) => c.subId !== id)
      if (key === 'targets') for (const p of store.phases) delete p.amounts[id]
      if (key === 'accounts') store.balances = store.balances.filter((b) => b.accountId !== id)
    })
    if (RELOAD_AFTER_DELETE.includes(key)) await loadState()
  })
}

/**
 * Does a settings save need the server's USD rate first? While the daily refresh may write `fxRate` (fxAuto on, spec 013
 * S-23), a save that leaves the rate as this tab last saw it must not put back an older rate (review rc3-1 F-7).
 */
export const needsServerRate = (local: Settings, patch: Partial<Settings>): boolean =>
  (local.fxAuto || patch.fxAuto === true) && (patch.fxRate === undefined || patch.fxRate === local.fxRate)

export function saveSettings(patch: Partial<Settings> = {}) {
  return save(async (s) => {
    const body = { ...store.settings, ...patch }
    // the rate the server holds now (it may have refreshed since this tab loaded); the user's own rate goes as typed
    if (needsServerRate(store.settings, patch)) body.fxRate = (await api<State>('GET', '/api/state')).settings.fxRate
    if (!s.alive()) return
    const saved = await api<Settings>('PUT', '/api/settings', body)
    s.ifCurrent(() => { store.settings = saved })
  })
}

export function savePreferences(next: Preferences) {
  return save(async (s) => {
    const saved = await api<Preferences>('PUT', '/api/preferences', next)
    s.ifCurrent(() => { store.preferences = saved })
  })
}

export function saveLiving(patch: Partial<Living> = {}) {
  return save(async (s) => {
    const saved = await api<Living>('PUT', '/api/living', { ...store.living, ...patch })
    s.ifCurrent(() => { store.living = saved })
    await loadState() // the three values are living items now (spec 013 S-2)
  })
}

// Names the subscription page already uses.
export const upsertSub = (s: Subscription) => saveItem('subscriptions', s)
export const removeSub = (id: string) => deleteItem('subscriptions', id)
export const upsertChange = (c: PlanChange) => saveItem('planChanges', c)
export const removeChange = (id: string) => deleteItem('planChanges', id)
export const upsertSpending = (s: Spending) => saveItem('spendings', s)
export const removeSpending = (id: string) => deleteItem('spendings', id)

/** The settings with the foreign currencies: what the subscription sums take (spec 013 S-23). */
export const pricedSettings = (): Priced => priced(store.settings, store.currencies)

/** Everything the app holds, for the JSON view in the 개발 tab. */
export function exportJson(): string {
  const { settings, living, livingItems, targets, subscriptions, planChanges, phases, events, checks, accounts, balances, cards, monthAdjusts, currencies, schedules, debts, remainderSplit, preferences, holidaySets, spendings } = store
  return JSON.stringify({ settings, living, livingItems, targets, subscriptions, planChanges, phases, events, checks, accounts, balances, cards, monthAdjusts, currencies, schedules, debts, remainderSplit, preferences, holidaySets, spendings }, null, 2)
}

export const subName = (id: string) => store.subscriptions.find((s) => s.id === id)?.name ?? id
