<script setup lang="ts">
// A short message at the bottom (spec 010 S-5): tells what happened, never asks. At most one action
// button (e.g. "되돌리기"). An error stays until dismissed (the page decides when to unmount it).
import { t } from '../i18n'

const props = defineProps<{ message: string; actionLabel?: string; error?: boolean; dismissible?: boolean }>()
const emit = defineEmits<{ action: []; dismiss: [] }>()
</script>

<template>
  <div class="toast" :class="{ err: props.error }" :role="props.error ? 'alert' : 'status'" :aria-live="props.error ? 'assertive' : 'polite'">
    <span class="tm">{{ props.message }}</span>
    <button v-if="props.actionLabel" class="ta" type="button" @click="emit('action')">{{ props.actionLabel }}</button>
    <button v-if="props.dismissible || props.error" class="tx" type="button" :aria-label="t('common.dismiss')" @click="emit('dismiss')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  </div>
</template>

<style scoped>
/* as drawn (canvas toast): a surface card with a strong border, 32px from the bottom */
.toast{position:fixed;left:50%;bottom:calc(32px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:80;display:flex;align-items:center;gap:14px;max-width:min(520px,calc(100vw - 32px));padding:10px 10px 10px 16px;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);font-size:13px;box-shadow:var(--shadow-pop)}
.toast.err{color:var(--neg-text);border-color:var(--neg-line)}
.tm{min-width:0;overflow-wrap:anywhere}
.ta{flex:none;border:0;background:none;color:var(--primary-text);font:inherit;font-weight:600;cursor:pointer;padding:4px 8px;border-radius:var(--r-ctl)}
.ta:hover{background:var(--fill)}
.tx{flex:none;display:grid;place-items:center;width:24px;height:24px;border:0;background:none;color:inherit;cursor:pointer;border-radius:var(--r-tag)}
.tx svg{width:14px;height:14px}
@media (max-width:760px){.toast{bottom:calc(88px + env(safe-area-inset-bottom,0px))}}
</style>
