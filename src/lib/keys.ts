// API keys for the read-only MCP endpoint (spec 008 S-4): the calls the 설정 › AI·연동 screen and
// the admin screen make. A key's text comes back once, from createKey, and is never stored here.
import { api } from './api'

export interface KeyItem {
  id: string
  name: string
  /** The first characters, to tell keys apart in the list. */
  start: string
  permissions: Record<string, string[]>
  /** Where a write key's proposals are confirmed (spec 009); null for a read-only key. */
  confirm: 'ui' | 'chat' | null
  createdAt: string | null
  expiresAt: string | null
  lastUsedAt: string | null
}
export interface KeyList { keys: KeyItem[]; policy: { noExpiry: boolean }; max: number }
export interface KeyPolicy { noExpiry: boolean; source: 'default' | 'db' | 'env'; locked: boolean; capped?: number }

export const listKeys = () => api<KeyList>('GET', '/api/keys')
export interface NewKey { name: string; expiresInDays: number | null; write?: boolean; confirm?: 'ui' | 'chat' }
/** `expiresInDays` null = no expiry (only while the server allows it). `confirm` goes with `write` only. */
export const createKey = (k: NewKey) => api<{ key: string; item: KeyItem }>('POST', '/api/keys', k)
export const revokeKey = (id: string) => api<void>('DELETE', `/api/keys/${encodeURIComponent(id)}`)
export const getKeyPolicy = () => api<KeyPolicy>('GET', '/api/admin/api-keys')
export const setKeyPolicy = (noExpiry: boolean) => api<KeyPolicy>('PUT', '/api/admin/api-keys', { noExpiry })

/**
 * How many proposals each key has made, all time (spec 010 S-11, "쓰기 제안 n건"). The API has no count,
 * so this reads the proposals the account can already see, a page at a time, and counts them by key.
 * `capped` is true when it stopped at the page limit before the end.
 */
export async function countProposalsByKey(pageSize = 100, maxPages = 30): Promise<{ counts: Record<string, number>; capped: boolean }> {
  const counts: Record<string, number> = {}
  let before = ''
  for (let i = 0; i < maxPages; i++) {
    const page = await api<{ id: string; keyId: string; createdAt: string }[]>('GET', `/api/proposals?limit=${pageSize}${before}`)
    for (const p of page) counts[p.keyId] = (counts[p.keyId] ?? 0) + 1
    if (page.length < pageSize) return { counts, capped: false }
    const last = page.at(-1)!
    before = `&before=${encodeURIComponent(last.createdAt)}&beforeId=${encodeURIComponent(last.id)}`
  }
  return { counts, capped: true }
}
