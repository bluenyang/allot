<script setup lang="ts">
// The question asked before a save that changes what a month is (spec 018 S-4): the month names stay, the dates they
// stand for change — this month before and after. Asked for the three picks of 설정 › 달의 기준 and for the other saves
// that move a month's dates: the pay day or its rule under a pay basis, the basis card's first day of use, deleting the
// basis card (review 2 F-2; `monthChange` in src/lib/month.ts says whether to ask). Cancel saves nothing.
import { t } from '../i18n'
import ConfirmDialog from './ConfirmDialog.vue'

defineProps<{ before: string; after: string; busy?: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <ConfirmDialog :title="t('settings.general.monthAskTitle')" :confirm-label="t('settings.general.monthAskOk')" :busy="busy" @confirm="emit('confirm')" @cancel="emit('cancel')">
    <p>{{ t('settings.general.monthAskBody') }}</p>
    <dl class="mask">
      <div><dt>{{ t('settings.general.monthAskBefore') }}</dt><dd class="num" data-testid="month-before">{{ before }}</dd></div>
      <div><dt>{{ t('settings.general.monthAskAfter') }}</dt><dd class="num" data-testid="month-after">{{ after }}</dd></div>
    </dl>
    <p class="hint">{{ t('settings.general.monthAskKept') }}</p>
  </ConfirmDialog>
</template>
