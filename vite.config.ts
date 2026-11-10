import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// In Docker the api runs as the `api` service; on the host, `pnpm dev:api` on :3000.
const api = process.env.API_URL ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [vue()],
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
    },
  },
})
