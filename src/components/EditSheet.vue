<script setup lang="ts">
// Editor shared by every list (spec 007 S-6, restyled by spec 010 S-5): a modal (520px; a card on a
// phone) holding a form named by its title. Optional stepped header (`steps`, `v-model:step`): a
// centred step list in the header, 이전/다음 in the footer, one <form> whose sections the page shows
// per step (slot prop `step`). Save / cancel / delete asks first in a ConfirmDialog ("…을 삭제할까요?", cancel focused; `deleteName` names the item). On Reka's Dialog (S-13): the
// page behind is inert, Tab wraps inside, Esc cancels (an open Select list or help bubble takes the key
// first: Reka closes only the topmost layer); on close the focus goes back to the button that opened it.
// A click outside does not close it (no lost input).
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, nextTick, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { t } from '../i18n'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{
  title: string; error?: string; canDelete?: boolean; busy?: boolean; desc?: string
  /** Modal width in px; 520 by default. */
  width?: 440 | 520 | 560 | 640
  /** A line left of the buttons, e.g. "saved to the history". */
  hint?: string
  /** Step names; with two or more the header shows the step list and the footer moves between steps. */
  steps?: string[]
  /** Current step (0-based), v-model:step. */
  step?: number
  /** Text of the last step's button; 저장 by default. */
  saveLabel?: string
  /** Called before 다음 moves on; return false to stay (the page shows why). */
  canAdvance?: (step: number) => boolean
  /** A dialog with nothing to save (a detail view): no save button; the cancel button reads `cancelLabel` (닫기). */
  hideSave?: boolean
  /** Text of the cancel button; 취소 by default. */
  cancelLabel?: string
  /** The save button is a destructive action (red). */
  danger?: boolean
  /** The item's name for the delete question ("{name}을(를) 삭제할까요?"); without it the question has no name. */
  deleteName?: string
}>()
const emit = defineEmits<{ save: []; cancel: []; delete: []; 'update:step': [n: number] }>()

const dlg = ref<{ $el: HTMLElement } | null>(null)
const asking = ref(false)
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
const stepped = computed(() => (props.steps?.length ?? 0) > 1)
const cur = computed(() => (stepped.value ? Math.min(Math.max(props.step ?? 0, 0), props.steps!.length - 1) : 0))
const last = computed(() => !stepped.value || cur.value === props.steps!.length - 1)

