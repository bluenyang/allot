import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./server/db/schema.ts', './server/db/auth-schema.ts'],
  out: './drizzle',
})
