import { reactive } from 'vue'
import type {
  Account, AllocationTarget, CheckItem, Debt, Living, Phase, PlanChange, PlanEvent, RemainderSplit, Settings, Subscription,
} from '../data/types'
import { ApiError, api } from './api'

// App state comes from the API (PostgreSQL). Every change goes to the API first;
// the store is updated from the server's answer, so what you see is what is saved.
export interface State {
  settings: Settings
  living: Living
  targets: AllocationTarget[]
  subscriptions: Subscription[]
  planChanges: PlanChange[]
  phases: Phase[]
  events: PlanEvent[]
  checks: CheckItem[]
  accounts: Account[]
  debts: Debt[]
  remainderSplit: RemainderSplit[]
}

const empty = (): State => ({
  settings: { netPay: 0, fxRate: 0, fxBuffer: 0, payDay: 25, transferDay: 26, billingDay: 14, subRound: 10_000 },
  living: { food: 0, transit: 0, allowance: 0 },
  targets: [], subscriptions: [], planChanges: [], phases: [], events: [], checks: [], accounts: [], debts: [], remainderSplit: [],
})

export const store = reactive<State>(empty())
export const status = reactive({ loaded: false, loading: false, error: '' })

export async function loadState() {
  status.loading = true
  try {
    Object.assign(store, await api<State>('GET', '/api/state'))
    status.loaded = true
    status.error = ''
  } catch (e) {
    status.error = message(e)
  } finally {
    status.loading = false
  }
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : '서버에 연결하지 못했어요.')

/** Run a save; on failure show the error and reload, so the screen never shows unsaved values. */
async function save<T>(run: () => Promise<T>): Promise<T> {
  try {
    const r = await run()
    status.error = ''
    return r
  } catch (e) {
    const msg = message(e)
    await loadState() // put the saved values back on screen…
    status.error = msg // …and keep saying why the change did not stick
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
} as const
export type ListKey = keyof typeof RESOURCES

/** Create (no id) or replace an item; returns the saved item. */
export function saveItem<K extends ListKey>(key: K, item: State[K][number]): Promise<State[K][number]> {
  return save(async () => {
    const { id, ...body } = item as { id: string }
    const list = store[key] as { id: string }[]
    const saved = await api<{ id: string }>(id ? 'PUT' : 'POST', id ? `${RESOURCES[key]}/${id}` : RESOURCES[key], body)
    const i = list.findIndex((x) => x.id === saved.id)
    if (i >= 0) list[i] = saved
    else list.push(saved)
    // Mirrors the server: a target that is no longer 'fixed' loses its phase amounts.
    if (key === 'targets' && (saved as { kind?: string }).kind !== 'fixed') {
      for (const p of store.phases) delete p.amounts[saved.id]
    }
    return saved as State[K][number]
  })
}

export function deleteItem(key: ListKey, id: string) {
  return save(async () => {
    await api('DELETE', `${RESOURCES[key]}/${id}`)
    ;(store[key] as { id: string }[]).splice((store[key] as { id: string }[]).findIndex((x) => x.id === id), 1)
    // Cascades in the DB, mirrored here: a subscription takes its plan changes, a target its phase amounts.
    if (key === 'subscriptions') store.planChanges = store.planChanges.filter((c) => c.subId !== id)
    if (key === 'targets') for (const p of store.phases) delete p.amounts[id]
  })
}

export function saveSettings(patch: Partial<Settings> = {}) {
  return save(async () => {
    store.settings = await api<Settings>('PUT', '/api/settings', { ...store.settings, ...patch })
  })
}

export function saveLiving(patch: Partial<Living> = {}) {
  return save(async () => {
    store.living = await api<Living>('PUT', '/api/living', { ...store.living, ...patch })
  })
}

// Names the subscription page already uses.
export const upsertSub = (s: Subscription) => saveItem('subscriptions', s)
export const removeSub = (id: string) => deleteItem('subscriptions', id)
export const upsertChange = (c: PlanChange) => saveItem('planChanges', c)
export const removeChange = (id: string) => deleteItem('planChanges', id)

/** Everything the app holds, for the JSON view in the 개발 tab. */
export function exportJson(): string {
  const { settings, living, targets, subscriptions, planChanges, phases, events, checks, accounts, debts, remainderSplit } = store
  return JSON.stringify({ settings, living, targets, subscriptions, planChanges, phases, events, checks, accounts, debts, remainderSplit }, null, 2)
}

export const subName = (id: string) => store.subscriptions.find((s) => s.id === id)?.name ?? id
