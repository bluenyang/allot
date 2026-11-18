<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '../i18n'
import Icon from './Icon.vue'

// Page tabs (spec 007 S-1): icon + label, the selected one gets the soft face and a 2px underline.
// Only for switching views inside a page. When the tabs do not fit, a round arrow at each edge that
// still has tabs behind it scrolls them (spec 010 S-5, SH-28).
const props = defineProps<{ tabs: { id: string; label: string; icon?: string; count?: number; signal?: boolean }[]; modelValue: string }>()
defineEmits<{ 'update:modelValue': [id: string] }>()

const list = ref<HTMLElement | null>(null)
const more = ref({ prev: false, next: false })
let ro: ResizeObserver | undefined

function measure() {
  const el = list.value
  if (!el) return
  more.value = { prev: el.scrollLeft > 1, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 }
}
const go = (dir: -1 | 1) => list.value?.scrollBy({ left: dir * Math.max(120, list.value.clientWidth * 0.6), behavior: 'smooth' })

// The list box and every tab button are watched: a label or count that changes width moves the overflow.
function observe() {
  if (typeof ResizeObserver === 'undefined' || !list.value) return
  ro ??= new ResizeObserver(measure)
  ro.disconnect()
  ro.observe(list.value)
  list.value.querySelectorAll('[role="tab"]').forEach((b) => ro!.observe(b))
}
onMounted(() => {
  measure()
  observe()
  void document.fonts?.ready.then(measure) // web fonts change the widths after first paint
})
watch(() => props.tabs.map((x) => `${x.id}\u0000${x.label}\u0000${x.count ?? ''}`).join('\u0001'), async () => { await nextTick(); observe(); measure() })
onBeforeUnmount(() => ro?.disconnect())
// The selected tab stays in view.
watch(() => props.modelValue, async () => { await nextTick(); list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
</script>

<template>
  <div class="subtabs-w">
    <button v-if="more.prev" class="tabarrow prev" type="button" tabindex="-1" :aria-label="t('common.tabsPrev')" @click="go(-1)"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg></i></button>
    <div ref="list" class="subtabs" role="tablist" @scroll.passive="measure">
      <button
        v-for="tab in tabs" :key="tab.id" type="button" role="tab"
        :aria-selected="tab.id === modelValue ? 'true' : 'false'"
        @click="$emit('update:modelValue', tab.id)"
      ><Icon v-if="tab.icon" :name="tab.icon" />{{ tab.label }}<span v-if="tab.count !== undefined" class="cnt" :class="{ acc: tab.signal && tab.count > 0 }">{{ tab.count }}</span></button>
    </div>
    <button v-if="more.next" class="tabarrow next" type="button" tabindex="-1" :aria-label="t('common.tabsNext')" @click="go(1)"><i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></i></button>
  </div>
</template>
