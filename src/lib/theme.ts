// Runtime theme (spec 007 S-7): the user's primary and accent colours become the colour tokens of
// src/style.css, light and dark, with every text/background pair kept at WCAG 4.5:1 — a colour that
// would fall short is darkened (light) or lightened (dark) until it passes. Dark colours come from
// the canvas `lift` formula (spec 010 S-2). derive() is pure; the
// defaults it gives equal the tokens in style.css (tests/unit/theme.test.ts checks that).
import type { Preferences } from '../data/types'

export const DEFAULT_PRIMARY = '#14705A'
export const DEFAULT_ACCENT = '#E0670E'
/** [colour, id]: the id names the colour in the messages (theme.preset.<id>). */
export const PRIMARY_PRESETS: [string, string][] = [['#14705A', 'green'], ['#0F6E73', 'teal'], ['#1F5F8B', 'blue'], ['#2E3F6E', 'navy'], ['#3A4540', 'graphite']]
export const ACCENT_PRESETS: [string, string][] = [['#E0670E', 'orange'], ['#C98A00', 'amber'], ['#D2493B', 'brick'], ['#7A5AB8', 'purple']]

const WHITE = '#FFFFFF'
const BLACK = '#000000'
/** Grounds and text the colours sit on (style.css). */
export const GROUND = {
  light: { bg: '#F5F6F5', surface: '#FFFFFF', surface2: '#F9FAF9', text: '#16201B' },
  dark: { bg: '#0F1011', surface: '#17181A', surface2: '#1D1F21', text: '#ECEDEE' },
} as const
/** Text on a filled dark primary / accent (the canvas ink pair); white is the fallback. */
const DARK_PRIMARY_INK = '#0C0D0E'
const DARK_ACCENT_INK = '#16201B'

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

/**
 * A filled colour (button, KPI cell, chart bar) and the text on it. The fill must stand out from the
 * page ground (3:1, spec 007 S-7, review 1 R11) and its text must read (4.5:1, white or the text
 * colour). It moves away from the ground — darker in light mode, lighter in dark — until both hold.
 */
export function fill(c: string, text: string, ground: string, toward: 'darker' | 'lighter'): { fill: string; ink: string } {
  const end = toward === 'darker' ? BLACK : WHITE
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const f = mix(c, end, t)
    if (contrast(f, ground) < 3) continue
    if (contrast(WHITE, f) >= 4.5) return { fill: f, ink: WHITE }
    if (contrast(text, f) >= 4.5) return { fill: f, ink: text }
  }
  return { fill: end, ink: toward === 'darker' ? WHITE : text }
}

/**
 * Canvas `lift`: a colour's HSL lightness raised to at least `L` and its saturation capped at `S`,
 * so a light-mode brand colour reads on a dark ground (primary L .46 / S .60, accent L .54 / S .85).
 */
export function lift(hex: string, L: number, S: number): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number]
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  let l = (mx + mn) / 2
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  l = Math.max(l, L)
  s = Math.min(s, S)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const v = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return '#' + v.map((q) => Math.round((q + m) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * Dark filled colour: the lifted colour, lightened further only when it does not stand out from the
 * ground (3:1) or neither the dark ink nor white reaches 4.5:1 on it.
 */
function fillDark(c: string, ink: string, ground: string): { fill: string; ink: string } {
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const f = mix(c, WHITE, t)
    if (contrast(f, ground) < 3) continue
    if (contrast(ink, f) >= 4.5) return { fill: f, ink }
    if (contrast(WHITE, f) >= 4.5) return { fill: f, ink: WHITE }
  }
  return { fill: WHITE, ink }
}

export type Tokens = Record<string, string>

/** The colour tokens for one mode. Neutrals, semantic colours and the dark selected grounds stay in style.css. */
export function derive(primary: string, accent: string, mode: 'light' | 'dark'): Tokens {
  const g = GROUND[mode]
  const P = primary.toUpperCase()
  const A = accent.toUpperCase()
  if (mode === 'light') {
    const p = fill(P, g.text, g.surface, 'darker')
    const a = fill(A, g.text, g.surface, 'darker')
    const pSoft = mix(P, WHITE, 0.9)
    const aSoft = mix(A, WHITE, 0.88)
    return {
      primary: p.fill, 'primary-ink': p.ink, 'primary-soft': pSoft, 'primary-mid': mix(P, WHITE, 0.45),
      'primary-text': ensure(P, [g.surface, g.surface2, pSoft], 4.5, 'darker'),
      'primary-hover': ensure(mix(p.fill, BLACK, 0.19), [g.surface, g.bg], 4.5, 'darker'), 'primary-tint': mix(P, WHITE, 0.952), 'primary-line': mix(P, WHITE, 0.8),
      accent: a.fill, 'accent-ink': a.ink, 'accent-soft': aSoft, 'accent-line': mix(A, WHITE, 0.6),
      'accent-text': ensure(mix(A, BLACK, 0.3), [g.surface, aSoft], 4.5, 'darker'),
    }
  }
  const lp = lift(P, 0.46, 0.6)
  const la = lift(A, 0.54, 0.85)
  const p = fillDark(lp, DARK_PRIMARY_INK, g.surface)
  const a = fillDark(la, DARK_ACCENT_INK, g.surface)
  const pSoft = mix(p.fill, g.surface, 0.84)
  const aSoft = mix(a.fill, g.surface, 0.84)
  return {
    primary: p.fill, 'primary-ink': p.ink, 'primary-soft': pSoft, 'primary-mid': mix(p.fill, g.surface, 0.45),
    'primary-text': ensure(p.fill, [g.surface, g.surface2, pSoft], 4.5, 'lighter'),
    'primary-hover': ensure(mix(p.fill, WHITE, 0.25), [g.surface, g.bg], 4.5, 'lighter'),
    accent: a.fill, 'accent-ink': a.ink, 'accent-soft': aSoft, 'accent-line': mix(a.fill, g.surface, 0.55),
    'accent-text': ensure(a.fill, [g.surface, aSoft], 4.5, 'lighter'),
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
