// AI proposals (spec 009 S-9, redrawn by spec 010 S-6): the types, the loading and the deciding that
// 현황 (the "AI 제안" tab) and 대기 중인 변경 share, and how a changed row reads. Each proposal shows what
// it changes — the rows before and after, and this month's and next month's transfer and distribution
// before and after, which the server computes by really applying it and rolling back.
import { reactive } from 'vue'
import { lang, t, te, type MessageKey } from '../i18n'
import { ApiError, api } from './api'
import { fmtDate, fmtMoney } from './display'
import { catLabel, cycleLabel, pathLabel, statusLabel } from './labels'
import { loadState, store, subName } from './store'
import { showToast } from './toast'
import { fxAmount } from './currency'

export interface RowChange { table: string; op: 'insert' | 'update' | 'delete'; key: Record<string, string>; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
export interface Delta { before: number; after: number }
export interface MonthPreview {
  month: string
  transferKrw: Delta
  neededKrw: Delta
  distribution: { targetId: string; name: string; kind: string; amountKrw: { before: number | null; after: number | null } }[]
  remainderKrw: Delta
}
export type Status = 'pending' | 'applied' | 'rejected' | 'expired' | 'stale'
export interface Proposal {
  id: string
  keyName: string
  keyUsable: boolean
  confirm: 'ui' | 'chat'
  note: string | null
  status: Status
  createdAt: string
  expiresAt: string
  decidedAt: string | null
  decidedBy: 'user' | 'key' | null
  changeSetId: string | null
  revertOf: string | null
  preview: { rows: RowChange[]; months: MonthPreview[] }
}

export const HANDLED_PAGE = 20

// What the screens hold here belongs to the signed-in account. `resetProposals` (called when the session
// changes: sign-out, another account) empties it, and `epoch` lets an answer that arrives after that be
// dropped instead of filling the next account's screen.
let epoch = 0

/** What the screens share. `decided` holds the proposals the user decided on this screen session: their cards stay, with an undo for an applied one. */
export const proposals = reactive({
  waiting: [] as Proposal[],
  handled: [] as Proposal[],
  moreHandled: false,
  loaded: false,
  busy: '',
  error: '',
  decided: {} as Record<string, 'applied' | 'rejected' | 'reverted'>,
  /** The proposals decided on this screen session, as the server confirmed them (its answer, then the list when it has them): kept apart from the paged history, which may not reach them. */
  kept: {} as Record<string, Proposal>,
})

export function resetProposals() {
  epoch++
  proposals.waiting = []
  proposals.handled = []
  proposals.moreHandled = false
  proposals.loaded = false
  proposals.busy = ''
  proposals.error = ''
  proposals.decided = {}
  proposals.kept = {}
}

/** Every waiting proposal (at most 20 can wait), and so the number for the badge: this list is never cut short. */
export async function loadWaiting() {
  const e = epoch
  const list = await api<Proposal[]>('GET', '/api/proposals?status=pending')
  if (e !== epoch) return
  proposals.waiting = list
  store.pendingProposals = list.length
}

/** The handled ones, a page at a time, newest first. */
export async function loadHandled(more = false) {
  const last = more ? proposals.handled.at(-1) : undefined
  const after = last ? `&before=${encodeURIComponent(last.createdAt)}&beforeId=${encodeURIComponent(last.id)}` : ''
  const e = epoch
  const page = await api<Proposal[]>('GET', `/api/proposals?status=handled&limit=${HANDLED_PAGE}${after}`)
  if (e !== epoch) return
  proposals.handled = more ? [...proposals.handled, ...page] : page
  proposals.moreHandled = page.length === HANDLED_PAGE
}

export async function loadProposals() {
  const at = epoch
  try {
    await Promise.all([loadWaiting(), loadHandled()])
    if (at === epoch) proposals.loaded = true
  } catch (e) {
    if (at === epoch) proposals.error = e instanceof ApiError ? e.message : t('pending.loadFailed')
  }
}

export async function moreProposals() {
  const at = epoch
  try { await loadHandled(true) } catch (e) { if (at === epoch) proposals.error = e instanceof ApiError ? e.message : t('pending.loadFailed') }
}

/** The proposal's title: the AI's own note, or else what it changes. */
export const proposalTitle = (p: Proposal) => p.note?.trim() || summary(p)

export async function decide(p: Proposal, what: 'apply' | 'reject') {
  const at = epoch
  proposals.busy = p.id
  proposals.error = ''
  const name = proposalTitle(p)
  try {
    // The apply answer carries the change set the proposal made; undo needs it before any list is reloaded.
    const done = await api<{ changeSet: string | null } | undefined>('POST', `/api/proposals/${p.id}/${what}`)
    if (at !== epoch) return // another account is on this screen now
    const changeSetId = what === 'apply' ? done?.changeSet ?? null : null
    proposals.decided[p.id] = what === 'apply' ? 'applied' : 'rejected'
    proposals.kept[p.id] = { ...p, status: what === 'apply' ? 'applied' : 'rejected', changeSetId, decidedAt: new Date().toISOString(), decidedBy: 'user' }
    if (what === 'apply') {
      await loadState() // the screens show what the server holds now
      if (at !== epoch) return
      showToast(t('pending.appliedToast', { title: name }), changeSetId ? { actionLabel: t('pending.undo'), onAction: () => { void undo(p.id) } } : {})
    } else showToast(t('pending.rejectedToast', { title: name }))
  } catch (e) {
    if (at === epoch) proposals.error = e instanceof ApiError ? e.message : t('pending.failed')
  } finally {
    if (at === epoch) proposals.busy = ''
    if (at === epoch) await loadProposals()
    // The server's own record replaces ours once the list has it (the decision time, the key's state).
    if (at === epoch) for (const id of Object.keys(proposals.kept)) {
      const own = proposals.handled.find((x) => x.id === id)
      if (own) proposals.kept[id] = { ...own, changeSetId: own.changeSetId ?? proposals.kept[id]!.changeSetId }
    }
  }
}

/** Undo an applied proposal: revert its change set (the same revert as 변경 내역). The server may refuse (409); its reason is shown. */
export async function undo(id: string) {
  const p = proposals.kept[id] ?? [...proposals.waiting, ...proposals.handled].find((x) => x.id === id)
  if (!p?.changeSetId) return
  const at = epoch
  proposals.busy = id
  proposals.error = ''
  try {
    await api('POST', `/api/changes/${p.changeSetId}/revert`)
    if (at !== epoch) return
    proposals.decided[id] = 'reverted'
    await loadState()
    if (at !== epoch) return
    showToast(t('pending.revertedToast', { title: proposalTitle(p) }))
  } catch (e) {
    if (at === epoch) proposals.error = e instanceof ApiError ? e.message : t('history.revertFailed')
  } finally {
    if (at === epoch) proposals.busy = ''
  }
}

// ── What a row is ──
/** A table's name; the rc.3 tables (spec 013 S-22, S-23) keep theirs in the currency messages. */
export const tableName = (name: string) => {
  for (const k of [`history.table.${name}`, `currency.tables.${name}`]) if (te(k)) return t(k as MessageKey)
  return name
}
const HIDDEN = new Set(['userId', 'seq', 'id'])
const targetName = (id: string) => store.targets.find((x) => x.id === id)?.name ?? id
const phaseName = (id: string) => { const p = store.phases.find((x) => x.id === id); return p ? `${p.label} ${p.name}` : id }
export const rowLabel = (c: RowChange) => {
  const r = c.after ?? c.before ?? {}
  if (c.table === 'plan_change' && typeof r.subId === 'string') return subName(r.subId)
  if (c.table === 'phase_amount') return `${phaseName(String(r.phaseId))} · ${targetName(String(r.targetId))}`
  // a month adjustment: its target and month (spec 013 S-14, review rc2-1 F-3)
  if (c.table === 'month_adjust') return `${targetName(String(r.targetId))} · ${monthLabel(String(r.ym))}`
  const name = r.name ?? r.text ?? r.title ?? r.label
  return typeof name === 'string' && name ? name : ''
}
/** "Subscription · Name" without the operation; the operation is a pill beside it. */
export const rowTarget = (c: RowChange) => `${tableName(c.table)}${rowLabel(c) ? ` · ${rowLabel(c)}` : ''}`
export const rowTitle = (c: RowChange) => `${tableName(c.table)} ${t(`history.op.${c.op}`)}${rowLabel(c) ? ` · ${rowLabel(c)}` : ''}`
// The order a subscription's fields read in (the canvas); the others keep the order they came in.
const ORDER = ['category', 'plan', 'status', 'currency', 'amount', 'vat', 'cycle', 'nextDate', 'path', 'verified', 'note']
const rank = (k: string) => { const i = ORDER.indexOf(k); return i < 0 ? -1 : i }
export const rowFields = (c: RowChange) => {
  const r = c.after ?? c.before ?? {}
  // an added or removed row already has its name in the heading
  const skipName = c.op !== 'update' && typeof r.name === 'string' && rowLabel(c) === r.name
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})].filter((k) => !HIDDEN.has(k) && !(skipName && k === 'name')))
  const all = [...keys]
  return [...all.filter((k) => rank(k) >= 0).sort((a, b) => rank(a) - rank(b)), ...all.filter((k) => rank(k) < 0)]
    .map((k) => ({ k, b: c.before?.[k], a: c.after?.[k] }))
    .filter((f) => c.op !== 'update' || JSON.stringify(f.b) !== JSON.stringify(f.a))
}
/** Fields whose name differs in one table: a currency's `rate` is its exchange rate, an account's its interest rate. */
const TABLE_FIELDS: Record<string, readonly string[]> = { foreign_currency: ['rate'] }
/** A field's name (`table`, when known, picks a table's own name for it); the rc.3 fields are in the currency messages. */
export const fieldName = (k: string, table?: string) => {
  if (table && TABLE_FIELDS[table]?.includes(k)) return t(`currency.fields.${k}` as MessageKey)
  for (const key of [`pending.fields.${k}`, `currency.fields.${k}`]) if (te(key)) return t(key as MessageKey)
  return k
}

