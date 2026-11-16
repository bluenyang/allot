// Host and Origin checks for the MCP endpoint (spec 008 S-8): DNS-rebinding and cross-site
// browser requests are refused. A native MCP client sends no Origin.
export interface GuardOptions {
  /** TRUSTED_ORIGINS, parsed (scheme://host[:port]); undefined = development behaviour. */
  trustedOrigins?: string[]
  /** BETTER_AUTH_URL, when set. */
  publicUrl?: string
}

const originOf = (u: string | undefined) => { try { return u ? new URL(u).origin : undefined } catch { return undefined } }

/** Is the request's Host (and Origin, when it has one) one this server answers to? */
export function hostAndOriginOk(host: string | undefined, origin: string | undefined, o: GuardOptions): boolean {
  const h = host?.toLowerCase()
  const pub = originOf(o.publicUrl)
  const trusted = o.trustedOrigins?.length ? [...o.trustedOrigins, ...(pub ? [pub] : [])] : undefined
  if (trusted) {
    // Production: only the listed addresses, whatever the request claims.
    const hosts = trusted.map((t) => new URL(t).host.toLowerCase())
    if (!h || !hosts.includes(h)) return false
    return origin === undefined || trusted.includes(origin)
  }
  // Development: no list; an Origin must be the address the request was sent to.
  if (origin === undefined) return true
  try { return !!h && new URL(origin).host.toLowerCase() === h } catch { return false }
}
