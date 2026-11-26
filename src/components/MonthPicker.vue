<script setup lang="ts">
import { t } from '../i18n'
import Icon from './Icon.vue'
import MonthPeriod from './MonthPeriod.vue'
import { addYm, ymLabel } from '../lib/calc'
const props = defineProps<{ modelValue: string; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [ym: string] }>()
const step = (n: number) => emit('update:modelValue', addYm(props.modelValue, n))
</script>

<template>
  <div class="ymbar">
    <span v-if="label" class="lab">{{ label }}</span>
    <button class="btn icon" type="button" :aria-label="t('shell.prevMonth')" @click="step(-1)"><Icon name="prev" style="width:16px;height:16px" /></button>
    <span class="cur">{{ ymLabel(modelValue) }}<MonthPeriod :ym="modelValue" /></span>
    <button class="btn icon" type="button" :aria-label="t('shell.nextMonth')" @click="step(1)"><Icon name="next" style="width:16px;height:16px" /></button>
  </div>
</template>
