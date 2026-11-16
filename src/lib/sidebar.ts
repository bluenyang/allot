// Sidebar width and folding (spec 007 S-20). A screen convenience of this browser, not an account setting:
// kept in localStorage, and everything works with the defaults when storage is blocked.
import { ref } from 'vue'

export const SIDE = { min: 200, max: 360, default: 272, folded: 64 } as const
const KEY_W = 'allot.side.width'
const KEY_F = 'allot.side.folded'

const read = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage blocked: keep it for this page only */ } }
const clamp = (n: number) => Math.min(SIDE.max, Math.max(SIDE.min, Math.round(n)))

const saved = Number(read(KEY_W))
export const sideWidth = ref<number>(Number.isFinite(saved) && saved > 0 ? clamp(saved) : SIDE.default)
export const sideFolded = ref<boolean>(read(KEY_F) === '1')

/** Set the open width (clamped to 200–360); `persist` false while a drag is still moving. */
export function setSideWidth(px: number, persist = true) {
  sideWidth.value = clamp(px)
  if (persist) write(KEY_W, String(sideWidth.value))
}

/** Fold to icons, or open again at the width it had. */
export function toggleSide() {
  sideFolded.value = !sideFolded.value
  write(KEY_F, sideFolded.value ? '1' : '0')
}
