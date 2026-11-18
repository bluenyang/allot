import { store } from './store'

/**
 * Chart color of an allocation target (spec 010 HM-19, as the canvas draws it): living is the primary
 * green, subscriptions the signal orange, the fixed ones take the secondary green, the info blue and
 * then the series hues in their order, and the remainder is grey.
 */
const FIXED = ['var(--primary-mid)', 'var(--info)', 'var(--c4)', 'var(--c6)', 'var(--c5)', 'var(--c3)']
export function allocColor(targetId: string): string {
  const t = store.targets.find((x) => x.id === targetId)
  if (!t) return 'var(--c7)'
  if (t.kind === 'remainder') return 'var(--c7)'
  if (t.kind === 'living') return 'var(--primary)'
  if (t.kind === 'subscriptions') return 'var(--accent)'
  const i = store.targets.filter((x) => x.kind === 'fixed').findIndex((x) => x.id === targetId)
  return FIXED[(i < 0 ? 0 : i) % FIXED.length]!
}
export const CAT_COLORS: Record<string, string> = {
  ai: 'var(--c1)', telecom: 'var(--c2)', content: 'var(--c3)', tool: 'var(--c5)', insurance: 'var(--c4)', life: 'var(--c6)',
}