const focusFirst = async () => {
  await nextTick()
  // the first control that is shown (a step's other sections may be display:none)
  const root = dlg.value?.$el
  if (!root) return
  const shown = (list: Iterable<HTMLElement>) => [...list].find((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0)
  // a field first; an editor with none (a confirmation, a detail view) takes its first button or link in the
  // body, then the footer's first button that is not the delete; the box itself when nothing can take it
  const target = shown(root.querySelectorAll<HTMLElement>('.body input, .body button[role="combobox"], .body textarea'))
    ?? shown(root.querySelectorAll<HTMLElement>('.body button, .body a[href], .body [tabindex]:not([tabindex="-1"])'))
    ?? shown(root.querySelectorAll<HTMLElement>('.mf button:not(.danger)'))
  ;(target ?? root).focus()
}
onUnmounted(() => {
  setTimeout(() => { if (opener?.isConnected) opener.focus() }, 0) // after Reka has released its focus trap
})
watch(cur, () => void focusFirst())
// The page was left (KeepAlive) while the editor was open: drop the edit, as Cancel would.
onDeactivated(() => emit('cancel'))

function confirmDelete() {
  asking.value = false
  emit('delete')
}
function submit() {
  if (last.value) return emit('save')
  if (props.canAdvance?.(cur.value) === false) return
  emit('update:step', cur.value + 1)
}
</script>

<template>
  <DialogRoot :open="true" @update:open="(o: boolean) => !o && emit('cancel')">
    <DialogPortal>
     <div class="dlg-layer">
      <DialogOverlay class="dlg-ov" />
      <DialogContent ref="dlg" class="modal dlg" :style="{ '--mw': `${props.width ?? 520}px` }" :aria-label="props.title" :aria-describedby="undefined" @pointer-down-outside.prevent @interact-outside.prevent @open-auto-focus.prevent="focusFirst" @close-auto-focus.prevent>
    <form class="sheet-f" novalidate :aria-label="props.title" @submit.prevent="submit">
      <header class="mh">
        <div class="mh-row">
          <div class="mh-t">
            <DialogTitle as="h2">{{ props.title }}</DialogTitle>
            <p v-if="props.desc" class="small muted">{{ props.desc }}</p>
          </div>
          <slot name="head" />
          <button class="btn icon sm ghost x" type="button" :aria-label="t('common.close')" @click="emit('cancel')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <ol v-if="stepped" class="stp" :aria-label="t('common.steps')">
          <template v-for="(s, i) in props.steps" :key="i">
            <li v-if="i > 0" class="cn" :class="{ pass: i <= cur }" aria-hidden="true"></li>
            <li :class="{ on: i === cur, done: i < cur }" :aria-current="i === cur ? 'step' : undefined">
              <span class="mk" aria-hidden="true">{{ i < cur ? '✓' : i + 1 }}</span><span class="nm">{{ s }}</span>
            </li>
          </template>
        </ol>
      </header>
      <div class="body">
        <div class="form"><slot :step="cur" /></div>
        <slot name="after" :step="cur" />
        <p v-if="props.error" class="err small" role="alert">{{ props.error }}</p>
      </div>
      <footer class="mf">
        <button v-if="props.canDelete" class="btn danger" type="button" @click="asking = true">{{ t('common.delete') }}</button>
        <span v-if="props.hint || stepped" class="ft-hint small muted">{{ stepped ? `${t('common.stepOf', { n: cur + 1, total: props.steps!.length })}${props.hint && last ? ` · ${props.hint}` : ''}` : props.hint }}</span>
        <span class="sp"></span>
        <button class="btn" type="button" @click="emit('cancel')">{{ props.cancelLabel ?? t('common.cancel') }}</button>
        <button v-if="stepped && cur > 0" class="btn" type="button" @click="emit('update:step', cur - 1)">{{ t('common.back') }}</button>
        <button v-if="!last" class="btn pri" type="submit">{{ t('common.next') }}</button>
        <button v-else-if="!props.hideSave" class="btn" :class="props.danger ? 'bad' : 'pri'" type="submit" :disabled="props.busy">{{ props.saveLabel ?? t('common.save') }}</button>
      </footer>
    </form>
      </DialogContent>
     </div>
    </DialogPortal>
  </DialogRoot>
  <ConfirmDialog v-if="asking" :title="props.deleteName?.trim() ? t('common.deleteAsk', { name: props.deleteName.trim() }) : t('common.deleteAskPlain')" :confirm-label="t('common.delete')" danger @confirm="confirmDelete" @cancel="asking = false">
    <p>{{ t('common.deleteAskNote') }}</p>
  </ConfirmDialog>
</template>

<style>
.modal{position:fixed;inset:0;z-index:1;margin:auto;height:fit-content;width:min(var(--mw,520px),calc(100vw - 32px));max-height:calc(100dvh - 48px);padding:0;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden}
.modal .sheet-f{display:flex;flex-direction:column;max-height:calc(100dvh - 50px)}
.modal .mh{display:flex;flex-direction:column;gap:10px;padding:10px 12px 10px 20px;border-bottom:1px solid var(--border)}
.modal .mh-row{display:flex;align-items:flex-start;gap:12px;min-height:44px}
.modal .mh-t{flex:1;min-width:0;align-self:center}
.modal .mh h2{margin:0;font-size:16px;font-weight:600;overflow-wrap:anywhere}
.modal .mh p{margin:2px 0 0}
.modal .x{color:var(--muted);flex:none;width:32px;margin-top:6px}
.modal .x:hover{background:var(--fill)}
.modal .stp{list-style:none;margin:0 8px 2px 0;padding:0;display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px}
.modal .stp li:not(.cn){display:flex;align-items:center;gap:8px;font-weight:600;color:var(--subtle);min-width:0}
.modal .stp li.on{color:var(--text)}
.modal .stp .mk{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;font-size:12px;background:var(--fill);color:var(--subtle)}
.modal .stp li.on .mk{background:var(--primary);color:var(--primary-ink)}
.modal .stp li.done .mk{background:var(--primary-soft);color:var(--primary-text)}
.modal .stp .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.modal .stp .cn{flex:0 1 88px;height:2px;background:var(--border)}
.modal .stp .cn.pass{background:var(--primary-text)}
.modal .body{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
.modal .err{color:var(--neg-text);margin:0}
.modal .mf{display:flex;gap:8px;align-items:center;padding:14px 20px;border-top:1px solid var(--border);background:var(--surface-2)}
.modal .ft-hint{min-width:0}
.modal .sp{flex:1}
@media (max-width:760px){
  .modal{width:calc(100vw - 16px);max-width:calc(100vw - 16px);max-height:calc(100dvh - 24px);margin:12px auto auto}
  .modal .sheet-f{max-height:calc(100dvh - 26px)}
  .modal .mh{padding-left:16px}
  .modal .stp .nm{display:none}
  .modal .stp li.on .nm{display:inline}
  .modal .body{padding:16px}
  .modal .mf{padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));flex-wrap:wrap}
  .modal .ft-hint{order:-1;flex-basis:100%}
}
@media (prefers-reduced-motion:no-preference){.modal[data-state="open"]{animation:pop-in .14s ease-out}}
@keyframes pop-in{from{opacity:0;transform:translateY(6px)}}
</style>
