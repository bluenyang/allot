<script setup lang="ts">
// 카드 추가·수정 (spec 013 S-13): name, last 4 digits, the paying account (its bill leaves that account) and
// the billing day (empty = the settings' billing day), note. EditSheet + useEditor; the API decides what
// is valid (last 4 digits, day 1–31) and its message is shown. Delete is refused while a buffer use goes
// through the card; otherwise the spendings that named it lose the card (their rounds stay as saved).
import { computed, watch } from 'vue'
import { t } from '../i18n'
import EditSheet from './EditSheet.vue'
import Select from './Select.vue'
import { useEditor } from '../lib/useEditor'
import { store } from '../lib/store'
import type { Card } from '../data/types'

const props = defineProps<{ initial: Card | null }>()
const emit = defineEmits<{ close: [] }>()

const blank = (): Card => ({ id: '', name: '', last4: '', accountId: null, billingDay: null, note: '' })
const { item: edit, error, busy, open, close, save, remove } = useEditor('cards', blank, (c) => (!c.name.trim() ? t('accounts.cardEditor.needName') : null))
open(props.initial ?? undefined)
watch(edit, (v) => { if (!v) emit('close') })
const title = props.initial ? t('accounts.cardEditor.editTitle') : t('accounts.cardEditor.addTitle')

// '' in a select is "none" (null).
const account = computed({
  get: () => edit.value?.accountId ?? '',
  set: (v: string) => { edit.value!.accountId = v || null },
})
const accountOpts = computed(() => [{ value: '', label: t('accounts.cardEditor.accountNone') }, ...store.accounts.map((a) => ({ value: a.id, label: a.name }))])
const day = computed({
  get: () => edit.value?.billingDay ?? '',
  set: (v: number | '') => { edit.value!.billingDay = v === '' ? null : v },
})
const dayOpts = computed(() => [
  { value: '', label: t('accounts.cardEditor.dayDefault', { n: store.settings.billingDay }) },
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: t('accounts.cards.dayOf', { n: i + 1 }) })),
])
</script>

<template>
  <EditSheet
    v-if="edit" :title="title" :desc="t('accounts.cardEditor.desc')" :error="error" :busy="busy"
    :can-delete="!!edit.id" :delete-name="edit.name" @save="save" @cancel="close" @delete="remove"
  >
    <div class="field">
      <label for="cd-name">{{ t('accounts.cardEditor.name') }} <span class="star" aria-hidden="true">*</span></label>
      <input id="cd-name" v-model="edit.name" class="in" autocomplete="off" :placeholder="t('accounts.cardEditor.namePh')">
    </div>
    <div class="field">
      <label for="cd-last4">{{ t('accounts.cardEditor.last4') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <input id="cd-last4" v-model="edit.last4" class="in" inputmode="numeric" autocomplete="off" :placeholder="t('accounts.editor.last4Ph')">
    </div>
    <div class="field">
      <label for="cd-acc">{{ t('accounts.cardEditor.account') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <Select id="cd-acc" v-model="account" :options="accountOpts" />
      <span class="hint">{{ t('accounts.cardEditor.accountHint') }}</span>
    </div>
    <div class="field">
      <label for="cd-day">{{ t('accounts.cardEditor.day') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <Select id="cd-day" v-model="day" :options="dayOpts" />
      <span class="hint">{{ t('accounts.cardEditor.dayHint') }}</span>
    </div>
    <div class="field">
      <label for="cd-note">{{ t('accounts.cardEditor.note') }} <span class="opt">{{ t('common.optional') }}</span></label>
      <input id="cd-note" v-model="edit.note" class="in" autocomplete="off">
    </div>
  </EditSheet>
</template>

<style scoped>
.opt{font-weight:400;color:var(--subtle)}
.hint{font-size:12px;color:var(--subtle);margin:0}
</style>
