// Toast state (spec 010 S-5): one message at a time with at most one action. The shell renders
// <Toast v-if="toast.message" ...> from this (wired in the shell unit); anything may call showToast.
import { reactive } from 'vue'

export const toast = reactive({ message: '', actionLabel: '', error: false, onAction: null as (() => void) | null })

let timer: ReturnType<typeof setTimeout> | undefined

export function hideToast() {
  clearTimeout(timer)
  toast.message = ''
  toast.actionLabel = ''
  toast.error = false
  toast.onAction = null
}

/** Show `message`; it goes away by itself after `ms` (default 4s, 8s with an action) unless it is an error, which stays until dismissed. */
export function showToast(message: string, opts: { actionLabel?: string; onAction?: () => void; error?: boolean; ms?: number } = {}) {
  clearTimeout(timer)
  toast.message = message
  toast.actionLabel = opts.actionLabel ?? ''
  toast.onAction = opts.actionLabel ? (opts.onAction ?? null) : null
  toast.error = !!opts.error
  if (!opts.error) timer = setTimeout(hideToast, opts.ms ?? (opts.actionLabel ? 8000 : 4000))
}
