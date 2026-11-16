// JSON body validation with a field-level 400 in the request's language (spec 008 S-10).
// The schemas (server/validation.ts) carry message keys; the language is picked here, per request.
import { zValidator } from '@hono/zod-validator'
import type { z } from 'zod'
import { issueMessage, langOf } from './messages'

export const body = <S extends z.ZodType>(schema: S) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) {
      const issue = r.error.issues[0]
      return c.json({ error: issueMessage(langOf(c), issue), path: issue?.path.join('.') ?? '' }, 400)
    }
  })
