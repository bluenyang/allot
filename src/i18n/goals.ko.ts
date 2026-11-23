// Korean messages of the goal cards of Pending changes (spec 013 W-8). Loaded with the first screen
// (merged in src/i18n/index.ts); kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const goalsKo = {
  goals: {
    title: '목표 도달',
    /** an account name that already ends with this word takes `bodyNamed` (no doubled word) */
    suffix: '통장',
    body: '{name} 통장이 목표 {goal}에 닿았어요 (예상 {ym}). 이 통장으로 보내기를 멈출까요?',
    bodyNamed: '{name}이 목표 {goal}에 닿았어요 (예상 {ym}). 이 통장으로 보내기를 멈출까요?',
    waiting: '확인 대기',
    changes: '{ym}부터 바뀌는 것',
    send: '{name}에 보내는 돈',
    remainder: '{ym} 나머지',
    hint: '멈추면 {ym}부터 이 통장 금액이 0이 되어 나머지로 남아요. 변경 내역에서 되돌릴 수 있고, 통장 창의 다시 보내기로 되살려요.',
    stop: '멈추기',
    keep: '계속 보내기',
    stopped: '{name}으로 보내기를 {ym}부터 멈췄어요',
    kept: '{name}으로 계속 보내요. 목표를 바꾸면 다시 알려 드려요',
    toHistory: '변경 내역',
    maturityTitle: '만기',
    maturityBody: '{name} · {ym} 만기예요. 이 통장으로 보내기를 멈출까요?',
    maturityHint: '멈추면 {ym}부터 이 상품 금액이 0이 되어 나머지로 남아요. 변경 내역에서 되돌릴 수 있어요. 계속 보내기는 이 브라우저에만 기억해요.',
    maturityKept: '{name}으로 계속 보내요. 이 브라우저에만 기억해요',
  },
} as const

export type GoalsMessages = Widen<typeof goalsKo>
