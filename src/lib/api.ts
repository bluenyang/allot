// Thin fetch wrapper for the same-origin API (Vite proxies /api in development).
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
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (res.status === 401) {
    onUnauthorized.handler()
    throw new ApiError(401, '로그인이 필요해요.')
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `요청이 실패했어요 (${res.status}).`)
  return data as T
}
