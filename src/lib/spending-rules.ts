// The rules a spending's rounds must keep as a whole (spec 011 S-2, S-4, S-6). One function, used by the
// server's zod schema and by the revert check (server/changes.ts), so a saved spending and a reverted one
// obey the same rules. Pure: no imports from the server.
import type { RoundState, SpendHow } from '../data/types'

/** The largest KRW amount one round can hold (a PostgreSQL integer). */
export const ROUND_MAX = 2_147_483_647

export interface RoundsShape {
  how: SpendHow
  count: number
  rounds: { no: number; amount: number; state: RoundState }[]
}

/**
 * Which field breaks the rules, or null.
 * - lump is one round and count 1; installment and split need count 2..60
 * - rounds are numbered 1.. in order; an early payoff merges the rounds left and adds one,
 *   so there are `count` rounds plus at most one per merged round (a lump has no merged round)
 * - what is still to pay or paid (not merged) adds up to at most ROUND_MAX, so an early payoff always fits one round
 */
export function roundsProblem(x: RoundsShape): 'count' | 'rounds' | null {
  if (x.how === 'lump' ? x.count !== 1 : x.count < 2) return 'count'
  if (x.rounds.some((r, i) => r.no !== i + 1)) return 'rounds'
  const merged = x.rounds.filter((r) => r.state === 'merged').length
  const extra = x.rounds.length - x.count
  if (extra < 0 || extra > merged) return 'rounds'
  if (x.how === 'lump' && (x.rounds.length !== 1 || merged !== 0)) return 'rounds'
  const live = x.rounds.reduce((a, r) => a + (r.state === 'merged' ? 0 : r.amount), 0)
  if (live > ROUND_MAX) return 'rounds'
  return null
}
