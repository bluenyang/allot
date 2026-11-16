// Screen language (spec 008 S-9): Korean and English. Messages are plain TypeScript objects
// (ko.ts is the source, en.ts must have every key). `t` is the typed shortcut for the pages and
// the plain functions of src/lib; it follows the language reactively wherever it is read in a
// template, computed or watcher.
import { createI18n } from 'vue-i18n'
import { en } from './en'
import { ko, type Messages } from './ko'

export type Lang = 'ko' | 'en'
export const LANGS: readonly Lang[] = ['ko', 'en']

type Path<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>
}[keyof T & string]
/** A key of the message lists, e.g. 'shell.menu'. */
export type MessageKey = Path<Messages>

const KEY = 'allot.lang'

/** The browser's language: English when the first language starts with "en", else Korean (also outside a browser, as in the unit tests). */
export function browserLang(nav: readonly string[] | undefined = typeof window === 'undefined' ? undefined : (navigator.languages?.length ? navigator.languages : [navigator.language])): Lang {
  const first = (nav?.[0] ?? '').toLowerCase()
  return first === 'en' || first.startsWith('en-') ? 'en' : 'ko'
}

const read = (): Lang | null => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'ko' || v === 'en' ? v : null
  } catch {
    return null
  }
}
const write = (l: Lang | null) => {
  try {
    if (l) localStorage.setItem(KEY, l)
    else localStorage.removeItem(KEY)
  } catch { /* storage blocked: the choice lasts for this page only */ }
}

/** Before sign-in: the language this browser last used by choice, else the browser's own. */
export const languageBeforeSignIn = (): Lang => read() ?? browserLang()

/** After sign-in: the account's choice, else the browser's language. */
export const languageOf = (pref: Lang | null | undefined): Lang => pref ?? browserLang()

export const i18n = createI18n({
  legacy: false,
  locale: languageBeforeSignIn(),
  fallbackLocale: 'ko',
  messages: { ko, en },
  missingWarn: false,
  fallbackWarn: false,
})

/** The language now showing (reactive). */
export const lang = i18n.global.locale as unknown as { value: Lang }

/** Show this language and write it on <html lang>. */
export function setLang(l: Lang) {
  lang.value = l
  if (typeof document !== 'undefined') document.documentElement.lang = l
}

/**
 * Apply the account's choice (null = follow the browser). An explicit choice is also kept in this
 * browser, so the sign-in screen after a sign-out speaks the language the user chose.
 */
export function applyPreference(pref: Lang | null | undefined) {
  write(pref ?? null)
  setLang(languageOf(pref))
}

type Vars = Record<string, string | number>
/** A message in the current language; `{name}` is replaced from `vars`. */
export const t = (key: MessageKey, vars?: Vars): string => (vars ? i18n.global.t(key, vars) : i18n.global.t(key))

/** A message in a given language (for the pure formatters, which take the language as an argument). */
export const tl = (l: Lang, key: MessageKey, vars?: Vars): string => i18n.global.t(key, vars ?? {}, { locale: l })

setLang(lang.value)
