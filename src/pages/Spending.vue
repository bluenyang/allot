<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, onDeactivated, ref } from 'vue'
import { t } from '../i18n'
import { store } from '../lib/store'
import { fmtDate, fmtMoney } from '../lib/display'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import PageLoadError from '../components/PageLoadError.vue'
import Soon from '../components/Soon.vue'
import SubTabs from '../components/SubTabs.vue'

// 지출 (spec 011 S-1, S-5, S-7): one-off spending, installments and subscriptions under one menu. The
// page owns the title, the month's reflection card, the three tabs and each tab's add button. The 구독 tab
// is the whole of the old subscriptions page; 일반 and 할부 are filled by W-5 and W-6.
// A page loaded on first open; if its code cannot be downloaded, say so and offer a reload.
const Subscriptions = defineAsyncComponent({ loader: () => import('./Subscriptions.vue'), errorComponent: PageLoadError, delay: 200 })

const props = defineProps<{ sub?: string }>()
const KINDS = ['general', 'inst', 'subs'] as const
type Kind = (typeof KINDS)[number]
const kind = computed<Kind>(() => (KINDS.includes(props.sub as Kind) ? (props.sub as Kind) : 'general'))
const pick = (id: string) => { location.hash = `#spend/${id}` }

const general = computed(() => store.spendings.filter((s) => s.how === 'lump'))
const inst = computed(() => store.spendings.filter((s) => s.how !== 'lump'))
const tabs = computed(() => [
  { id: 'general', label: t('spending.tabs.general'), count: general.value.length },
  { id: 'inst', label: t('spending.tabs.inst'), count: inst.value.length },
  { id: 'subs', label: t('spending.tabs.subs'), count: store.subscriptions.length },
])

// ---------- the 구독 tab: add button, #subs?add and #spend/subs?add ----------
// "#subs?add" (the record modal's 구독) opens the subscription add editor; the hash goes back to its plain form.
const adding = ref(false)
function checkAdd() {
  const m = /^#(subs|spend\/subs)\?(.*&)?add\b/.exec(location.hash)
  if (!m) return
  history.replaceState(null, '', `${location.pathname}${location.search}#${m[1]}`)
  adding.value = true
}
onActivated(() => { checkAdd(); window.addEventListener('hashchange', checkAdd) })
onDeactivated(() => window.removeEventListener('hashchange', checkAdd))

const addLabel = computed(() => ({ general: t('spending.addGeneral'), inst: t('spending.addInst'), subs: t('subscriptions.addSub') })[kind.value])
</script>

<template>
  <section class="page-gap">
    <PageHeader :title="t('spending.title')" :desc="t('spending.desc')">
      <Soon class="soon-btn" :aria-label="`${t('shell.csvExport')} (${t('common.soon')})`"><Icon name="download" />{{ t('shell.csvExport') }}</Soon>
    </PageHeader>

    <div class="tabrow">
      <SubTabs class="kinds" :model-value="kind" :tabs="tabs" :label="t('spending.kindsLabel')" @update:model-value="pick" />
      <!-- W-4: the one-off and installment editors come with W-7; their buttons are drawn and inert until then -->
      <button v-if="kind === 'subs'" class="btn pri" type="button" @click="adding = true"><Icon name="plus" />{{ addLabel }}</button>
      <Soon v-else class="btn pri" :aria-label="`${addLabel} (${t('common.soon')})`"><Icon name="plus" />{{ addLabel }}</Soon>
    </div>

    <Subscriptions v-if="kind === 'subs'" embedded :adding="adding" @added="adding = false" />
    <!-- Placeholder until W-5 (일반) and W-6 (할부): the saved items as plain lines, or the empty state of the canvas -->
    <section v-else class="card">
      <div v-if="!(kind === 'general' ? general : inst).length" class="empty"><b>{{ t('spending.emptyTitle') }}</b><span class="hint">{{ kind === 'general' ? t('spending.emptyGeneral') : t('spending.emptyInst') }}</span></div>
      <ul v-else class="plain">
        <li v-for="s in (kind === 'general' ? general : inst)" :key="s.id"><b>{{ s.name }}</b><span class="mono hint">{{ fmtDate(s.bought) }}</span><span class="num">{{ fmtMoney(s.rounds.reduce((a, r) => a + (r.state === 'merged' ? 0 : r.amount), 0)) }}</span></li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.tabrow{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}
.tabrow > .kinds{flex:1 1 auto;min-width:0;margin:0}
.tabrow :deep(.subtabs){border-bottom:0}
.tabrow > .btn{flex:none;height:34px}
.empty{display:flex;flex-direction:column;align-items:center;gap:2px;padding:32px 18px;text-align:center;color:var(--muted)}
.empty b{color:var(--text)}
.plain{list-style:none;margin:0;padding:0}
.plain li{display:flex;align-items:baseline;gap:12px;padding:12px 18px;border-bottom:1px solid var(--divider)}
.plain li:last-child{border-bottom:0}
.plain li b{flex:1;min-width:0;overflow-wrap:anywhere}
</style>
