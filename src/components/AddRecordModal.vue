<script setup lang="ts">
// 기록 추가 (spec 010 S-6, HM-37..41): what to record first, then the fields of that kind. 확인할 것 and
// 일정 are saved through the same API as their own pages; the 일정 시기 stays a text field, because it takes
// a month range (`2027-01~02`) which a month picker cannot. 구독 goes on to the subscriptions page, and
// 일회성 지출 has no data yet (준비 중).
import { computed, ref } from 'vue'
import EditSheet from './EditSheet.vue'
import Soon from './Soon.vue'
import { t } from '../i18n'
import { saveItem } from '../lib/store'
import { DEFAULT_EVENT_KIND, EVENT_KINDS, eventKindLabel } from '../lib/labels'
import { showToast } from '../lib/toast'
import { today, ymOf } from '../lib/calc'
import type { EventKind } from '../data/types'

type Kind = 'todo' | 'event' | 'sub'
const props = defineProps<{ start: Kind }>()
const emit = defineEmits<{ close: [] }>()

const kind = ref<Kind>(props.start)
const text = ref('')
const title = ref('')
const when = ref(ymOf(today()))
const evKind = ref<EventKind>(DEFAULT_EVENT_KIND)
const error = ref('')
const busy = ref(false)

const choices = computed(() => [
  { id: 'todo' as const, label: t('addRecord.todo'), hint: t('addRecord.todoHint') },
  { id: 'event' as const, label: t('addRecord.event'), hint: t('addRecord.eventHint') },
  { id: 'sub' as const, label: t('addRecord.sub'), hint: t('addRecord.subHint') },
])

function pick(k: Kind) { kind.value = k; error.value = '' }

async function save() {
  error.value = ''
  if (kind.value === 'sub') {
    emit('close')
    location.hash = '#subs'
    return
  }
  if (kind.value === 'todo' && !text.value.trim()) return (error.value = t('dashboard.needDetails'))
  if (kind.value === 'event') {
    if (!title.value.trim()) return (error.value = t('timeline.needDetails'))
    if (!/^\d{4}-\d{2}(~\d{2})?$/.test(when.value)) return (error.value = t('timeline.needWhen'))
  }
  busy.value = true
  try {
    if (kind.value === 'todo') await saveItem('checks', { id: '', text: text.value, done: false })
    else await saveItem('events', { id: '', when: when.value, kind: evKind.value, title: title.value, state: 'todo' })
    showToast(t('addRecord.saved'))
    emit('close')
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <EditSheet :title="t('shell.addRecord')" :desc="t('addRecord.lead')" :width="560" :error="error" :busy="busy" :hint="t('addRecord.foot')"
    :save-label="kind === 'sub' ? t('common.next') : undefined" @save="save" @cancel="emit('close')">
    <div class="choices" role="radiogroup" :aria-label="t('addRecord.kindLabel')">
      <button v-for="c in choices" :key="c.id" type="button" role="radio" class="choice" :class="{ on: kind === c.id }" :aria-checked="kind === c.id" @click="pick(c.id)">
        <b>{{ c.label }}</b><span>{{ c.hint }}</span>
      </button>
      <Soon tag="div" class="choice off" :aria-label="`${t('addRecord.oneoff')} (${t('common.soon')})`"><b>{{ t('addRecord.oneoff') }}</b><span>{{ t('addRecord.oneoffHint') }}</span></Soon>
    </div>

    <template v-if="kind === 'todo'">
      <div class="field"><label for="ar-text">{{ t('addRecord.content') }}</label><input id="ar-text" v-model="text" class="in" :placeholder="t('addRecord.contentPh')"></div>
    </template>
    <template v-else-if="kind === 'event'">
      <div class="field"><label for="ar-title">{{ t('addRecord.eventTitle') }}</label><input id="ar-title" v-model="title" class="in" :placeholder="t('addRecord.eventTitlePh')"></div>
      <div class="field"><label for="ar-when">{{ t('addRecord.when') }}</label><input id="ar-when" v-model="when" class="in" placeholder="2027-03"><span class="hint">{{ t('addRecord.whenHint') }}</span></div>
      <div class="field"><label for="ar-kind">{{ t('addRecord.eventKind') }}</label>
        <select id="ar-kind" v-model="evKind" class="in"><option v-for="k in EVENT_KINDS" :key="k" :value="k">{{ eventKindLabel(k) }}</option></select></div>
    </template>
    <template v-else>
      <p class="info">{{ t('addRecord.subNote') }}</p>
    </template>
  </EditSheet>
</template>

<style scoped>
.choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.choice{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);color:var(--text);text-align:left;cursor:pointer;font:inherit}
.choice:hover{border-color:var(--border-strong)}
.choice.on{border:2px solid var(--primary-text);padding:11px;background:var(--primary-tint)}
.choice span{font-size:12px;color:var(--subtle)}
.choice.off{opacity:.7;cursor:default}
.choice.off:hover{border-color:var(--border)}
.info{margin:0;padding:10px 12px;border-radius:var(--r-card);background:var(--primary-tint);border:1px solid var(--primary-line);font-size:13px;color:var(--text-2)}
.field{display:grid;gap:6px}
</style>
