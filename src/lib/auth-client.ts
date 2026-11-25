import { createAuthClient } from 'better-auth/vue'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'

/** Seconds the server asked to wait in its last 429 (X-Retry-After), for the session wait (spec 007 S-14). */
let retryAfter = 0
export const lastRetryAfter = () => retryAfter

// Same origin: Vite serves the app and proxies /api to the api service.
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  // spec 015 S-5: on the OAuth sign-in and consent screens the signed request in the address goes along with the
  // sign-in, so Better Auth continues the app's authorization after it (the plugin does nothing on other pages).
  plugins: [oauthProviderClient()],
  fetchOptions: {
    onResponse(ctx) {
      if (ctx.response.status === 429) retryAfter = Number(ctx.response.headers.get('X-Retry-After')) || 0
    },
  },
})
