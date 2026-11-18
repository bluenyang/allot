<script setup lang="ts">
// Field help (spec 010 S-7, canvas `.tip`): a small round "?" next to a label. Hover or focus shows the
// text in a bubble; the name read aloud is "도움말: …". Keep it beside the <label>, not inside it, so the
// field's own name stays short. The bubble opens below: a modal's body scrolls, so it cannot open past
// its top edge.
import { t } from '../i18n'

defineProps<{ text: string; /** Open towards the left, for a field at the right edge. */ end?: boolean }>()
</script>

<template>
  <span class="tip" tabindex="0" role="img" :aria-label="`${t('common.help')}: ${text}`">?<span class="bub" :class="{ end }" role="tooltip" aria-hidden="true">{{ text }}</span></span>
</template>

<style scoped>
.tip{position:relative;display:inline-grid;place-items:center;flex:none;width:16px;height:16px;border-radius:50%;background:var(--border);color:var(--text-2);font-size:11px;font-weight:700;line-height:1;cursor:help}
.tip:hover,.tip:focus-visible{background:var(--primary);color:var(--primary-ink)}
.tip:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px}
.bub{display:none;position:absolute;top:calc(100% + 8px);left:-8px;z-index:10;width:240px;max-width:min(240px,70vw);padding:8px 10px;border-radius:var(--r-card);background:var(--text);color:var(--surface);font-size:12px;font-weight:400;line-height:1.45;text-align:left;white-space:normal;box-shadow:var(--shadow-pop)}
.bub.end{left:auto;right:-8px}
.tip:hover .bub,.tip:focus .bub{display:block}
</style>
