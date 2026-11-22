<script setup lang="ts">
import { computed, defineAsyncComponent, onActivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '../i18n'
import { store } from '../lib/store'
import { fmtMoney } from '../lib/display'
import { monthMoney, today, ymLabel, ymOf } from '../lib/calc'
import Icon from '../components/Icon.vue'
import PageHeader from '../components/PageHeader.vue'
import PageLoadError from '../components/PageLoadError.vue'
import Soon from '../components/Soon.vue'
import SpendGeneral from '../components/SpendGeneral.vue'
import SpendEditor from '../components/SpendEditor.vue'
import SpendInstallments from '../components/SpendInstallments.vue'
import SubTabs from '../components/SubTabs.vue'
import Tip from '../components/Tip.vue'

// 지출 (spec 011 S-1, S-5, S-7): one-off spending, installments and subscriptions under one menu. The
// page owns the title, the month's reflection card, the three tabs and each tab's add button. The 구독 tab
// is the whole of the old subscriptions page; 일반 and 할부 are SpendGeneral (W-5) and SpendInstallments (W-6).
// A page loaded on first open; if its code cannot be downloaded, say so and offer a reload.
const Subscriptions = defineAsyncComponent({ loader: () => import('./Subscriptions.vue'), errorComponent: PageLoadError, delay: 200 })

const props = defineProps<{ sub?: string }>()
const KINDS = ['general', 'inst', 'subs'] as const
type Kind = (typeof KINDS)[number]
const kind = computed<Kind>(() => (KINDS.includes(props.sub as Kind) ? (props.sub as Kind) : 'general'))
const route = useRoute()
const router = useRouter()
const pick = (id: string) => { void router.push(`/spend/${id}`) }

const general = computed(() => store.spendings.filter((s) => s.how === 'lump'))
const inst = computed(() => store.spendings.filter((s) => s.how !== 'lump'))
const tabs = computed(() => [
  { id: 'general', label: t('spending.tabs.general'), count: general.value.length },
  { id: 'inst', label: t('spending.tabs.inst'), count: inst.value.length },
  { id: 'subs', label: t('spending.tabs.subs'), count: store.subscriptions.length },
])

// ---------- the month's reflection (S-5): all numbers come from monthMoney ----------
const ym = ymOf(today())
const month = computed(() => {
  const now = monthMoney(store, ym)
  const none = monthMoney({ ...store, spendings: [] }, ym) // the same month without any one-off spending
  const items = now.spend.items.filter((i) => i.spending.payBy === 'subs')
  // one entry per spending (by id): two spendings with the same name are two items
  const list = [...new Map(items.map((i) => [i.spending.id, i.spending])).values()]
  const names = list.map((x) => x.name)
  const first = list[0]
  const itemText = !names.length ? ''
    : names.length === 1 ? t('spending.itemOne', { name: names[0]! }) + (first && first.currency === 'USD' ? t('spending.itemUsd', { amount: first.amount.toFixed(2) }) : '')
    : t('spending.itemMany', { name: names[0]!, n: names.length - 1 })
  const rem = now.dist.remainder
  const out = now.spend.remainder
  return {
    out, general: now.spend.general, inst: now.spend.installment,
    gShare: out ? (now.spend.general / out) * 100 : 0,
    add: now.spend.subs, before: none.transfer.transfer, after: now.transfer.transfer, itemText,
    rem, short: rem < 0, remBefore: none.dist.remainder,
  }
})
const monthName = Number(ym.slice(5, 7))

// ---------- add buttons: "/spend/<tab>?add" (spec 012 S-3) ----------
// "/spend/subs?add" (the record modal's 구독; the old #subs?add) opens the subscription add editor;
// "/spend/general?add" and "/spend/inst?add" (its 일회성 지출) open the spending editor. Only `add` is
// then taken out of the address, in place (the page stays where it is).
const adding = ref(false)
const spendAdd = ref<'general' | 'inst' | null>(null)
// The key is `add` followed by nothing that is a word character, as the hash form's /[?&]add\b/ took it
// (`add`, `add=1`, and also `add-x`; review 1 F-4).
const ADD = /^add(?!\w)/
function checkAdd() {
  if (route.meta.page !== 'spend') return // kept alive: other pages' addresses are not ours
  const key = Object.keys(route.query).find((k) => ADD.test(k))
  if (key === undefined) return
  const { [key]: _add, ...rest } = route.query
  void router.replace({ path: route.path, query: rest })
  const tab = String(route.params.tab)
  if (tab === 'general' || tab === 'inst') spendAdd.value = tab
  else adding.value = true
}
onActivated(checkAdd)
watch(() => route.query, checkAdd)

const addLabel = computed(() => ({ general: t('spending.addGeneral'), inst: t('spending.addInst'), subs: t('subscriptions.addSub') })[kind.value])
</script>

<template>
  <section class="page-gap">
    <PageHeader :title="t('spending.title')" :desc="t('spending.desc')">
      <Soon class="soon-btn" :aria-label="`${t('shell.csvExport')} (${t('common.soon')})`"><Icon name="download" />{{ t('shell.csvExport') }}</Soon>
    </PageHeader>

    <section class="card mstrip" aria-labelledby="ms-t">
      <div class="ms-h"><b id="ms-t">{{ t('spending.monthTitle', { ym: ymLabel(ym).replace('.', '. ') }) }}</b><Tip :text="t('spending.monthTip')" /><span class="hint sum">{{ t('spending.monthSum') }}</span></div>
      <div class="ms-g">
        <div>
          <span class="ms-l">{{ t('spending.fromRemainder') }}</span>
          <b class="num">{{ fmtMoney(month.out) }}</b>
          <div v-if="month.out" class="kstack" role="img" :aria-label="t('spending.stackLabel', { general: fmtMoney(month.general), inst: fmtMoney(month.inst) })">
            <span v-if="month.general" :style="{ width: `${month.gShare}%`, background: 'var(--primary)' }"></span><span v-if="month.inst" :style="{ width: `${100 - month.gShare}%`, background: 'var(--accent)' }"></span>
          </div>
          <small class="klg"><span><i style="background:var(--primary)"></i>{{ t('spending.kindGeneral') }} <b class="num">{{ fmtMoney(month.general) }}</b></span><span><i style="background:var(--accent)"></i>{{ t('spending.kindInst') }} <b class="num">{{ fmtMoney(month.inst) }}</b></span></small>
        </div>
        <div>
          <span class="ms-l">{{ t('spending.toTransfer') }}</span>
          <b class="num">{{ fmtMoney(month.add) }}</b>
          <small class="hint">{{ t('spending.transferLine') }} <b class="num"><template v-if="month.add">{{ fmtMoney(month.before) }} → {{ fmtMoney(month.after) }}</template><template v-else>{{ fmtMoney(month.after) }}</template></b></small>
          <small v-if="month.itemText" class="hint">{{ month.itemText }}</small>
        </div>
        <div>
          <span class="ms-l">{{ t('spending.remainderOf', { month: monthName }) }}</span>
          <span class="rem"><b class="num" :class="{ neg: month.short }">{{ month.rem < 0 ? '−' : '' }}{{ fmtMoney(Math.abs(month.rem)) }}</b><span v-if="month.short" class="pill warn">{{ t('spending.short') }}</span></span>
          <small v-if="month.out || month.add" class="hint">{{ t('spending.afterDist', { amount: fmtMoney(month.remBefore) }) }}<template v-if="month.short"> {{ t('spending.keepOthers') }}</template></small>
          <RouterLink v-if="month.short" class="lnk" to="/pay">{{ t('spending.adjust') }}</RouterLink>
        </div>
      </div>
    </section>

    <div class="tabrow">
      <SubTabs class="kinds" :model-value="kind" :tabs="tabs" :label="t('spending.kindsLabel')" @update:model-value="pick" />
      <button class="btn pri" type="button" @click="kind === 'subs' ? (adding = true) : (spendAdd = kind)"><Icon name="plus" />{{ addLabel }}</button>
    </div>

    <!-- kept alive: leaving the tab deactivates the page (its editors close, as when leaving the page), coming back finds its view and filters -->
    <KeepAlive>
      <Subscriptions v-if="kind === 'subs'" embedded :adding="adding" @added="adding = false" />
    </KeepAlive>
    <SpendGeneral v-if="kind === 'general'" />
    <SpendInstallments v-else-if="kind === 'inst'" />
    <SpendEditor v-if="spendAdd" :initial="null" :start="spendAdd" @close="spendAdd = null" />
  </section>
</template>

<style scoped>
.mstrip{padding:0}
.ms-h{display:flex;align-items:center;gap:4px;padding:12px 18px;border-bottom:1px solid var(--divider);font-size:13px}
.ms-h .sum{margin-left:auto}
.ms-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.ms-g > div{display:flex;flex-direction:column;gap:6px;padding:14px 18px;min-width:0}
.ms-g > div + div{border-left:1px solid var(--divider)}
.ms-g b.num{font-size:20px;font-weight:700}
.ms-g b.num.neg{color:var(--accent-text)}
.ms-g small b.num{font-size:inherit;font-weight:600;color:var(--text)}
.ms-l{font-size:12px;font-weight:600;color:var(--muted)}
.rem{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.kstack{display:flex;height:10px;gap:2px;border-radius:2px;overflow:hidden}
.klg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--muted)}
.klg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px}
.klg b{color:var(--text);font-weight:600}
.lnk{font-size:12px;font-weight:600;color:var(--primary-text);text-decoration:none}
.lnk:hover{text-decoration:underline}
.tabrow{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}
.tabrow > .kinds{flex:1 1 auto;min-width:0;margin:0}
.tabrow :deep(.subtabs){border-bottom:0}
.tabrow > .btn{flex:none;height:34px}
@media (max-width:760px){
  .ms-g{grid-template-columns:minmax(0,1fr)}
  .ms-g > div + div{border-left:0;border-top:1px solid var(--divider)}
}
</style>
