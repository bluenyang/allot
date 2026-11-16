import { store } from './store'

/** Chart color of an allocation target: the remainder is c1; the others take c2..c7 in their order. */
export function allocColor(targetId: string): string {
  const t = store.targets.find((x) => x.id === targetId)
  if (!t) return 'var(--c7)'
  if (t.kind === 'remainder') return 'var(--c1)'
  const i = store.targets.filter((x) => x.kind !== 'remainder').findIndex((x) => x.id === targetId)
  return `var(--c${2 + (i % 6)})`
}
export const CAT_COLORS: Record<string, string> = {
  ai: 'var(--c1)', telecom: 'var(--c2)', content: 'var(--c3)', tool: 'var(--c5)', insurance: 'var(--c4)', life: 'var(--c6)',
}
