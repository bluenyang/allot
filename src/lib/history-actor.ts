// The "who" filter of 변경 내역 (spec 010 S-9): 전체, 나 (the user's own sets), AI (an API key's). The server's own
// sets (the daily rate refresh, actor `system`, spec 013 S-23) are listed only under 전체. The count of a chip and
// the list it shows use the same rule (review rc3-1 F-6). Pure; no UI.
export type ActorFilter = 'all' | 'me' | 'ai'
export const ACTOR_KIND: Record<Exclude<ActorFilter, 'all'>, string> = { me: 'user', ai: 'api_key' }

export const byActor = <T extends { actorKind: string }>(sets: readonly T[], actor: ActorFilter): T[] =>
  actor === 'all' ? [...sets] : sets.filter((s) => s.actorKind === ACTOR_KIND[actor])
