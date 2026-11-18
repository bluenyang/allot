<script setup lang="ts">
// Confirmation (spec 010 S-5): a 440px alertdialog with a short sentence and two buttons. The
// destructive button is named by its action. Esc and the backdrop cancel (nothing is typed here, so
// nothing is lost); focus starts on the safe button and goes back to the opener on close.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../i18n'

const props = defineProps<{ title: string; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const dlg = ref<HTMLDialogElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

onMounted(() => {
  dlg.value?.showModal()
  cancelBtn.value?.focus()
})
onBeforeUnmount(() => {
  dlg.value?.close()
  if (opener?.isConnected) opener.focus()
})
// A click on the dialog box itself (its padding is 0) is a click on the backdrop.
const backdrop = (e: MouseEvent) => { if (e.target === dlg.value) emit('cancel') }
</script>

<template>
  <dialog ref="dlg" class="cdlg" role="alertdialog" aria-labelledby="cdlg-t" aria-describedby="cdlg-d" @cancel.prevent="emit('cancel')" @click="backdrop">
    <div class="cd-b">
      <h2 id="cdlg-t">{{ props.title }}</h2>
      <div id="cdlg-d" class="cd-d"><slot /></div>
    </div>
    <div class="cd-f">
      <button ref="cancelBtn" class="btn" type="button" @click="emit('cancel')">{{ props.cancelLabel ?? t('common.cancel') }}</button>
      <button class="btn" :class="props.danger ? 'bad' : 'pri'" type="button" :disabled="props.busy" @click="emit('confirm')">{{ props.confirmLabel }}</button>
    </div>
  </dialog>
</template>

<style scoped>
.cdlg{width:min(440px,calc(100vw - 32px));padding:0;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden}
.cdlg::backdrop{background:var(--backdrop)}
.cd-b{padding:20px 20px 16px}
h2{margin:0 0 8px;font-size:16px;font-weight:600}
.cd-d{font-size:14px;color:var(--text-2)}
.cd-d :deep(p){margin:0 0 8px}
.cd-f{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);background:var(--surface-2)}
@media (max-width:760px){.cdlg{width:calc(100vw - 16px)}}
</style>
