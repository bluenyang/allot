<script setup lang="ts">
// The phone's "더보기" (spec 010 S-4): a bottom sheet with the account, the budget pages the bottom
// bar has no room for (living opens since spec 013 S-1), the pages that are not in the bar, and sign out. Items for features that do
// not exist yet are `Soon` (visible, inert). The shell closes it when the route changes.
import { t, type MessageKey } from '../i18n'
import Icon from './Icon.vue'
import Sheet from './Sheet.vue'
import Soon from './Soon.vue'

defineProps<{ modelValue: boolean; name: string; email: string; admin: boolean; pending: number }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean]; logout: [] }>()
</script>

<template>
  <Sheet :model-value="modelValue" :title="t('shell.more')" @update:model-value="emit('update:modelValue', $event)">
    <div class="msheet">
      <div class="macct">
        <span class="ava" aria-hidden="true">{{ (name || email).slice(0, 1) }}</span>
        <span class="mwho"><b>{{ name || email }}</b><small class="hint">{{ email }} · {{ admin ? t('shell.roleAdmin') : t('shell.roleUser') }}</small></span>
      </div>
      <section class="mbud" :aria-label="t('shell.groupBudget')">
        <p class="hint">{{ t('shell.groupBudget') }}</p>
        <div class="tiles">
          <RouterLink class="tile" to="/living"><span class="ti"><Icon name="living" /></span>{{ t('shell.pages.living') }}</RouterLink>
          <RouterLink class="tile" to="/spend/subs"><span class="ti"><Icon name="spend" /></span>{{ t('shell.pages.spend') }}</RouterLink>
          <Soon tag="div" class="tile" :aria-label="`${t('shell.pages.saving')} (${t('common.soon')})`"><span class="ti"><Icon name="saving" /></span>{{ t('shell.pages.saving') }}</Soon>
          <Soon tag="div" class="tile" :aria-label="`${t('shell.pages.invest')} (${t('common.soon')})`"><span class="ti"><Icon name="invest" /></span>{{ t('shell.pages.invest') }}</Soon>
        </div>
      </section>
      <Soon v-for="id in ['statements', 'assistant']" :key="id" tag="div" class="sh-row mrow" :aria-label="`${t(`shell.pages.${id}` as MessageKey)} (${t('common.soon')})`">
        <span class="mi"><Icon :name="id" :stroke="1.75" /></span><span class="mx"><b>{{ t(`shell.pages.${id}` as MessageKey) }}</b><small class="hint">{{ t(`shell.moreHints.${id}` as MessageKey) }}</small></span>
      </Soon>
      <RouterLink class="sh-row mrow" to="/pending"><span class="mi"><Icon name="pending" /></span><span class="mx"><b>{{ t('shell.pages.pending') }}</b><small class="hint">{{ t('shell.moreHints.pending') }}</small></span><span v-if="pending" class="pn" :aria-label="t('shell.pendingN', { n: pending })">{{ pending }}</span></RouterLink>
      <RouterLink class="sh-row mrow" to="/history"><span class="mi"><Icon name="history" /></span><span class="mx"><b>{{ t('shell.pages.history') }}</b><small class="hint">{{ t('shell.moreHints.history') }}</small></span></RouterLink>
      <RouterLink class="sh-row mrow" to="/settings/general"><span class="mi"><Icon name="settings" /></span><span class="mx"><b>{{ t('shell.pages.settings') }}</b><small class="hint">{{ t('shell.moreHints.settings') }}</small></span></RouterLink>
      <RouterLink v-if="admin" class="sh-row mrow" to="/admin"><span class="mi"><Icon name="admin" /></span><span class="mx"><b>{{ t('shell.pages.admin') }}</b><small class="hint">{{ t('shell.moreHints.admin') }}</small></span></RouterLink>
      <button class="sh-row mlogout" type="button" @click="emit('logout')"><span class="mi lo"><Icon name="logout" :stroke="1.9" /></span>{{ t('shell.logout') }}</button>
    </div>
  </Sheet>
</template>

<style scoped>
.macct{display:flex;align-items:center;gap:12px;padding:8px 16px 12px;border-bottom:1px solid var(--border);margin-bottom:6px}
.ava{width:36px;height:36px;border-radius:var(--r-card);background:var(--ava);color:var(--text-2);display:grid;place-items:center;font-weight:600;flex:none}
.mwho{display:flex;flex-direction:column;min-width:0}
.mwho b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mwho small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mbud{padding:4px 8px 10px;margin-bottom:6px;border-bottom:1px solid var(--border)}
.mbud p{margin:0 8px 6px;font-size:12px;font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px}
.tiles .tile{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:6px;min-height:0;width:auto;padding:10px 4px;border-radius:8px;color:var(--text);text-decoration:none;font-size:13px;font-weight:600;text-align:center}
.tiles .tile .ti{width:40px;height:40px;border-radius:8px;background:var(--primary-soft);color:var(--primary-text);display:grid;place-items:center}
.tiles .tile .ti svg,.mi svg{width:20px;height:20px}
.tiles .tile.is-soon{color:var(--subtle)}
.tiles .tile.is-soon .ti{background:var(--fill);color:var(--subtle)}
.msheet .sh-row.mrow{gap:14px;padding:0 16px;border-radius:8px}
.msheet .sh-row.mrow.is-soon{color:var(--subtle)}
.mi{width:36px;height:36px;border-radius:8px;background:var(--fill);color:var(--text-2);display:grid;place-items:center;flex:none}
.pn{flex:none;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent-soft);color:var(--accent-text);font-size:11px;font-weight:600;display:grid;place-items:center}
.mx{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start}
.mx b{font-size:15px}
.msheet .mlogout{gap:14px;min-height:52px;margin-top:6px;border-top:1px solid var(--border);border-radius:0;color:var(--neg-text);font-weight:600}
.mlogout .mi.lo{background:none;color:inherit}
</style>
