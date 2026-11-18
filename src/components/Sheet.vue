<script setup lang="ts">
// Bottom sheet on a native <dialog> (spec 010 S-5; the phone "더보기"). Opens with v-model; closes on
// Esc, the backdrop, the close button or a drag down on the grabber. Focus goes back to the opener.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { t } from '../i18n'

const props = defineProps<{ modelValue: boolean; title: string }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>()
const dlg = ref<HTMLDialogElement | null>(null)
const dy = ref(0)
let opener: HTMLElement | null = null
let startY: number | null = null

const close = () => emit('update:modelValue', false)

watch(() => props.modelValue, async (open) => {
  const d = dlg.value
  if (!d) return
  if (open && !d.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dy.value = 0
    d.showModal()
    await nextTick()
    d.querySelector<HTMLElement>('a[href], button:not(.sh-x), [tabindex="0"]')?.focus()
  } else if (!open && d.open) {
    d.close()
    if (opener?.isConnected) opener.focus()
  }
}, { flush: 'post' })
onBeforeUnmount(() => { if (dlg.value?.open) dlg.value.close() })

const backdrop = (e: MouseEvent) => { if (e.target === dlg.value) close() }
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
  <dialog ref="dlg" class="shd" :aria-label="props.title" :style="dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined" @cancel.prevent="close" @close="props.modelValue && close()" @click="backdrop">
    <div class="sh-grab" aria-hidden="true" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up"><i></i></div>
    <div class="sh-h"><h2>{{ props.title }}</h2><button class="btn icon sm ghost sh-x" type="button" :aria-label="t('common.close')" @click="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button></div>
    <div class="sh-b"><slot /></div>
  </dialog>
</template>

<style scoped>
.shd{position:fixed;inset:auto 0 0 0;margin:0;width:100%;max-width:100%;max-height:85dvh;padding:0 0 env(safe-area-inset-bottom,0px);border:0;border-top:1px solid var(--border-strong);border-radius:var(--r-pop) var(--r-pop) 0 0;background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden;flex-direction:column}
.shd[open]{display:flex}
.shd::backdrop{background:var(--backdrop)}
.sh-grab{display:grid;place-items:center;height:24px;touch-action:none;cursor:grab;flex:none}
.sh-grab i{width:36px;height:4px;border-radius:2px;background:var(--border-strong)}
.sh-h{display:flex;align-items:center;gap:8px;padding:0 12px 6px 20px;flex:none}
.sh-h h2{flex:1;margin:0;font-size:16px;font-weight:600}
.sh-b{overflow-y:auto;padding:0 8px 12px}
.sh-b :deep(a),.sh-b :deep(button.sh-row),.sh-b :deep(.sh-row){display:flex;align-items:center;gap:12px;min-height:56px;padding:0 12px;border:0;border-radius:var(--r-ctl);background:none;color:var(--text);font-size:15px;text-decoration:none;text-align:left;width:100%;cursor:pointer}
.sh-b :deep(.sh-row:hover),.sh-b :deep(a:hover){background:var(--surface-2);color:var(--text)}
@media (prefers-reduced-motion:no-preference){.shd[open]{animation:sh-up .18s ease-out}}
@keyframes sh-up{from{transform:translateY(40%);opacity:.6}}
</style>
