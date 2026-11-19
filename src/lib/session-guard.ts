// One rule for everything that writes the signed-in account's data into the screen state after an await
// (spec 010 A-14): note the session when the work starts, and write only if it is still the same session.
// `next()` is called when the session changes (sign-out, another account); work that started before it
// is dead from then on — its answer, its error and its recovery reload never reach the next account.
export interface Scope {
  /** True while the session the work started in is still the current one. */
  alive(): boolean
  /** Run `fn` (a write to the screen state) only if the session is still the same; returns its result, or undefined when dropped. */
  ifCurrent<R>(fn: () => R): R | undefined
}

export function createSessionGuard() {
  let generation = 0
  return {
    next() { generation++ },
    begin(): Scope {
      const g = generation
      return {
        alive: () => g === generation,
        ifCurrent: <R>(fn: () => R) => (g === generation ? fn() : undefined),
      }
    },
  }
}

/**
 * Run the requests of one save in order, in the session the save started in (spec 010 A-20). Before every
 * request after the first the session is checked: if it has changed (sign-out, another account), the rest
 * is not sent, because a later step reads the store, and the store now belongs to someone else.
 * Returns true when every step ran, false when it stopped at a changed session. A step's error passes through.
 */
export async function runSteps(scope: Scope, steps: (() => Promise<unknown>)[]): Promise<boolean> {
  for (const step of steps) {
    if (!scope.alive()) return false
    await step()
  }
  return scope.alive()
}
