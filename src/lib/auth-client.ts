import { createAuthClient } from 'better-auth/vue'

/** Seconds the server asked to wait in its last 429 (X-Retry-After), for the session wait (spec 007 S-14). */
let retryAfter = 0
export const lastRetryAfter = () => retryAfter

// Same origin: Vite serves the app and proxies /api to the api service.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  fetchOptions: {
    onResponse(ctx) {
      if (ctx.response.status === 429) retryAfter = Number(ctx.response.headers.get('X-Retry-After')) || 0
    },
  },
})
