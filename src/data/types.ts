/**
 * A currency code (ISO 4217, three capitals; spec 013 S-23): 'KRW' (the base), 'USD' (its rate in Settings) or the code
 * of a ForeignCurrency. Was 'KRW' | 'USD' up to 0.1.7-rc.2.
 */
export type Currency = string
export type Cycle = 'monthly' | 'yearly'
export type PayPath = 'direct' | 'google' | 'apple' | 'telecom'
export type SubStatus = 'active' | 'cancelled' | 'company'
export type Category = 'ai' | 'telecom' | 'content' | 'tool' | 'insurance' | 'life' | 'other'

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
  dayShift: DayShift // 주말·공휴일이면 (spec 007 S-10)
  /** How the Savings and Investment menus split their total (spec 013 S-3). */
  savingSplit?: SplitMode // default 'amount'
  investSplit?: SplitMode // default 'ratio'
  /** USD rate refreshed once a day from the public rate (spec 013 S-23); off = by hand. */
  fxAuto?: boolean
  /** Written by the server only: the last refresh (ISO time) and why the last try failed. */
  fxAutoAt?: string | null
  fxAutoError?: string | null
}

/** A foreign currency other than USD (spec 013 S-23): KRW per unit and the buffer % for subscriptions in it. */
export interface ForeignCurrency {
  id: string
  code: string
  rate: number
  buffer: number
  auto: boolean
  autoAt?: string | null
  autoError?: string | null
}

/** The settings with the rates of every foreign currency: what the subscription sums need (spec 013 S-23). */
export type Priced = Settings & { currencies: ForeignCurrency[] }

/** A monthly date of the user's own on the calendar and the schedule (spec 013 S-22, A-36); not part of any sum. */
export interface ScheduleItem {
  id: string
  name: string
  day: number
  accountId: string | null
  direction: 'in' | 'out'
  note?: string
}

export type SplitMode = 'amount' | 'ratio'

export type DayShift = 'none' | 'before' | 'after'

/** 표시 설정과 테마 (spec 007 S-7, S-8). 색이 null이면 기본 색. */
export interface Preferences {
  themeMode: 'system' | 'light' | 'dark'
  primary: string | null
  accent: string | null
  radius: 'sharp' | 'base' | 'soft'
  density: 'base' | 'compact'
  dateFormat: 'iso' | 'dot' | 'us'
  amountUnit: 'won' | 'thousand' | 'man'
  negative: 'minus' | 'paren' | 'red'
  /** Screen and message language (spec 008 S-9); null follows the browser. */
  language: 'ko' | 'en' | null
  /** IANA time zone of "today" and "this month" (spec 013 S-22); default Asia/Seoul. */
  timezone?: string
}

/**
 * 공휴일 규칙 하나 (spec 007 S-9). rrule은 iCalendar RRULE 본문(FREQ=YEARLY;…),
 * 음력은 RSCALE=DANGI. rdate·exdate는 YYYY-MM-DD. substitute: 그 요일(또는 다른 공휴일)과 겹치면
 * 다음 첫 평일이 대체공휴일 — since 연도부터.
 */
export interface HolidayRule {
  name: string
  rrule?: string
  rdate?: string[]
  exdate?: string[]
  substitute?: { on: ('SA' | 'SU')[]; since?: number }
}

/** 공휴일 세트. builtin이면 규칙은 코드에 있고 켬/끔만 저장한다. */
export interface HolidaySet {
  id: string
  name: string
  enabled: boolean
  builtin: string | null
  rules: HolidayRule[]
}

/** The old living row (until 0.1.6): still accepted by PUT /api/living and answered by /api/state, as the three coded items (spec 013 S-2). */
export interface Living {
  food: number
  transit: number
  allowance: number
}

export type LivingCode = 'food' | 'transit' | 'allowance'

/** A living-cost item (spec 013 S-2). `amounts`: phaseId → the amount in that phase (S-4). */
export interface LivingItem {
  id: string
  name: string
  kind: string
  payMethod: string
  amount: number
  from: string | null // YYYY-MM; null = from the start
  code: LivingCode | null
  note?: string
  amounts: Record<string, number>
}

