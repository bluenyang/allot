<script setup lang="ts">
// Confirmation (spec 010 S-5, S-13): a 440px alertdialog on Reka's AlertDialog with a short sentence and
// two buttons. The destructive button is named by its action. Esc and the backdrop cancel (nothing is
// typed here, so nothing is lost); focus starts on the safe button and goes back to the opener on close.
import { AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { onUnmounted, ref } from 'vue'
import { t } from '../i18n'

const props = defineProps<{ title: string; confirmLabel: string; cancelLabel?: string; danger?: boolean; busy?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const cancelBtn = ref<HTMLButtonElement | null>(null)
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

onUnmounted(() => {
  setTimeout(() => { if (opener?.isConnected) opener.focus() }, 0) // after Reka has released its focus trap
})
</script>

<template>
  <AlertDialogRoot :open="true" @update:open="(o: boolean) => !o && emit('cancel')">
    <AlertDialogPortal>
      <AlertDialogOverlay class="dlg-ov" @click="emit('cancel')" />
      <AlertDialogContent class="cdlg dlg" @open-auto-focus.prevent="cancelBtn?.focus()" @close-auto-focus.prevent>
        <div class="cd-b">
          <AlertDialogTitle as="h2">{{ props.title }}</AlertDialogTitle>
          <AlertDialogDescription as="div" class="cd-d"><slot /></AlertDialogDescription>
        </div>
        <div class="cd-f">
          <button ref="cancelBtn" class="btn" type="button" @click="emit('cancel')">{{ props.cancelLabel ?? t('common.cancel') }}</button>
          <button class="btn" :class="props.danger ? 'bad' : 'pri'" type="button" :disabled="props.busy" @click="emit('confirm')">{{ props.confirmLabel }}</button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style>
.cdlg{position:fixed;inset:0;z-index:51;margin:auto;height:fit-content;width:min(440px,calc(100vw - 32px));padding:0;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden}
.cdlg .cd-b{padding:20px 20px 16px}
.cdlg h2{margin:0 0 8px;font-size:16px;font-weight:600}
.cdlg .cd-d{font-size:14px;color:var(--text-2)}
.cdlg .cd-d p{margin:0 0 8px}
.cdlg .cd-f{display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--border);background:var(--surface-2)}
@media (max-width:760px){.cdlg{width:calc(100vw - 16px)}}
</style>
