import { createAuthClient } from 'better-auth/vue'

// Same origin: Vite serves the app and proxies /api to the api service.
export const authClient = createAuthClient({ baseURL: window.location.origin, basePath: '/api/auth' })