/** 월급이 가는 곳. 이름은 사용자 데이터이고, 종류가 금액 계산 방식을 정한다. */
export type AllocationKind = 'living' | 'subscriptions' | 'fixed' | 'remainder' | 'saving' | 'invest'
export interface AllocationTarget {
  id: string
  name: string
  kind: AllocationKind // living: 생활비 합계 · subscriptions: 구독 필요 이체액 · fixed: 구간별 금액 · remainder: 나머지 전부 · saving/invest: 그 메뉴 항목 합계 (spec 013 S-3)
  note?: string
  /** The account its money goes to (spec 013 S-5). */
  accountId?: string | null
}

/** 구간. 고정 대상(kind 'fixed')별 금액을 가진다. */
export interface Phase {
  id: string
  label: string
  name: string
  from: string // YYYY-MM
  to: string | null // YYYY-MM, 포함
  amounts: Record<string, number> // targetId → 금액 (fixed 대상, 비율로 나누는 saving·invest 대상의 총액)
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

export type BudgetGroup = 'saving' | 'invest'

/**
 * A bank account (spec 013 S-5). With a `group` it is an item of the Savings or Investment menu: its
 * monthly `amount` (amount split; `amounts` = phaseId → amount) or `ratio` (ratio split) goes to it from
 * `from` until `stopFrom` (that month and later: nothing).
 */
export interface Account {
  id: string
  name: string
  role: string
  inflow: string
  outflow: string
  bank?: string
  last4?: string
  kind?: string
  rate?: string
  term?: string
  buffer?: number
  goal?: number | null
  annualLimit?: number | null
  group?: BudgetGroup | null
  amount?: number
  ratio?: number | null
  from?: string | null
  stopFrom?: string | null
  goalAck?: number | null
  /** where the money goes at maturity (free text, spec 013 S-15) */
  afterMaturity?: string
  note?: string
  amounts?: Record<string, number>
}

/** One month's amount of a target, in place of its phase amount for that month (spec 013 S-14). */
export interface MonthAdjust {
  id: string
  ym: string // YYYY-MM
  targetId: string
  amount: number
  reason?: string
}

/** A balance written down on a date (spec 013 S-6). */
export interface Balance {
  id: string
  accountId: string
  date: string // YYYY-MM-DD
  amount: number
  /** money put in at once that day (review 1 F-12); the yearly contribution counts it */
  deposit?: number | null
  note?: string
}

/** A card (spec 013 S-13): its bill is paid from `accountId` on `billingDay` (null = the settings' billing day). */
export interface Card {
  id: string
  name: string
  last4: string
  accountId: string | null
  billingDay: number | null
  note?: string
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

// ---------- one-off spending (spec 011 S-2) ----------
/** How a spending is paid: all at once, in card installments, split by the user, or by card from the paying account's buffer, refilled over months (spec 013 S-8). */
export type SpendHow = 'lump' | 'installment' | 'split' | 'buffer'
/** Where the money comes from: the card (billed on the billing day), the salary account, or the subscription account. */
export type PayBy = 'card' | 'salary' | 'subs'
/** A round is still to pay, paid, or merged into another round by an early payoff. */
export type RoundState = 'left' | 'paid' | 'merged'
/** The gap between the rounds of a split spending. */
export type SpendInterval = 'monthly' | 'biweekly' | 'custom'

export interface SpendingRound {
  no: number
  date: string // YYYY-MM-DD
  amount: number // KRW, whole won
  state: RoundState
  edited: boolean
}

export interface Spending {
  id: string
  name: string
  note?: string
  category: string
  bought: string // YYYY-MM-DD
  amount: number
  currency: Currency
  fxRate: number | null // the rate used for a USD amount
  fxBuffer: number | null // the buffer % used with it; both fixed when the spending is saved (S-3)
  how: SpendHow
  payBy: PayBy
  count: number
  fee: number // KRW, 0 = interest free
  interval: SpendInterval | null // split only
  cancelled: boolean
  /** The card it was paid with (spec 013 S-13); a buffer use needs one with a paying account. */
  cardId?: string | null
  /** Buffer use: the first refill date (spec 013 S-8); null otherwise. */
  refillFrom?: string | null
  rounds: SpendingRound[]
}
