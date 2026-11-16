<script setup lang="ts">
// Editor shared by every list (spec 007 S-6): a 640px modal (full screen on a phone) holding a
// form named by its title. Save / cancel / press-twice delete as before. The native modal
// <dialog> makes the page behind inert and Tab wraps inside it (trap below); Esc cancels; on close the focus
// goes back to the button that opened it. A click outside does not close it (no lost input).
import { nextTick, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { t } from '../i18n'

const props = defineProps<{ title: string; error?: string; canDelete?: boolean; busy?: boolean; desc?: string }>()
const emit = defineEmits<{ save: []; cancel: []; delete: [] }>()

const dlg = ref<HTMLDialogElement | null>(null)
const armed = ref(false)
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

onMounted(async () => {
  dlg.value?.showModal()
  await nextTick()
  dlg.value?.querySelector<HTMLElement>('.body input, .body select, .body textarea')?.focus()
})
onBeforeUnmount(() => {
  dlg.value?.close()
  if (opener?.isConnected) opener.focus()
})
// The page was left (KeepAlive) while the editor was open: drop the edit, as Cancel would.
onDeactivated(() => emit('cancel'))

// The native modal makes the page inert, but Tab from the last control would leave for the browser's
// own UI: wrap it to the first control (and Shift+Tab from the first to the last).
function trap(e: KeyboardEvent) {
  if (e.key !== 'Tab' || !dlg.value) return
  const items = [...dlg.value.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
  if (!items.length) return
  const first = items[0]!
  const last = items[items.length - 1]!
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

function del() {
  if (!armed.value) return (armed.value = true)
  armed.value = false
  emit('delete')
}
</script>

<template>
  <dialog ref="dlg" class="modal" :aria-label="props.title" @cancel.prevent="emit('cancel')" @keydown="trap">
    <form class="sheet-f" novalidate :aria-label="props.title" @submit.prevent="emit('save')">
      <header class="mh">
        <div>
          <h2>{{ props.title }}</h2>
          <p v-if="props.desc" class="small muted">{{ props.desc }}</p>
        </div>
        <button class="btn icon x" type="button" :aria-label="t('common.close')" @click="emit('cancel')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>
      <div class="body">
        <div class="form"><slot /></div>
        <slot name="after" />
        <p v-if="props.error" class="err small" role="alert">{{ props.error }}</p>
      </div>
      <footer class="mf">
        <button v-if="props.canDelete" class="btn danger" type="button" @click="del">{{ armed ? t('common.deleteConfirm') : t('common.delete') }}</button>
        <span class="sp"></span>
        <button class="btn" type="button" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button class="btn pri" type="submit" :disabled="props.busy">{{ t('common.save') }}</button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.modal{width:min(640px,calc(100vw - 32px));max-height:calc(100dvh - 48px);padding:0;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);color:var(--text);box-shadow:0 12px 40px rgba(10,20,15,.18)}
.modal::backdrop{background:rgba(15,20,18,.45)}
.sheet-f{display:flex;flex-direction:column;max-height:calc(100dvh - 50px)}
.mh{display:flex;align-items:flex-start;gap:12px;padding:18px 24px 14px;border-bottom:1px solid var(--border)}
.mh > div{flex:1;min-width:0}
.mh h2{margin:0;font-size:17px;font-weight:700;overflow-wrap:anywhere}
.mh p{margin:4px 0 0}
.x{color:var(--muted);border-color:transparent;flex:none}
.body{padding:18px 24px;overflow-y:auto}
.err{color:var(--neg-text);margin:12px 0 0}
.mf{display:flex;gap:8px;align-items:center;padding:14px 24px;border-top:1px solid var(--border);background:var(--surface-2);border-radius:0 0 var(--r-card) var(--r-card)}
.sp{flex:1}
@media (max-width:759px){
  .modal{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;margin:0;border:0;border-radius:0}
  .sheet-f{height:100%;max-height:100dvh}
  .body{flex:1;padding:16px}
  .mh,.mf{padding-left:16px;padding-right:16px}
  .mf{padding-bottom:calc(14px + env(safe-area-inset-bottom,0px));border-radius:0}
}
</style>
