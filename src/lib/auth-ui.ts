// Login methods and auth messages for the screens (spec 006). The server decides; this only
// shows what it says.
import { api } from './api'

export interface Method { id: 'password' | 'oidc' | 'github' | 'google'; name: string }

/** The login methods that are on now (public: id and display name only). */
export async function loadMethods(): Promise<Method[]> {
  const res = await fetch('/api/auth-methods')
  if (!res.ok) return [{ id: 'password', name: '비밀번호' }]
  return ((await res.json()) as { methods: Method[] }).methods
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
    case 'SIGNUP_CLOSED': return '이 로그인 방식으로는 새 계정을 만들 수 없어요. 관리자에게 계정을 요청해 주세요.'
    case 'NOT_ALLOWED': return '허용된 사용자가 아니에요. 관리자에게 문의해 주세요.'
    case 'PENDING_APPROVAL': return '관리자 승인을 기다리고 있어요. 승인되면 다시 로그인해 주세요.'
    case 'BANNED_USER': return '정지된 계정이에요. 관리자에게 문의해 주세요.'
    case 'account_not_linked': return '같은 이메일의 계정이 이미 있어요. 그 계정으로 로그인한 뒤 계정 화면에서 연결해 주세요.'
    case 'METHOD_DISABLED': return '지금은 쓸 수 없는 로그인 방식이에요.'
    case 'EMAIL_DOES_NOT_MATCH': return '이메일이 달라 연결하지 못했어요.'
    case 'ACCOUNT_ALREADY_LINKED_TO_DIFFERENT_USER': case 'account_already_linked_to_different_user':
      return '그 계정은 이미 다른 사용자에게 연결되어 있어요.'
    case 'state_mismatch': case 'invalid_state': return '로그인이 중간에 끊겼어요. 다시 해 주세요.'
    default: return code ? '로그인하지 못했어요. 잠시 뒤에 다시 해 주세요.' : ''
  }
}

/** Read ?error= from the address once, then drop it from the address bar. */
export function takeErrorFromUrl(): string {
  const u = new URL(window.location.href)
  const code = u.searchParams.get('error')
  if (!code) return ''
  u.searchParams.delete('error')
  u.searchParams.delete('error_description')
  history.replaceState(null, '', u.pathname + u.search + u.hash)
  return authMessage(code)
}

export const PROVIDER_NAME: Record<string, string> = { credential: '비밀번호', oidc: 'OIDC', github: 'GitHub', google: 'Google' }
