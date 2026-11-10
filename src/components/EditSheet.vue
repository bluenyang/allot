<script setup lang="ts">
// Editor panel shared by every list: save / cancel / press-twice delete.
// On open it scrolls into view and focuses the first field, so a click on a
// row far down the page visibly opens the editor.
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps<{ title: string; error?: string; canDelete?: boolean; busy?: boolean }>()
const emit = defineEmits<{ save: []; cancel: []; delete: [] }>()

const el = ref<HTMLElement | null>(null)
const armed = ref(false)

onMounted(async () => {
  await nextTick()
  el.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  el.value?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true })
})

function del() {
  if (!armed.value) return (armed.value = true)
  armed.value = false
  emit('delete')
}
</script>

<template>
  <form ref="el" class="panel sheet" novalidate :aria-label="props.title" @submit.prevent="emit('save')" @keydown.esc="emit('cancel')">
    <h3 style="margin-top:0">{{ props.title }}</h3>
    <div class="form"><slot /></div>
    <slot name="after" />
    <p v-if="props.error" class="small" role="alert" style="color:var(--neg);margin:10px 0 0">{{ props.error }}</p>
    <div class="btns">
      <button class="btn pri" type="submit" :disabled="props.busy">저장</button>
      <button class="btn" type="button" @click="emit('cancel')">취소</button>
      <button v-if="props.canDelete" class="btn danger" type="button" @click="del">{{ armed ? '한 번 더 누르면 삭제' : '삭제' }}</button>
    </div>
  </form>
</template>
