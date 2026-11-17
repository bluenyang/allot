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
