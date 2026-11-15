// Runtime theme (spec 007 S-7): the user's primary and accent colours become the colour tokens of
// src/style.css, light and dark, with every text/background pair kept at WCAG 4.5:1 — a colour that
// would fall short is darkened (light) or lightened (dark) until it passes. derive() is pure; the
// defaults it gives equal the tokens in style.css (tests/unit/theme.test.ts checks that).
import type { Preferences } from '../data/types'

export const DEFAULT_PRIMARY = '#14705A'
export const DEFAULT_ACCENT = '#E0670E'
export const PRIMARY_PRESETS: [string, string][] = [['#14705A', '초록'], ['#0F6E73', '청록'], ['#1F5F8B', '파랑'], ['#2E3F6E', '남색'], ['#3A4540', '흑연']]
export const ACCENT_PRESETS: [string, string][] = [['#E0670E', '주황'], ['#C98A00', '호박'], ['#D2493B', '적갈'], ['#7A5AB8', '보라']]

const WHITE = '#FFFFFF'
const BLACK = '#000000'
/** Grounds and text the colours sit on (style.css). */
export const GROUND = {
  light: { surface: '#FFFFFF', surface2: '#F9FAF9', text: '#16201B' },
  dark: { surface: '#171D1A', surface2: '#1C2320', text: '#16201B' },
} as const

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
export const isHex = (h: string) => /^#[0-9a-fA-F]{6}$/.test(h)

/** Canvas formula: t of the way from a to b, per channel. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function luminance(h: string): number {
  const [r, g, b] = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** fg moved toward black (or white) in small steps until it reaches `min` against every ground. */
export function ensure(fg: string, grounds: string[], min: number, toward: 'darker' | 'lighter'): string {
  const end = toward === 'darker' ? BLACK : WHITE
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(fg, end, t)
    if (grounds.every((g) => contrast(c, g) >= min)) return c
  }
  return end
}

/** A filled colour (button, KPI cell) and the text on it: white or the text colour, whichever passes; else the fill darkens. */
export function fill(c: string, text: string): { fill: string; ink: string } {
  if (contrast(WHITE, c) >= 4.5) return { fill: c, ink: WHITE }
  if (contrast(text, c) >= 4.5) return { fill: c, ink: text }
  return { fill: ensure(c, [WHITE], 4.5, 'darker'), ink: WHITE }
}

export type Tokens = Record<string, string>

/** The colour tokens for one mode. */
export function derive(primary: string, accent: string, mode: 'light' | 'dark'): Tokens {
  const g = GROUND[mode]
  const P = primary.toUpperCase()
  const A = accent.toUpperCase()
  const p = fill(P, g.text)
  const a = fill(A, g.text)
  if (mode === 'light') {
    const pSoft = mix(P, WHITE, 0.9)
    const aSoft = mix(A, WHITE, 0.88)
    return {
      primary: p.fill, 'primary-ink': p.ink, 'primary-soft': pSoft, 'primary-mid': mix(P, WHITE, 0.45),
      'primary-text': ensure(P, [g.surface, g.surface2, pSoft], 4.5, 'darker'),
      accent: a.fill, 'accent-ink': a.ink, 'accent-soft': aSoft, 'accent-line': mix(A, WHITE, 0.6),
      'accent-text': ensure(mix(A, BLACK, 0.3), [g.surface, aSoft], 4.5, 'darker'),
    }
  }
  const pSoft = mix(P, g.surface, 0.75)
  const aSoft = mix(A, g.surface, 0.78)
  return {
    primary: p.fill, 'primary-ink': p.ink, 'primary-soft': pSoft, 'primary-mid': mix(P, g.surface, 0.45),
    'primary-text': ensure(mix(P, WHITE, 0.45), [g.surface, g.surface2, pSoft], 4.5, 'lighter'),
    accent: a.fill, 'accent-ink': a.ink, 'accent-soft': aSoft, 'accent-line': mix(A, g.surface, 0.45),
    'accent-text': ensure(mix(A, WHITE, 0.3), [g.surface, aSoft], 4.5, 'lighter'),
  }
}

const block = (t: Tokens) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';')

/** CSS that overrides the colour tokens in both modes, mirroring the three blocks of style.css. */
export function themeCss(primary: string, accent: string): string {
  const light = block(derive(primary, accent, 'light'))
  const dark = block(derive(primary, accent, 'dark'))
  return `:root{${light}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}`
}

const CACHE = 'allot.theme'

/**
 * Put the preferences on <html>: mode, corners, density, and the colours when they are not the
 * default. The last applied value is kept in localStorage only so the next load paints in the
 * right colours before the server answers; the server's value always wins.
 */
export function applyTheme(p: Pick<Preferences, 'themeMode' | 'primary' | 'accent' | 'radius' | 'density'>) {
  const root = document.documentElement
  if (p.themeMode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', p.themeMode)
  if (p.radius === 'base') root.removeAttribute('data-radius')
  else root.setAttribute('data-radius', p.radius)
  if (p.density === 'base') root.removeAttribute('data-density')
  else root.setAttribute('data-density', p.density)
  let el = document.getElementById('allot-theme')
  const custom = (p.primary && isHex(p.primary)) || (p.accent && isHex(p.accent))
  if (!custom) el?.remove()
  else {
    if (!el) {
      el = document.createElement('style')
      el.id = 'allot-theme'
      document.head.appendChild(el)
    }
    el.textContent = themeCss(p.primary ?? DEFAULT_PRIMARY, p.accent ?? DEFAULT_ACCENT)
  }
  try { localStorage.setItem(CACHE, JSON.stringify(p)) } catch { /* private window: no cache */ }
}

/** The last theme this browser applied, for the first paint. */
export function cachedTheme(): Parameters<typeof applyTheme>[0] | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) ?? 'null')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}
