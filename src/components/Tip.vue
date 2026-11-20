<script setup lang="ts">
// Field help (spec 010 S-7, canvas `.tip`): a small round "?" next to a label. Hover, focus or a tap shows the
// text in a bubble on Reka's Popover, placed in the viewport (below the "?", above it when there is no
// room, never past an edge); Escape closes the bubble only. The name read aloud is "도움말: …". Keep it beside the
// <label>, not inside it, so the field's own name stays short.
import { PopoverAnchor, PopoverContent, PopoverRoot } from 'reka-ui'
import { onBeforeUnmount, ref } from 'vue'
import { t } from '../i18n'

// One Escape rule for every tip, however it was opened (focus, hover, both, several at once): while any
// is open, Escape closes them all. It is consumed (the editor's own Escape never starts) only when an open
// tip sits in the dialog the key goes to; a tip left open behind another dialog (a confirmation on top)
// is closed but the key still reaches that dialog.
const openTips = new Map<() => void, HTMLElement | null>()
function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !openTips.size) return
  const topDialog = (e.target instanceof Element ? e.target : document.activeElement)?.closest('[role="dialog"],[role="alertdialog"]') ?? null
  const here = [...openTips.values()].some((el) => (el?.closest('[role="dialog"],[role="alertdialog"]') ?? null) === topDialog)
  if (here) {
    e.preventDefault()
    e.stopPropagation()
  }
  for (const close of [...openTips.keys()]) close()
}
function track(close: () => void, el: HTMLElement | null, on: boolean) {
  if (on) {
    if (!openTips.size) document.addEventListener('keydown', onEscape, true)
    openTips.set(close, el)
  } else if (openTips.delete(close) && !openTips.size) document.removeEventListener('keydown', onEscape, true)
}

defineProps<{ text: string }>()
const open = ref(false)
const el = ref<{ $el: HTMLElement } | null>(null)
const anchor = () => el.value?.$el ?? null

// Reka's Popover supplies the placement (below the "?", flipped above when there is no room, kept
// 8px inside every edge) and the bubble's layer; opening and closing stay ours (hover, focus, tap)
// so several bubbles can be open at once and Escape follows the rule above.
function show() {
  open.value = true
  track(hide, anchor(), true)
}
function hide() {
  open.value = false
  track(hide, null, false)
}
onBeforeUnmount(hide)
</script>

<template>
  <PopoverRoot :open="open">
    <PopoverAnchor ref="el" as="span" class="tip" tabindex="0" role="img" :aria-label="`${t('common.help')}: ${text}`" :class="{ on: open }" @mouseenter="show" @mouseleave="hide" @focus="show" @blur="hide" @click="show">?
      <PopoverContent v-if="open" as-child side="bottom" align="start" :side-offset="8" :align-offset="-8" :collision-padding="8" @open-auto-focus.prevent @close-auto-focus.prevent @focus-outside.prevent><div class="bub" role="tooltip" aria-hidden="true">{{ text }}</div></PopoverContent>
    </PopoverAnchor>
  </PopoverRoot>
</template>

<style scoped>
.tip{position:relative;display:inline-grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:var(--border);color:var(--text-2);font-size:11px;font-weight:700;line-height:1;cursor:help}
.tip.on{background:var(--primary);color:var(--primary-ink)}
.tip:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px}
.bub{z-index:10;width:240px;max-width:calc(100vw - 16px);padding:8px 10px;border-radius:var(--r-card);background:var(--text);color:var(--surface);font-size:12px;font-weight:400;line-height:1.45;text-align:left;white-space:normal;box-shadow:var(--shadow-pop);cursor:default}
</style>
