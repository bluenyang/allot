// Failed-authentication limit per client address (spec 008 S-8): `max` failures within `windowMs`
// block the address until the oldest of them ages out. In memory, one process (the production image
// runs one) and bounded: past `maxAddresses` the least recently failing address is forgotten.
export class FailureLimiter {
  private hits = new Map<string, number[]>()

  constructor(private max = 20, private windowMs = 600_000, private maxAddresses = 10_000) {}

  private recent(ip: string, now: number): number[] {
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs)
    if (list.length) this.hits.set(ip, list)
    else this.hits.delete(ip)
    return list
  }

  /** Seconds until the address may try again, or 0 when it is not blocked. */
  blockedFor(ip: string, now = Date.now()): number {
    const list = this.recent(ip, now)
    if (list.length < this.max) return 0
    return Math.max(1, Math.ceil((list[list.length - this.max]! + this.windowMs - now) / 1000))
  }

  fail(ip: string, now = Date.now()): void {
    const list = this.recent(ip, now)
    list.push(now)
    // re-insert so the Map's first key is always the least recently failing address
    this.hits.delete(ip)
    this.hits.set(ip, list)
    while (this.hits.size > this.maxAddresses) this.hits.delete(this.hits.keys().next().value as string)
  }
}
