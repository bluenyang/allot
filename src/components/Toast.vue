<script setup lang="ts">
// A short message at the bottom (spec 010 S-5): tells what happened, never asks. At most one action
// button (e.g. "되돌리기"). An error stays until dismissed (the page decides when to unmount it).
import { t } from '../i18n'

const props = defineProps<{ message: string; actionLabel?: string; error?: boolean; dismissible?: boolean }>()
const emit = defineEmits<{ action: []; dismiss: [] }>()
</script>

<template>
  <div class="toast" :class="{ err: props.error }" :role="props.error ? 'alert' : 'status'">
    <span class="tm">{{ props.message }}</span>
    <button v-if="props.actionLabel" class="ta" type="button" @click="emit('action')">{{ props.actionLabel }}</button>
    <button v-if="props.dismissible || props.error" class="tx" type="button" :aria-label="t('common.dismiss')" @click="emit('dismiss')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  </div>
</template>

<style scoped>
.toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:80;display:flex;align-items:center;gap:12px;max-width:min(520px,calc(100vw - 32px));padding:10px 14px;border-radius:var(--r-pop);background:var(--text);color:var(--surface);font-size:13px;box-shadow:var(--shadow-pop)}
.toast.err{background:var(--neg-text);color:var(--surface)}
.tm{min-width:0;overflow-wrap:anywhere}
.ta{flex:none;border:0;background:none;color:inherit;font:inherit;font-weight:700;text-decoration:underline;cursor:pointer;padding:2px 4px;border-radius:var(--r-tag)}
.tx{flex:none;display:grid;place-items:center;width:24px;height:24px;border:0;background:none;color:inherit;cursor:pointer;border-radius:var(--r-tag)}
.tx svg{width:14px;height:14px}
.toast :focus-visible{outline-color:currentColor}
@media (max-width:760px){.toast{bottom:calc(80px + env(safe-area-inset-bottom,0px))}}
</style>
