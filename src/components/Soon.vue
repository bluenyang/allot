<script setup lang="ts">
// "준비 중" (spec 010 S-3): a planned feature is shown but cannot be used. Content is muted, the
// element stays focusable (`aria-disabled`, not `disabled`), nothing happens on click or Enter/Space
// and nothing navigates, and a small "준비 중" / "Coming soon" badge says why. Wrap the content only;
// do not put a link or button handler on the content (the wrapper swallows them).
import { computed, useAttrs } from 'vue'
import { t } from '../i18n'

defineOptions({ inheritAttrs: false })
// A handler the parent adds would be an action: drop click and key handlers, keep id, class, aria-*, title.
const attrs = useAttrs()
const rest = computed(() => Object.fromEntries(Object.entries(attrs).filter(([k]) => !/^on(Click|Auxclick|Dblclick|Keydown|Keyup|Keypress|Mousedown|Mouseup|Pointerdown|Pointerup|Submit)/.test(k))))

const props = withDefaults(defineProps<{ tag?: string; pill?: boolean; label?: string }>(), { tag: 'button', pill: true })
const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
const keys = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') stop(e) }
</script>

<template>
  <component
    :is="props.tag" v-bind="rest" class="is-soon" aria-disabled="true"
    :type="props.tag === 'button' ? 'button' : undefined" :role="props.tag === 'button' ? undefined : 'button'" :tabindex="props.tag === 'button' ? undefined : 0"
    @click="stop" @auxclick="stop" @keydown="keys"
  ><slot /><span v-if="props.pill" class="soon-pill">{{ props.label ?? t('common.soon') }}</span></component>
</template>
