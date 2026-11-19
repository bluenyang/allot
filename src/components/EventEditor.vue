<script setup lang="ts">
// 이벤트 추가·수정 (spec 010 S-9, EV-31, D-7): one field per row — 내용, 시기, 분류 chips, 상태. The 시기 takes
// what it took before: one month or a range inside a year (`2027-01~02`; the end may be before the start); a stored
// value that fits neither shows as text and saves as it is. 직접 입력 and a range into another year are 준비 중 (S-10).
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import Seg from './Seg.vue'
import Soon from './Soon.vue'
import { useEditor } from '../lib/useEditor'
import { DEFAULT_EVENT_KIND, EVENT_KINDS, eventKindLabel } from '../lib/labels'
import { WHEN_RE, composeWhen, whenParts, type WhenMode } from '../lib/event-when'
import { today, ymOf } from '../lib/calc'
import type { EventState, PlanEvent } from '../data/types'

const props = defineProps<{ initial: PlanEvent | null }>()
const emit = defineEmits<{ close: [] }>()

const now = ymOf(today())
const blank = (): PlanEvent => ({ id: '', when: now, kind: DEFAULT_EVENT_KIND, title: '', state: 'todo' })
const parts = ref(whenParts(props.initial?.when ?? now))
const crossYear = computed(() => composeWhen(parts.value).crossYear)

function validate(e: PlanEvent) {
  if (!e.title.trim()) return t('timeline.needDetails')
  const c = composeWhen(parts.value)
  if (c.crossYear) return t('timeline.crossYearSoon')
  if (!WHEN_RE.test(c.when)) return t('timeline.needWhen')
  e.when = c.when
  return null
}
const { item: edit, error, busy, open, close, save, remove } = useEditor('events', blank, validate)
open(props.initial ?? undefined)
watch(edit, (v) => { if (!v) emit('close') })
const title = props.initial ? t('timeline.editEvent') : t('timeline.addEvent')

const modeOpts = computed(() => [{ id: 'one', label: t('timeline.whenOne') }, { id: 'range', label: t('timeline.whenRange') }])
function setMode(m: WhenMode) {
  const p = parts.value
  if (m === 'range' && p.mode !== 'range') parts.value = { ...p, mode: 'range', from: p.one || now, to: p.one || now }
  else if (m === 'one' && p.mode !== 'one') parts.value = { ...p, mode: 'one', one: /^\d{4}-\d{2}$/.test(p.from) ? p.from : now }
  else parts.value = { ...p, mode: m }
}
/** A stored kind that is none of the ten stays selectable as one more chip. */
const kinds = computed(() => (edit.value && !EVENT_KINDS.includes(edit.value.kind) ? [...EVENT_KINDS, edit.value.kind] : EVENT_KINDS))
const STATES: EventState[] = ['todo', 'doing', 'done']
const stateOpts = computed(() => STATES.map((id) => ({ id, label: t(`timeline.state.${id}`) })))
const endLimits = computed(() => (/^\d{4}-/.test(parts.value.from) ? { min: `${parts.value.from.slice(0, 4)}-01`, max: `${parts.value.from.slice(0, 4)}-12` } : {}))
</script>

<template>
  <EditSheet
    v-if="edit" :title="title" :desc="t('timeline.eventDesc')" :error="error" :busy="busy" :hint="t('timeline.saveHint')"
    :can-delete="!!edit.id" @save="save" @cancel="close" @delete="remove"
  >
    <div class="field">
      <label for="ev-title" class="req">{{ t('timeline.details') }}</label>
      <input id="ev-title" v-model="edit.title" class="in" autocomplete="off" :placeholder="t('timeline.detailsPh')">
    </div>

    <div class="field">
      <span id="ev-when-l" class="flabel">{{ t('timeline.when') }}</span>
      <div class="seg" role="group" aria-labelledby="ev-when-l">
        <button v-for="o in modeOpts" :key="o.id" type="button" :aria-pressed="parts.mode === o.id ? 'true' : 'false'" @click="setMode(o.id as WhenMode)">{{ o.label }}</button>
        <Soon class="segsoon">{{ t('timeline.whenFree') }}</Soon>
      </div>
      <input v-if="parts.mode === 'one'" v-model="parts.one" class="in" type="month" :placeholder="now" :aria-label="t('timeline.month')">
      <template v-else-if="parts.mode === 'range'">
        <div class="rng">
          <input v-model="parts.from" class="in" type="month" :placeholder="now" :aria-label="t('timeline.fromMonth')">
          <span aria-hidden="true" class="muted">~</span>
          <input v-model="parts.to" class="in" type="month" :placeholder="now" v-bind="endLimits" :aria-label="t('timeline.toMonth')">
        </div>
        <Soon tag="span" class="hint">{{ crossYear ? t('timeline.crossYearSoon') : t('timeline.crossYear') }}</Soon>
      </template>
      <template v-else>
        <input v-model="parts.raw" class="in" :placeholder="'2027-03'" :aria-label="t('timeline.whenRaw')">
        <span class="hint">{{ t('timeline.needWhen') }}</span>
      </template>
    </div>

    <div class="field">
      <span id="ev-k-l" class="flabel">{{ t('timeline.category') }}</span>
      <div class="chips" role="radiogroup" aria-labelledby="ev-k-l">
        <button v-for="k in kinds" :key="k" type="button" role="radio" class="chip" :class="{ on: edit.kind === k }" :aria-checked="edit.kind === k ? 'true' : 'false'" @click="edit.kind = k">{{ eventKindLabel(k) }}</button>
      </div>
    </div>

    <div class="field">
      <span id="ev-st-l" class="flabel">{{ t('timeline.status') }}</span>
      <Seg v-model="edit.state" :options="stateOpts" labelledby="ev-st-l" />
    </div>
  </EditSheet>
</template>

<style scoped>
.req::after{content:" *";color:var(--accent-text)}
.flabel{font-size:12px;color:var(--text-2);font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.rng{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:8px;align-items:center}
.seg{justify-self:start}
.segsoon{height:30px;padding:0 12px;font-size:13px;font-weight:600}
</style>
