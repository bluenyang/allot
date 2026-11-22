// Pure helpers of the Living, Savings and Investment pages (spec 013 S-1..S-4, S-7): the status line under
// a list, the percent ↔ ratio of an item, the chips that fill a free-text field, the "언제부터" choice and
// the preview of a total change. No store, no messages: the pages turn the codes into text.
// Tested without a database (tests/unit/budget-page.test.ts).
import type { Account, AllocationTarget, BudgetGroup, Phase, Settings } from '../data/types'
import { addYm, groupAt, monthMoney, phaseAt, type GroupMonth, type MonthState } from './calc'

// ---------- the status line under the list (S-3) ----------
export type SumStatus =
  | { code: 'living' }
  | { code: 'noTarget' }
  | { code: 'noPhase' }
  | { code: 'same'; ratio: boolean }
  | { code: 'under'; amount: number }
  | { code: 'over'; amount: number }
  | { code: 'ratioUnder'; pct: number; rest: number }
  | { code: 'ratioOver'; pct: number; over: number }

/** A ratio as a percent with at most 2 decimals (0.3333 → 33.33). */
export const pctOf = (ratio: number) => Math.round(ratio * 1_000_000) / 10_000

/**
 * The status of a Savings / Investment month (S-3, as the canvas words it): amount split = the target gets the
 * items added up, so it always matches; ratio split = a ratio sum other than 100% leaves the rest in the remainder
 * (or goes over); at 100% the rounding to 1,000 may leave a little under or over. It never blocks a save.
 */
export function sumStatus(g: GroupMonth, phase: Phase | null): SumStatus {
  if (!g.target) return { code: 'noTarget' }
  if (g.mode === 'amount') return { code: 'same', ratio: false }
  if (!phase) return { code: 'noPhase' }
  const pct = pctOf(g.ratioSum)
  if (pct < 100) return { code: 'ratioUnder', pct, rest: Math.round((100 - pct) * 100) / 100 }
  if (pct > 100) return { code: 'ratioOver', pct, over: Math.round((pct - 100) * 100) / 100 }
  const diff = g.total - g.sum
  if (diff === 0) return { code: 'same', ratio: true }
  return diff > 0 ? { code: 'under', amount: diff } : { code: 'over', amount: -diff }
}

// ---------- percent ↔ ratio (S-3, S-9) ----------
/**
 * The stored ratio of a percent typed in the editor: percent / 100, keeping at most 2 decimals of the percent
 * (4 of the ratio, as numeric(5,4) stores it). Empty stays null. Nothing else is refused here: a ratio the API
 * does not take (over 100%, below 0) goes to the API, which answers why.
 */
export function ratioOfPercent(p: number | '' | null | undefined): number | null {
  if (p === '' || p === null || p === undefined || !Number.isFinite(p)) return null
  const r = Math.round(p * 100) / 10_000
  return r === 0 ? 0 : r // no -0
}
/** The percent shown for a stored ratio ('' for none). */
export const percentOfRatio = (r: number | null | undefined): number | '' => (r === null || r === undefined ? '' : pctOf(r))

/** An item's monthly amount in the ratio split: the total × the ratio, rounded to the nearest 1,000 (as `groupAt`). */
export const ratioAmount = (total: number, ratio: number | null | undefined) => Math.round((total * (ratio ?? 0)) / 1000) * 1000

// ---------- chips that fill a free-text field (S-2, S-5) ----------
export interface Chip { id: string; label: string }
export interface ChipPick { id: string | null; text: string }

/**
 * Which chip a stored free-text value selects: the chip whose label is the value; any other non-empty value
 * selects `otherId` and stays in the free text as it was; '' selects none. Nothing stored is lost.
 */
export function chipOf(value: string | undefined, chips: readonly Chip[], otherId: string): ChipPick {
  const v = value ?? ''
  if (v === '') return { id: null, text: '' }
  const hit = chips.find((c) => c.label === v)
  return hit ? { id: hit.id, text: '' } : { id: otherId, text: v }
}

/** The value to store for a pick: the chip's label, the typed text for `otherId` (`otherEmpty` when nothing is typed), '' for none. */
export function chipValue(pick: ChipPick, chips: readonly Chip[], otherId: string, otherEmpty: string): string {
  if (pick.id === null) return ''
  if (pick.id === otherId) return pick.text.trim() === '' ? otherEmpty : pick.text
  return chips.find((c) => c.id === pick.id)?.label ?? ''
}

// ---------- 언제부터 (S-2, S-3) ----------
/** 'kept' = the stored month as it is (null = from the start, or another month); 'now' / 'next' = this or next month. */
export type FromChoice = 'kept' | 'now' | 'next'
export function fromChoice(from: string | null | undefined, now: string): FromChoice {
  return from === now ? 'now' : from === addYm(now, 1) ? 'next' : 'kept'
}
/** The month a choice stores: 'kept' gives back the stored value (null stays null). */
export function fromOf(choice: FromChoice, kept: string | null, now: string): string | null {
  return choice === 'now' ? now : choice === 'next' ? addYm(now, 1) : kept
}

