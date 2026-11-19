<script setup lang="ts">
// Editor shared by every list (spec 007 S-6, restyled by spec 010 S-5): a modal (520px; a card on a
// phone) holding a form named by its title. Optional stepped header (`steps`, `v-model:step`): a
// centred step list in the header, 이전/다음 in the footer, one <form> whose sections the page shows
// per step (slot prop `step`). Save / cancel / press-twice delete as before. The native modal <dialog>
// makes the page behind inert and Tab wraps inside it (trap below); Esc cancels; on close the focus
// goes back to the button that opened it. A click outside does not close it (no lost input).
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { t } from '../i18n'

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
}>()
const emit = defineEmits<{ save: []; cancel: []; delete: []; 'update:step': [n: number] }>()

const dlg = ref<HTMLDialogElement | null>(null)
const armed = ref(false)
const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
const stepped = computed(() => (props.steps?.length ?? 0) > 1)
const cur = computed(() => (stepped.value ? Math.min(Math.max(props.step ?? 0, 0), props.steps!.length - 1) : 0))
const last = computed(() => !stepped.value || cur.value === props.steps!.length - 1)

const focusFirst = async () => {
  await nextTick()
  // the first control that is shown (a step's other sections may be display:none)
  const all = dlg.value?.querySelectorAll<HTMLElement>('.body input, .body select, .body textarea') ?? []
  ;[...all].find((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0)?.focus()
}
onMounted(() => {
  dlg.value?.showModal()
  void focusFirst()
})
onBeforeUnmount(() => {
  dlg.value?.close()
  if (opener?.isConnected) opener.focus()
})
watch(cur, () => void focusFirst())
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
  const lastEl = items[items.length - 1]!
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus() }
  else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus() }
}

function del() {
  if (!armed.value) return (armed.value = true)
  armed.value = false
  emit('delete')
}
function submit() {
  if (last.value) return emit('save')
  if (props.canAdvance?.(cur.value) === false) return
  emit('update:step', cur.value + 1)
}
</script>

<template>
  <dialog ref="dlg" class="modal" :style="{ '--mw': `${props.width ?? 520}px` }" :aria-label="props.title" @cancel.prevent="emit('cancel')" @keydown="trap">
    <form class="sheet-f" novalidate :aria-label="props.title" @submit.prevent="submit">
      <header class="mh">
        <div class="mh-row">
          <div class="mh-t">
            <h2>{{ props.title }}</h2>
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
        <button v-if="props.canDelete" class="btn danger" type="button" @click="del">{{ armed ? t('common.deleteConfirm') : t('common.delete') }}</button>
        <span v-if="props.hint || stepped" class="ft-hint small muted">{{ stepped ? `${t('common.stepOf', { n: cur + 1, total: props.steps!.length })}${props.hint && last ? ` · ${props.hint}` : ''}` : props.hint }}</span>
        <span class="sp"></span>
        <button class="btn" type="button" @click="emit('cancel')">{{ props.cancelLabel ?? t('common.cancel') }}</button>
        <button v-if="stepped && cur > 0" class="btn" type="button" @click="emit('update:step', cur - 1)">{{ t('common.back') }}</button>
        <button v-if="!last" class="btn pri" type="submit">{{ t('common.next') }}</button>
        <button v-else-if="!props.hideSave" class="btn" :class="props.danger ? 'bad' : 'pri'" type="submit" :disabled="props.busy">{{ props.saveLabel ?? t('common.save') }}</button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.modal{width:min(var(--mw,520px),calc(100vw - 32px));max-height:calc(100dvh - 48px);padding:0;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden}
.modal::backdrop{background:var(--backdrop)}
.sheet-f{display:flex;flex-direction:column;max-height:calc(100dvh - 50px)}
.mh{display:flex;flex-direction:column;gap:10px;padding:10px 12px 10px 20px;border-bottom:1px solid var(--border)}
.mh-row{display:flex;align-items:flex-start;gap:12px;min-height:44px}
.mh-t{flex:1;min-width:0;align-self:center}
.mh h2{margin:0;font-size:16px;font-weight:600;overflow-wrap:anywhere}
.mh p{margin:2px 0 0}
.x{color:var(--muted);flex:none;width:32px;margin-top:6px}
.x:hover{background:var(--fill)}
.stp{list-style:none;margin:0 8px 2px 0;padding:0;display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px}
.stp li:not(.cn){display:flex;align-items:center;gap:8px;font-weight:600;color:var(--subtle);min-width:0}
.stp li.on{color:var(--text)}
.stp .mk{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;font-size:12px;background:var(--fill);color:var(--subtle)}
.stp li.on .mk{background:var(--primary);color:var(--primary-ink)}
.stp li.done .mk{background:var(--primary-soft);color:var(--primary-text)}
.stp .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stp .cn{flex:0 1 88px;height:2px;background:var(--border)}
.stp .cn.pass{background:var(--primary-text)}
.body{padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:16px}
.err{color:var(--neg-text);margin:0}
.mf{display:flex;gap:8px;align-items:center;padding:14px 20px;border-top:1px solid var(--border);background:var(--surface-2)}
.ft-hint{min-width:0}
.sp{flex:1}
@media (max-width:760px){
  .modal{width:calc(100vw - 16px);max-width:calc(100vw - 16px);max-height:calc(100dvh - 24px);margin:12px auto auto}
  .sheet-f{max-height:calc(100dvh - 26px)}
  .mh{padding-left:16px}
  .stp .nm{display:none}
  .stp li.on .nm{display:inline}
  .body{padding:16px}
  .mf{padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));flex-wrap:wrap}
  .ft-hint{order:-1;flex-basis:100%}
}
@media (prefers-reduced-motion:no-preference){.modal[open]{animation:pop-in .14s ease-out}}
@keyframes pop-in{from{opacity:0;transform:translateY(6px)}}
</style>
