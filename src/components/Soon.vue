<script setup lang="ts">
// "준비 중" (spec 010 S-3): a planned feature is shown but cannot be used. Content is muted, the
// element stays focusable (`aria-disabled`, not `disabled`), nothing happens on click or Enter/Space
// and nothing navigates, and a small "준비 중" / "Coming soon" badge says why. Wrap the content only;
// the wrapper swallows click, auxclick and Enter/Space in the capture phase, before any descendant
// handler or link navigation, and the slotted content sits in an `inert` container, so nothing in it can take focus or be clicked, even
// if it changes after mount. The wrapper is the one focus stop and its name includes the badge.
import { computed, onMounted, onUpdated, ref, useAttrs } from 'vue'
import { t } from '../i18n'

defineOptions({ inheritAttrs: false })
// A handler the parent adds would be an action: drop click and key handlers, keep id, class, aria-*, title.
const attrs = useAttrs()
const rest = computed(() => Object.fromEntries(Object.entries(attrs).filter(([k]) => !/^on(Click|Auxclick|Dblclick|Keydown|Keyup|Keypress|Mousedown|Mouseup|Pointerdown|Pointerup|Submit)/.test(k))))

const props = withDefaults(defineProps<{ tag?: string; pill?: boolean; label?: string }>(), { tag: 'button', pill: true })
const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
const root = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)
// The slotted content is inert (no focus, no clicks, however it changes later), so the accessible name is
// taken from its text, with the badge text, unless the caller gives an aria-label.
const name = ref('')
const label = () => { name.value = `${inner.value?.textContent?.trim() ?? ''} (${props.label ?? t('common.soon')})`.trim() }
onMounted(label)
onUpdated(label)
const keys = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') stop(e) }
</script>

<template>
  <component
    :is="props.tag" ref="root" v-bind="rest" :aria-label="(rest['aria-label'] as string | undefined) ?? name" class="is-soon" aria-disabled="true"
    :type="props.tag === 'button' ? 'button' : undefined" :role="props.tag === 'button' ? undefined : 'button'" :tabindex="props.tag === 'button' ? undefined : 0"
    @click.capture="stop" @auxclick.capture="stop" @keydown.capture="keys" @keyup.capture="keys"
  ><span ref="inner" class="soon-in" inert><slot /></span><span v-if="props.pill" class="soon-pill">{{ props.label ?? t('common.soon') }}</span></component>
</template>
