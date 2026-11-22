// Login methods and auth messages for the screens (spec 006). The server decides; this only
// shows what it says.
import { t } from '../i18n'
import { api } from './api'

export interface Method { id: 'password' | 'oidc' | 'github' | 'google'; name: string }

/** The login methods that are on now (public: id and display name only). */
export async function loadMethods(): Promise<Method[]> {
  const res = await fetch('/api/auth-methods')
  if (!res.ok) return [{ id: 'password', name: t('auth.password') }]
  return ((await res.json()) as { methods: Method[] }).methods.map((m) => (m.id === 'password' ? { ...m, name: t('auth.password') } : m))
}

/** Start an external login; the browser leaves for the provider and comes back to `back`. */
export async function startSocial(provider: string, back: string, link = false) {
  const { url } = await api<{ url?: string }>('POST', link ? '/api/auth/link-social' : '/api/auth/sign-in/social', {
    provider, callbackURL: back, errorCallbackURL: back,
  })
  if (url) window.location.href = url
}

/** What an auth error code means, in the user's words. */
export function authMessage(code: string | null | undefined): string {
  switch (code) {
    case 'SIGNUP_CLOSED': return t('auth.SIGNUP_CLOSED')
    case 'NOT_ALLOWED': return t('auth.NOT_ALLOWED')
    case 'PENDING_APPROVAL': return t('auth.PENDING_APPROVAL')
    case 'BANNED_USER': return t('auth.BANNED_USER')
    case 'account_not_linked': return t('auth.account_not_linked')
    case 'METHOD_DISABLED': return t('auth.METHOD_DISABLED')
    case 'EMAIL_DOES_NOT_MATCH': return t('auth.EMAIL_DOES_NOT_MATCH')
    case 'ACCOUNT_ALREADY_LINKED_TO_DIFFERENT_USER': case 'account_already_linked_to_different_user':
      return t('auth.ALREADY_LINKED')
    case 'state_mismatch': case 'invalid_state': return t('auth.state_mismatch')
    default: return code ? t('auth.other') : ''
  }
}

/**
 * Read ?error= from the address once, then drop it from the address bar (spec 012 S-5). The router keeps
 * its own copy of the address in history.state.current and writes it back on the next navigation, so
 * that copy is cleaned too, or Back would bring the error back (review 1 F-1).
 */
export function takeErrorFromUrl(): string {
  const u = new URL(window.location.href)
  const code = u.searchParams.get('error')
  if (!code) return ''
  u.searchParams.delete('error')
  u.searchParams.delete('error_description')
  const clean = u.pathname + u.search + u.hash
  const state = history.state as Record<string, unknown> | null
  history.replaceState(state && typeof state.current === 'string' ? { ...state, current: clean } : state, '', clean)
  return authMessage(code)
}

/** The name of a login method on the account screen (a getter: the password name follows the language). */
export const providerName = (id: string): string => (id === 'credential' ? t('auth.password') : ({ oidc: 'OIDC', github: 'GitHub', google: 'Google' } as Record<string, string>)[id] ?? id)
