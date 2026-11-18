<script setup lang="ts">
// Field help (spec 010 S-7, canvas `.tip`): a small round "?" next to a label. Hover or focus shows the
// text in a bubble placed in the viewport (below the "?", above it when there is no room, never past
// an edge); Escape closes the bubble only. The name read aloud is "도움말: …". Keep it beside the
// <label>, not inside it, so the field's own name stays short.
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { t } from '../i18n'

// One Escape rule for every tip, however it was opened (focus, hover, both, several at once): while any
// is open, Escape closes them all, is consumed (the editor's own Escape never starts) and focus stays.
const openTips = new Set<() => void>()
function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !openTips.size) return
  e.preventDefault()
  e.stopPropagation()
  for (const close of [...openTips]) close()
}
function track(close: () => void, on: boolean) {
  if (on) {
    if (!openTips.size) document.addEventListener('keydown', onEscape, true)
    openTips.add(close)
  } else if (openTips.delete(close) && !openTips.size) document.removeEventListener('keydown', onEscape, true)
}

defineProps<{ text: string }>()
const open = ref(false)
const el = ref<HTMLElement | null>(null)
const bub = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0, width: 240 })

async function show() {
  open.value = true
  track(hide, true)
  await nextTick()
  const r = el.value?.getBoundingClientRect()
  if (!r || !bub.value) return
  const width = Math.min(240, window.innerWidth - 16)
  const left = Math.min(Math.max(8, r.left - 8), window.innerWidth - width - 8)
  const h = bub.value.offsetHeight
  const top = r.bottom + 8 + h > window.innerHeight - 8 ? Math.max(8, r.top - 8 - h) : r.bottom + 8
  pos.value = { left, top, width }
}
const hide = () => { open.value = false; track(hide, false) }
onBeforeUnmount(hide)
</script>

<template>
  <span ref="el" class="tip" tabindex="0" role="img" :aria-label="`${t('common.help')}: ${text}`" :class="{ on: open }" @mouseenter="show" @mouseleave="hide" @focus="show" @blur="hide">?<span v-show="open" ref="bub" class="bub" role="tooltip" aria-hidden="true" :style="{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px` }">{{ text }}</span></span>
</template>

<style scoped>
.tip{position:relative;display:inline-grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:var(--border);color:var(--text-2);font-size:11px;font-weight:700;line-height:1;cursor:help}
.tip.on{background:var(--primary);color:var(--primary-ink)}
.tip:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px}
.bub{position:fixed;z-index:10;padding:8px 10px;border-radius:var(--r-card);background:var(--text);color:var(--surface);font-size:12px;font-weight:400;line-height:1.45;text-align:left;white-space:normal;box-shadow:var(--shadow-pop);cursor:default}
</style>
