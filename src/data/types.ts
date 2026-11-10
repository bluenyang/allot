export type Currency = 'KRW' | 'USD'
export type Cycle = 'monthly' | 'yearly'
export type PayPath = 'direct' | 'google' | 'apple' | 'telecom'
export type SubStatus = 'active' | 'cancelled' | 'company'
export type Category = 'ai' | 'telecom' | 'content' | 'tool' | 'insurance' | 'life'

/** 요금에 영향을 주는 필드. 플랜 변경(PlanChange)은 이 필드만 바꾼다. */
export interface Plan {
  plan: string
  amount: number
  currency: Currency
  vat: number // USD 항목만 의미 있음 (%)
  cycle: Cycle
  status: SubStatus
}

export interface Subscription extends Plan {
  id: string
  name: string
  category: Category
  nextDate: string // YYYY-MM-DD, 주기만큼 더해 이후 결제일 계산
  path: PayPath
  verified: boolean // 영수증으로 금액·VAT 확인
  note?: string
}

/** 예약된 플랜 전환. effective가 없으면 '날짜 미정'으로 보관만 한다. */
export interface PlanChange {
  id: string
  subId: string
  effective: string | null // YYYY-MM-DD
  to: Partial<Plan>
  note: string
}

export interface Settings {
  netPay: number
  fxRate: number
  fxBuffer: number // %
  payDay: number
  transferDay: number
  billingDay: number
  subRound: number // 구독 이체 올림 단위
}

export interface Living {
  food: number
  transit: number
  allowance: number
}

/** 월급이 가는 곳. 이름은 사용자 데이터이고, 종류가 금액 계산 방식을 정한다. */
export type AllocationKind = 'living' | 'subscriptions' | 'fixed' | 'remainder'
export interface AllocationTarget {
  id: string
  name: string
  kind: AllocationKind // living: 생활비 합계 · subscriptions: 구독 필요 이체액 · fixed: 구간별 금액 · remainder: 나머지 전부
  note?: string
}

/** 구간. 고정 대상(kind 'fixed')별 금액을 가진다. */
export interface Phase {
  id: string
  label: string
  name: string
  from: string // YYYY-MM
  to: string | null // YYYY-MM, 포함
  amounts: Record<string, number> // targetId → 금액 (fixed 대상만)
  note?: string
}

export type EventKind = '통장' | '구독' | '분배' | '정책' | '세금' | '카드' | '저축' | '수입' | '대출' | '투자'
export type EventState = 'done' | 'doing' | 'todo'

export interface PlanEvent {
  id: string
  when: string // YYYY-MM 또는 YYYY-MM~MM
  kind: EventKind
  title: string
  state: EventState
}

export interface CheckItem {
  id: string
  text: string
  done: boolean
}

export interface Account {
  id: string
  name: string
  role: string
  inflow: string
  outflow: string
}

export interface Debt {
  id: string
  name: string
  principal: number
  rate: string
  method: string
  plan: string
}

/** 나머지 금액을 나누는 방식. 마지막 항목이 남는 금액을 받는다. */
export interface RemainderSplit {
  id: string
  name: string
  code: string
  ratio: number // 0~1
}
