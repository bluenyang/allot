// The 지출 일반·할부 CSV (spec 013 S-17): the spendings a tab shows, one row per round — 지출, 분류, 산 날, 방식,
// 결제 수단, 회차, 날짜, 금액, 상태 — with the headers in the screen language. Built from the state in the browser.
import { t, type MessageKey } from '../i18n'
import { store } from './store'
import { roundSuffix } from './labels'
import type { CsvCell } from './csv'
import type { Spending, SpendingRound } from '../data/types'

const HOW: Record<Spending['how'], MessageKey> = {
  lump: 'spending.ed.howLump', installment: 'spending.ed.howInst', split: 'spending.ed.howSplit', buffer: 'spending.ed.howBuffer',
}

/** The payment method as the lists name it: a chosen card by its name, else the kind. */
function payOf(s: Spending): string {
  const c = s.cardId ? store.cards.find((x) => x.id === s.cardId) : undefined
  if (c && (s.payBy === 'card' || s.how === 'buffer')) return c.name + (c.last4 ? ` ${c.last4}` : '')
  return t(`spending.gen.pay.${s.payBy}` as MessageKey)
}

/** A round's state: paid, to pay, merged by an early payoff; an open round of a cancelled spending is 취소. */
function stateOf(s: Spending, r: SpendingRound): string {
  if (s.cancelled && r.state === 'left') return t('spending.ed.stateCancelled')
  return t(`spending.ed.tag.${r.state}` as MessageKey)
}

export function spendingCsvRows(list: Spending[]): CsvCell[][] {
  const H = (k: string) => t(`spending.csv.${k}` as MessageKey)
  const rows: CsvCell[][] = [['name', 'category', 'bought', 'how', 'pay', 'round', 'date', 'amount', 'state'].map(H)]
  for (const s of list) {
    for (const r of [...s.rounds].sort((a, b) => a.no - b.no)) {
      rows.push([s.name, s.category, s.bought, t(HOW[s.how]), payOf(s), roundSuffix(s, r) || r.no, r.date, r.amount, stateOf(s, r)])
    }
  }
  return rows
}
