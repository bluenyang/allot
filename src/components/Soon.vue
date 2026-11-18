<script setup lang="ts">
// "준비 중" (spec 010 S-3): a planned feature is shown but cannot be used. Content is muted, the
// element stays focusable (`aria-disabled`, not `disabled`), nothing happens on click or Enter/Space
// and nothing navigates, and a small "준비 중" / "Coming soon" badge says why. Wrap the content only;
// the wrapper swallows click, auxclick and Enter/Space in the capture phase, before any descendant
// handler or link navigation, and slotted focusable content gets tabindex -1. Its name includes the badge.
import { computed, onMounted, onUpdated, ref, useAttrs } from 'vue'
import { t } from '../i18n'

defineOptions({ inheritAttrs: false })
// A handler the parent adds would be an action: drop click and key handlers, keep id, class, aria-*, title.
const attrs = useAttrs()
const rest = computed(() => Object.fromEntries(Object.entries(attrs).filter(([k]) => !/^on(Click|Auxclick|Dblclick|Keydown|Keyup|Keypress|Mousedown|Mouseup|Pointerdown|Pointerup|Submit)/.test(k))))

const props = withDefaults(defineProps<{ tag?: string; pill?: boolean; label?: string }>(), { tag: 'button', pill: true })
const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
const root = ref<HTMLElement | null>(null)
// Slotted links and buttons are taken out of the Tab order: the wrapper is the one focus stop.
const sel = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]'
const defocus = () => root.value?.querySelectorAll<HTMLElement>(sel).forEach((el) => { if (el.tabIndex !== -1) el.tabIndex = -1 })
onMounted(defocus)
onUpdated(defocus)
const keys = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') stop(e) }
</script>

<template>
  <component
    :is="props.tag" ref="root" v-bind="rest" class="is-soon" aria-disabled="true"
    :type="props.tag === 'button' ? 'button' : undefined" :role="props.tag === 'button' ? undefined : 'button'" :tabindex="props.tag === 'button' ? undefined : 0"
    @click.capture="stop" @auxclick.capture="stop" @keydown.capture="keys" @keyup.capture="keys"
  ><slot /><span v-if="props.pill" class="soon-pill">{{ props.label ?? t('common.soon') }}</span></component>
</template>
