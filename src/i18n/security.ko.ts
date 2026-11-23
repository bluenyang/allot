// Korean messages of the password policy and API key management (spec 013 rc.3 W-20).
// Merged in src/i18n/index.ts; kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const securityKo = {
  security: {
    title: '보안',
  },
} as const

export type SecurityMessages = Widen<typeof securityKo>