// ---------- 총액 수정 (S-3) ----------
export interface TotalPreview {
  phase: Phase
  /** the remainder (or what stays in the pay account) of month `ym` before and after */
  before: number
  after: number
  rows: { account: Account; before: number; after: number }[]
}

/** The phases with `phase`'s amount for `targetId` set to `value`: what saving the total writes. */
export function withTotal(phases: Phase[], phaseId: string, targetId: string, value: number): Phase[] {
  return phases.map((p) => (p.id === phaseId ? { ...p, amounts: { ...p.amounts, [targetId]: value } } : p))
}

/**
 * What changing the menu's total of month `ym`'s phase to `value` does (S-3, "구간 끝까지"): the remainder of
 * that month before → after (`monthMoney` with the changed phases) and each item's amount. null without a
 * phase that month or without the menu's target.
 */
export function totalPreview(state: MonthState & { accounts: Account[] }, group: BudgetGroup, ym: string, value: number): TotalPreview | null {
  const phase = phaseAt(state.phases, ym)
  const target = state.targets.find((t) => t.kind === group)
  if (!phase || !target) return null
  const next = withTotal(state.phases, phase.id, target.id, value)
  const was = groupAt(group, state.accounts, state.phases, state.targets, state.settings, ym)
  const now = groupAt(group, state.accounts, next, state.targets, state.settings, ym)
  return {
    phase,
    before: monthMoney(state, ym).dist.remainder,
    after: monthMoney(state, ym, { phases: next }).dist.remainder,
    rows: now.rows.map((r, i) => ({ account: r.account, before: was.rows[i]?.amount ?? 0, after: r.amount })),
  }
}

// ---------- KPIs (S-1 범위 밖: what the data gives) ----------
/** What a menu planned to send from January of `ym`'s year up to and including `ym`. */
export function yearSent(group: BudgetGroup, accounts: Account[], phases: Phase[], targets: AllocationTarget[], s: Pick<Settings, 'savingSplit' | 'investSplit'>, ym: string): number {
  let total = 0
  for (let m = `${ym.slice(0, 4)}-01`; m <= ym; m = addYm(m, 1)) total += groupAt(group, accounts, phases, targets, s, m).sum
  return total
}

/** How close a year's payments are to the annual limit (S-7): 'near' from 90%, 'over' above the limit. */
export type LimitTone = 'ok' | 'near' | 'over'
export function limitTone(paid: number, limit: number): LimitTone {
  return paid > limit ? 'over' : paid >= limit * 0.9 ? 'near' : 'ok'
}

/** A share of a whole in percent (0 when the whole is 0), for the bars. */
export const shareOf = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0)

// ---------- what the shared page template (BudgetPage.vue) draws ----------
export type Tone = 'muted' | 'ok' | 'warn' | 'bad'
/** One cell of the "들어오는 돈" strip; `action` is a button beside the value (총액 수정). */
export interface BudgetCell { label: string; value: string; sub?: string; action?: { label: string; aria: string } }
export interface BudgetProg { label: string; value: string; w: number; tone?: Tone }
export interface BudgetKpi { label: string; value: string; sub: string; tone?: Tone; progs?: BudgetProg[] }
export interface BudgetRow {
  id: string
  name: string
  /** the kind tag; '' for none */
  tag: string
  /** small tags after the kind: "2027-01부터", "2026-12부터 멈춤" */
  flags: string[]
  /** the line under the name: the pay method, or "bank …1234" */
  line: string
  main: string
  sub: string
  meta: string
  /** progress: a bar of `w` percent (null = no bar) and its text */
  prog: { w: number | null; text: string; tone?: Tone }
  color: string
  amount: number
}
/** The colours of the items in their order (the canvas list: primary, secondary green, info, signal, greys). */
export const ITEM_COLORS = ['var(--primary)', 'var(--primary-mid)', 'var(--info)', 'var(--accent)', 'var(--c5)', 'var(--c3)', 'var(--c7)'] as const
export const itemColor = (i: number) => ITEM_COLORS[i % ITEM_COLORS.length]!

/** The account line of an item: "bank …1234", the bank or the digits alone, '' for neither. */
export const accountLine = (a: Pick<Account, 'bank' | 'last4'>) => [a.bank ?? '', a.last4 ? `…${a.last4}` : ''].filter(Boolean).join(' ')

/** An item's monthly amount in `phase`, before its start and stop months are applied: the phase's own amount when it has one (S-4). */
export function baseAmount(x: { amount?: number; amounts?: Record<string, number> }, phase: Phase | null): { amount: number; phased: boolean } {
  if (phase && x.amounts && Object.hasOwn(x.amounts, phase.id)) return { amount: x.amounts[phase.id]!, phased: true }
  return { amount: x.amount ?? 0, phased: false }
}
