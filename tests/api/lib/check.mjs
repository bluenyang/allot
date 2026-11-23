// Stop at the first failure, shared by the API checks (retro 0.1.7; knowledge: stop-at-first-failure;
// audit 0.1.7 rc.3 F-3): crud.mjs, isolation.mjs, api-keys.mjs, password-keys.mjs, mcp.mjs, budget-rules.mjs.
//
//   ok(cond, msg)       prints PASS or FAIL; a failure counts, and once the run is armed the first one throws Stop
//                       (no further write happens; the script's finally block cleans up)
//   arm()               from here the first failed check stops the run (before it, a failure only counts:
//                       the script checks failures() and exits before its first write)
//   disarm()            the run is over: later failures are only reported (the cleanup's own checks)
//   cleanupStep(l, fn)  runs one cleanup step and never throws: a throw is counted and logged with its label, a
//                       value fn returns is logged; a failed check inside it only reports, and when the run was
//                       still armed, the next settle() stops it
//   settle()            after a nested try/finally whose cleanup steps ran: throws Stop if one of them failed
//                       while the run was armed (so a failed cleanup inside the run still stops it, but only
//                       after every step of that cleanup ran)
//   threw(e)            the main catch: an error that is not Stop counts and is printed
//   failures()          the number of failed checks so far
// Each script is its own process, so the state is this module's.
export class Stop extends Error {}

let failed = 0
let armed = false
let stopped = false
let inCleanup = 0
let owed = null

export function ok(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
  if (cond) return
  failed++
  if (inCleanup > 0) { if (armed && !stopped) owed ??= msg; return }
  if (armed && !stopped) { stopped = true; throw new Stop(msg) }
}

export const arm = () => { armed = true }
export const disarm = () => { stopped = true }
export const failures = () => failed

export async function cleanupStep(label, fn) {
  inCleanup++
  try {
    const r = await fn()
    if (r !== undefined) console.log(`cleanup: ${label} → ${r}`)
    return r
  } catch (e) {
    failed++
    console.log(`FAIL cleanup: ${label} threw: ${e?.message ?? e}`)
    if (armed && !stopped) owed ??= label
    return undefined
  } finally {
    inCleanup--
  }
}

export function settle() {
  if (owed === null || !armed || stopped) { owed = null; return }
  const msg = owed
  owed = null
  stopped = true
  throw new Stop(`cleanup failed: ${msg}`)
}

export function threw(e) {
  if (e instanceof Stop) return
  failed++
  console.log(`FAIL threw: ${e?.stack ?? e}`)
}
