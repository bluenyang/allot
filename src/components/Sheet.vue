<script setup lang="ts">
// Bottom sheet on Reka's Dialog (spec 010 S-5, S-13; the phone "더보기"). Opens with v-model (also when
// mounted with it already true); closes on Esc, the backdrop, the close button or a drag down on the
// grabber. Focus goes back to the opener.
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { nextTick, ref } from 'vue'
import { t } from '../i18n'

const props = defineProps<{ modelValue: boolean; title: string }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>()
const dy = ref(0)
const box = ref<{ $el: HTMLElement } | null>(null)
let opener: HTMLElement | null = null
let startY: number | null = null

const close = () => emit('update:modelValue', false)

// Reka calls this before it moves the focus: the active element is still the one that opened the sheet.
async function opened() {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dy.value = 0
  await nextTick()
  box.value?.$el.querySelector<HTMLElement>('a[href], button:not(.sh-x), [tabindex="0"]')?.focus()
}
function closed() {
  if (opener?.isConnected) opener.focus()
}

function down(e: PointerEvent) { startY = e.clientY; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }
function move(e: PointerEvent) { if (startY !== null) dy.value = Math.max(0, e.clientY - startY) }
function up() {
  if (startY === null) return
  startY = null
  if (dy.value > 80) close()
  dy.value = 0
}
</script>

<template>
  <DialogRoot :open="props.modelValue" @update:open="(o: boolean) => !o && close()">
    <DialogPortal>
     <div v-if="props.modelValue" class="dlg-layer">
      <DialogOverlay class="dlg-ov" />
      <DialogContent ref="box" class="shd dlg" :aria-label="props.title" :aria-describedby="undefined" :style="dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined" @open-auto-focus.prevent="opened" @close-auto-focus.prevent="closed">
        <div class="sh-grab" aria-hidden="true" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"><i></i></div>
        <div class="sh-h"><DialogTitle as="h2">{{ props.title }}</DialogTitle><button class="btn icon sm ghost sh-x" type="button" :aria-label="t('common.close')" @click="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button></div>
        <div class="sh-b"><slot /></div>
      </DialogContent>
     </div>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.shd{position:fixed;inset:auto 0 0 0;z-index:1;margin:0;width:100%;max-width:100%;max-height:85dvh;display:flex;flex-direction:column;padding:0 0 env(safe-area-inset-bottom,0px);border:0;border-top:1px solid var(--border-strong);border-radius:var(--r-pop) var(--r-pop) 0 0;background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden}
.shd .sh-grab{display:grid;place-items:center;height:24px;touch-action:none;cursor:grab;flex:none}
.shd .sh-grab i{width:36px;height:4px;border-radius:2px;background:var(--border-strong)}
.shd .sh-h{display:flex;align-items:center;gap:8px;padding:0 12px 6px 20px;flex:none}
.shd .sh-h h2{flex:1;margin:0;font-size:16px;font-weight:600}
.shd .sh-b{overflow-y:auto;padding:0 8px 12px}
.shd .sh-b a,.shd .sh-b button.sh-row,.shd .sh-b .sh-row{display:flex;align-items:center;gap:12px;min-height:56px;padding:0 12px;border:0;border-radius:var(--r-ctl);background:none;color:var(--text);font-size:15px;text-decoration:none;text-align:left;width:100%;cursor:pointer}
.shd .sh-b .sh-row:hover,.shd .sh-b a:hover{background:var(--surface-2);color:var(--text)}
@media (prefers-reduced-motion:no-preference){.shd[data-state="open"]{animation:sh-up .18s ease-out}}
@keyframes sh-up{from{transform:translateY(40%);opacity:.6}}
</style>