/** A stored value as words: "월간", "₩9,900", "0%", "미확인", a date in the user's format; a code or text as it is. */
export function worded(field: string, v: unknown, row?: Record<string, unknown> | null): string {
  if (v === null || v === undefined || v === '') return '—'
  const word = (f: () => string) => { try { return f() } catch { return String(v) } }
  switch (field) {
    case 'category': return word(() => catLabel(String(v)))
    case 'status': return te(`label.status.${String(v)}`) ? statusLabel(String(v)) : String(v)
    case 'cycle': return word(() => cycleLabel(String(v)))
    case 'path': return word(() => pathLabel(String(v)))
    case 'amount': return typeof v === 'number' ? (typeof row?.currency === 'string' && row.currency !== 'KRW' ? fxAmount(row.currency, v) : fmtMoney(v)) : String(v)
    // spec 013 money fields (review 2 F-8)
    case 'deposit': case 'buffer': case 'goal': case 'annualLimit': case 'goalAck': return typeof v === 'number' ? fmtMoney(v) : String(v)
    case 'vat': return `${String(v)}%`
    case 'targetId': return targetName(String(v))
    case 'ym': return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v) ? monthLabel(v) : String(v)
    case 'verified': return v ? t('pending.verifiedYes') : t('pending.verifiedNo')
    case 'done': return v ? t('pending.doneYes') : t('pending.doneNo')
    case 'nextDate': case 'effective': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : String(v)
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}
export const summary = (p: Proposal) => {
  const first = p.preview.rows[0]
  if (!first) return t('history.noChange')
  const head = rowTitle(first)
  return p.preview.rows.length > 1 ? t('history.andMore', { head, n: p.preview.rows.length - 1 }) : head
}
export const money = (n: number | null) => (n === null ? '—' : fmtMoney(n))
export const changed = (d: { before: number | null; after: number | null }) => d.before !== d.after
export const monthLabel = (ym: string) => ym.replace('-', '. ')
const loc = () => (lang.value === 'en' ? 'en-US' : 'ko-KR')
export const when = (at: string) => { const d = new Date(at); return `${fmtDate(d)} ${d.toLocaleTimeString(loc(), { timeStyle: 'short' })}` }
export const STATUS: Record<Status, MessageKey> = { pending: 'pending.status.pending', applied: 'pending.status.applied', rejected: 'pending.status.rejected', expired: 'pending.status.expired', stale: 'pending.status.stale' }
export const STATUS_CLASS: Record<Status, string> = { pending: 'acc', applied: 'ok', rejected: 'mute', expired: 'mute', stale: 'mute' }

/** The state a card shows: what the server holds, or "reverted" once the user undid it on this screen. */
export function shown(p: Proposal): { label: string; cls: string } {
  if (proposals.decided[p.id] === 'reverted') return { label: t('pending.status.reverted'), cls: 'mute' }
  return { label: t(STATUS[p.status]), cls: STATUS_CLASS[p.status] }
}
/** An applied proposal that was decided on this screen and not yet undone keeps its undo button. */
export const canUndo = (p: Proposal) => p.status === 'applied' && !!p.changeSetId && proposals.decided[p.id] === 'applied'

/** The cards a filter shows. The ones decided on this screen come first and stay (with an undo for an applied one) even when the history page does not reach them. */
export function listFor(filter: 'waiting' | 'handled' | 'all'): Proposal[] {
  const stay = Object.values(proposals.kept).reverse()
  const kept = new Set(stay.map((p) => p.id))
  const waiting = proposals.waiting.filter((p) => !kept.has(p.id))
  const rest = proposals.handled.filter((p) => !kept.has(p.id))
  if (filter === 'waiting') return [...waiting, ...stay]
  if (filter === 'handled') return [...stay, ...rest]
  return [...waiting, ...stay, ...rest]
}
