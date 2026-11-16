// Thin fetch wrapper for the same-origin API (Vite proxies /api in development).
// Every request names the screen language, so the server's messages come in it (spec 008 S-10).
import { lang, t } from '../i18n'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

/** Set by the app shell: what to do when the session is gone (show the login screen). */
export const onUnauthorized = { handler: () => {} }

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'accept-language': lang.value, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (res.status === 401) {
    onUnauthorized.handler()
    throw new ApiError(401, t('api.unauthorized'))
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? t('api.failed', { status: res.status }))
  return data as T
}
