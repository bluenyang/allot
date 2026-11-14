// Return to a mobile app after a login in the system browser (spec 006 S-6).
//   1. The app opens https://<allot>/#app-login?return=<app URL> in the system browser.
//   2. That page signs in in the browser (so the OAuth state cookie stays with the browser),
//      then calls POST /api/app-login/ticket { returnTo }.
//   3. Only for a URL listed in ALLOT_APP_RETURN_URLS, the server issues a 3-minute one-time
//      token and answers `<app URL>?ott=…`; the page sends the browser there.
//   4. The app trades the token at POST /api/auth/one-time-token/verify for a bearer session
//      (`set-auth-token` header). A token works once.
// Empty ALLOT_APP_RETURN_URLS (the default): the whole path is off.

/** ALLOT_APP_RETURN_URLS: comma-separated, exact app URLs (custom scheme), e.g. allot://auth. */
export function parseAppReturnUrls(raw: string | undefined): string[] {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const u of list) {
    let url: URL
    try { url = new URL(u) } catch { throw new Error(`ALLOT_APP_RETURN_URLS: not a URL: ${u}`) }
    if (['http:', 'https:', 'javascript:', 'data:', 'file:'].includes(url.protocol)) {
      throw new Error(`ALLOT_APP_RETURN_URLS: use the app's own scheme (like allot://auth), got ${u}`)
    }
    if (url.search || url.hash) throw new Error(`ALLOT_APP_RETURN_URLS: no query or fragment, got ${u}`)
  }
  return list
}

export const APP_RETURN_URLS = parseAppReturnUrls(process.env.ALLOT_APP_RETURN_URLS)

/** The exact listed URL, or undefined. */
export const allowedReturn = (u: unknown) => (typeof u === 'string' && APP_RETURN_URLS.includes(u) ? u : undefined)
