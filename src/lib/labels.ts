// Display names of the stored enum values (spec 008 S-9): the data keeps its codes (and the
// Korean event kinds), the screens show them in the current language.
import { t, type MessageKey } from '../i18n'
import { phaseNumbers } from './calc'
import type { Phase, AllocationKind, Category, Cycle, EventKind, PayPath, Spending, SpendingRound, SubStatus } from '../data/types'

export const CATEGORY_IDS: Category[] = ['ai', 'telecom', 'content', 'tool', 'insurance', 'life', 'other']
export const catLabel = (id: string) => t(`label.category.${id}` as MessageKey)
export const pathLabel = (id: PayPath | string) => t(`label.path.${id}` as MessageKey)
export const statusLabel = (id: SubStatus | string) => t(`label.status.${id}` as MessageKey)
export const cycleLabel = (id: Cycle | string) => t(`label.cycle.${id}` as MessageKey)

/** The stored event kinds are Korean words; this maps each to its message key. */
const EVENT_KEY: Record<EventKind, string> = {
  '통장': 'bank', '구독': 'sub', '분배': 'split', '정책': 'policy', '세금': 'tax', '카드': 'card', '저축': 'saving', '수입': 'income', '대출': 'loan', '투자': 'invest',
}
export const EVENT_KINDS = Object.keys(EVENT_KEY) as EventKind[]
export const DEFAULT_EVENT_KIND: EventKind = '저축'
export const eventKindLabel = (kind: string) => (kind in EVENT_KEY ? t(`label.eventKind.${EVENT_KEY[kind as EventKind]}` as MessageKey) : kind)

/** How a target's amount is worked out, when the user wrote no note of their own. */
export const kindDetail = (kind: AllocationKind) => t(`label.allocDetail.${kind}` as MessageKey)
/** The kind of an allocation target, as a name. */
export const kindName = (kind: AllocationKind) => t(`label.allocKind.${kind}` as MessageKey)

/** The repayment methods the debt form offers; the stored value is the Korean label (the data keeps one spelling in both languages). */
const DEBT_METHOD_KEY = { '원리금 균등': 'equalPayment', '원금 균등': 'equalPrincipal', '만기 일시': 'bullet' } as const
export const DEBT_METHODS = Object.keys(DEBT_METHOD_KEY) as (keyof typeof DEBT_METHOD_KEY)[]
export const isDebtMethod = (v: string): v is keyof typeof DEBT_METHOD_KEY => v in DEBT_METHOD_KEY
/** A stored method as shown: one of the three in the current language, anything else as typed. */
export const debtMethodLabel = (v: string) => (isDebtMethod(v) ? t(`label.debtMethod.${DEBT_METHOD_KEY[v]}` as MessageKey) : v)

/** A card's usage period as the card list shows it (spec 018 S-2): from its first day to the day before it; a first day of 1 is the calendar month. */
export const usageLabel = (from: number) => (from === 1 ? t('accounts.cards.usageMonth') : t('accounts.cards.usageOf', { from, to: from - 1 }))

/** A debt's rate as shown: a plain number is a percentage, any other text stays as typed (spec 010 EV-35). */
export const rateText = (rate: string) => (/^\s*\d+(\.\d+)?\s*$/.test(rate) ? `${rate.trim()}%` : rate)

/** "1단계 · name": the phase's automatic number and its name, never the stored symbol (spec 010 U-4). */
export const phaseTag = (phases: Pick<Phase, 'id' | 'from'>[], p: Pick<Phase, 'id' | 'name'>) => `${t('payroll.phaseNo', { n: phaseNumbers(phases)[p.id] ?? 0 })} · ${p.name}`

/** "n/N" of a spending's round as the lists show it: nothing for a lump sum, "중도 완납" for the round an early payoff made (spec 011 S-8). */
export const roundSuffix = (s: Pick<Spending, 'how' | 'count'>, r: Pick<SpendingRound, 'no'>) =>
  s.how === 'lump' ? '' : r.no <= s.count ? t('spending.inst.roundOfLong', { no: r.no, n: s.count }) : t('spending.inst.payoffRound')
