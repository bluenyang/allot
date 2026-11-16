// Display names of the stored enum values (spec 008 S-9): the data keeps its codes (and the
// Korean event kinds), the screens show them in the current language.
import { t, type MessageKey } from '../i18n'
import type { AllocationKind, Category, Cycle, EventKind, PayPath, SubStatus } from '../data/types'

export const CATEGORY_IDS: Category[] = ['ai', 'telecom', 'content', 'tool', 'insurance', 'life']
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
