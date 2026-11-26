<script setup lang="ts">
// 기준 일정 추가·수정 (spec 013 S-22, A-36): a monthly date of the user's own — name, day (1–31), account (optional),
// money in or out, note (optional). No amount: it is not part of the distribution or transfer. EditSheet + useEditor;
// the API decides what is valid and its message is shown. The page shows the date after the weekend/holiday shift.
import { computed, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import Seg from './Seg.vue'
import Select from './Select.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import type { ScheduleItem } from '../data/types'

const props = defineProps<{ initial: ScheduleItem | null }>()
const emit = defineEmits<{ close: [] }>()

const blank = (): ScheduleItem => ({ id: '', name: '', day: 1, accountId: null, direction: 'out', note: '', shift: 'none' })
const { item: edit, error, busy, open, close, save, remove } = useEditor('schedules', blank, (x) => (!x.name.trim() ? t('schedule.needName') : null))
open(props.initial ?? undefined)
watch(edit, (v) => { if (!v) emit('close') })
const title = props.initial ? t('schedule.editTitle') : t('schedule.addTitle')

// '' in a select is "none" (null).
const account = computed({
  get: () => edit.value?.accountId ?? '',
  set: (v: string) => { edit.value!.accountId = v || null },
})
const accountOpts = computed(() => [{ value: '', label: t('schedule.accountNone') }, ...store.accounts.map((a) => ({ value: a.id, label: a.name }))])
const dayOpts = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('schedule.dayOf', { n: i + 1 }) }))
const DIRS = computed(() => [{ id: 'in', label: t('schedule.dirIn') }, { id: 'out', label: t('schedule.dirOut') }])
const note = computed({
  get: () => edit.value?.note ?? '',
  set: (v: string) => { edit.value!.note = v },
})
</script>

<template>
  <EditSheet
    v-if="edit" :title="title" :desc="t('schedule.desc')" :error="error" :busy="busy" :hint="t('schedule.foot')"
    :can-delete="!!edit.id" :delete-name="edit.name" @save="save" @cancel="close" @delete="remove"
  >
    <div class="field">
      <label for="si-name">{{ t('schedule.name') }} <span class="star" aria-hidden="true">*</span></label>
      <input id="si-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('schedule.namePh')">
    </div>
    <div class="field">
      <label for="si-day">{{ t('schedule.day') }}</label>
      <Select id="si-day" v-model="edit.day" :options="dayOpts" />
      <span class="hint">{{ t('schedule.dayHint') }}</span>
    </div>
    <div class="field">
      <span id="si-dir" class="lbl">{{ t('schedule.direction') }}</span>
      <Seg :options="DIRS" :model-value="edit.direction" labelledby="si-dir" @update:model-value="edit.direction = $event" />
    </div>
    <div class="field">
      <label for="si-acc">{{ t('schedule.account') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <Select id="si-acc" v-model="account" :options="accountOpts" />
    </div>
    <div class="field">
      <label for="si-note">{{ t('schedule.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <input id="si-note" v-model="note" class="in" autocomplete="off">
    </div>
  </EditSheet>
</template>

<style scoped>
.opt{font-weight:400;color:var(--subtle)}
.lbl{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px}
.hint{font-size:12px;color:var(--subtle);margin:0}
</style>
