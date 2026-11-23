// The "만료 연장" choices of an API key (spec 013 S-25, review rc3-1 F-9). The server sets the expiry to now + n days,
// so a choice can end sooner than the key does today; each choice shows the date it gives and says when it is
// sooner. Nothing is hidden or refused: the user may still choose it. Pure; no UI.
const DAY_MS = 86_400_000

export interface ExtendChoice {
  days: number
  /** The expiry the choice gives (ISO). */
  at: string
  /** It ends sooner than the key's expiry now (any date is sooner than "no expiry"). */
  shorter: boolean
}

export const extendChoices = (days: readonly number[], expiresAt: string | null, now: Date = new Date()): ExtendChoice[] =>
  days.map((n) => {
    const at = new Date(now.getTime() + n * DAY_MS)
    return { days: n, at: at.toISOString(), shorter: expiresAt === null || at.getTime() < Date.parse(expiresAt) }
  })
