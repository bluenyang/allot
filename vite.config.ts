import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

// In Docker the api runs as the `api` service; on the host, `pnpm dev:api` on :3000.
const api = process.env.API_URL ?? 'http://localhost:3000'
// Development only: the test OIDC provider in docker/compose.dev.yaml (spec 006 W-9).
const dex = process.env.DEX_URL
// Shown in the footer (spec 007 S-2).
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

export default defineConfig({
  plugins: [vue()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    // Defence in depth for `pnpm dev` on the host (Docker mounts only the front end):
    // Vite's own deny list covers .env/keys/.git but not these.
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.loctx/**', '**/server/**', '**/tests/**', '**/docker/**', '**/drizzle/**', '*.md', '**/.auth.json', '**/.state.json'],
    },
    proxy: {
      '/api': {
        target: api,
        changeOrigin: false,
        // The api trusts only this header for the client IP (login rate limit),
        // so always overwrite it with the real socket address.
        configure: (proxy) => {
          proxy.on('proxyReq', (req, incoming) => {
            req.setHeader('x-allot-client-ip', incoming.socket.remoteAddress ?? 'unknown')
          })
        },
      },
      ...(dex ? { '/dex': { target: dex, changeOrigin: false } } : {}),
    },
  },
})
