<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import Seg from '../components/Seg.vue'
import Icon from '../components/Icon.vue'
import { t } from '../i18n'
import { fmtMoney } from '../lib/display'
import {
  canUndo, changed, decide, fieldName, listFor, loadProposals, money, monthLabel, moreProposals, proposalTitle, proposals, rowFields, rowTarget, shown,
  summary, undo, when, worded, type MonthPreview, type Proposal, type RowChange,
} from '../lib/proposals'

// 대기 중인 변경 (spec 009 S-9, redrawn by spec 010 S-6): what an AI key proposed, one card each. The
// card shows what it changes — rows before and after, and the transfer and distribution of this and
// next month before and after — and waits for the user's confirm or reject. Confirming applies it as
// one change set (it shows in 변경 내역 as "AI · key name"). A decided card stays on the screen.
const filter = ref<'waiting' | 'handled' | 'all'>('waiting')
const opened = reactive<Record<string, boolean>>({})
// Waiting cards are open, handled ones closed, until the user toggles one.
const isOpen = (p: Proposal) => opened[p.id] ?? p.status === 'pending'
const toggle = (p: Proposal) => { opened[p.id] = !isOpen(p) }

onMounted(loadProposals)
onActivated(loadProposals)

const list = computed(() => listFor(filter.value))
const seg = computed(() => [
  { id: 'waiting', label: t('pending.filterWaiting'), count: proposals.waiting.length },
  { id: 'handled', label: t('pending.filterHandled') },
  { id: 'all', label: t('pending.filterAll') },
])

/** The remainder row's name of a month and how much it moves: "투자 −₩60,000". */
function net(mo: MonthPreview) {
  const r = mo.distribution.find((x) => x.kind === 'remainder')
  if (!r) return null
  const d = (r.amountKrw.after ?? 0) - (r.amountKrw.before ?? 0)
  if (d === 0) return null
  return { name: r.name, text: `${d > 0 ? '+' : '−'}${fmtMoney(Math.abs(d))}`, cls: d < 0 ? 'up' : 'down' }
}
const isUpdate = (c: RowChange) => c.op === 'update'
/** A note for a handled card, by how it ended. */
function handledNote(p: Proposal): string {
  if (p.status === 'applied') return t('pending.noteApplied', { at: when(p.decidedAt ?? p.createdAt) })
  if (p.status === 'rejected') return t('pending.noteRejected', { at: when(p.decidedAt ?? p.createdAt) })
  if (p.status === 'expired') return t('pending.noteExpired', { at: when(p.expiresAt) })
  return t('pending.status.stale')
}
</script>

<template>
  <section class="page-gap">
    <PageHeader :title="t('pending.title')" :desc="t('pending.desc')" class="pend-ph">
      <a class="btn" href="#settings/ai">{{ t('pending.manageKeys') }}</a>
    </PageHeader>
    <p v-if="proposals.error" class="save-err" role="alert">{{ proposals.error }} <button type="button" @click="proposals.error = ''">{{ t('common.close') }}</button></p>

    <div class="fbar">
      <Seg v-model="filter" :options="seg" :label="t('pending.filterLabel')" bordered />
      <span class="hint">{{ t('pending.expiryHint') }}</span>
    </div>

    <div v-if="proposals.loaded && !list.length" class="card empty-card">
      <b>{{ filter === 'waiting' ? t('pending.none') : t('pending.noneHandled') }}</b>
      <span class="hint">{{ t('pending.noneHint') }}</span>
    </div>

    <article v-for="p in list" :key="p.id" class="card prop" :class="{ wait: p.status === 'pending' }" :data-proposal="p.id" :aria-label="summary(p)">
      <header class="ph2">
        <span class="ico"><Icon name="sparkle" /></span>
        <div class="tt">
          <b>{{ proposalTitle(p) }}</b>
          <small class="hint">{{ t('pending.meta', { key: p.keyName, at: when(p.createdAt), summary: summary(p) }) }}</small>
        </div>
        <span v-if="p.revertOf" class="pill mute">{{ t('history.revertOf') }}</span>
        <span class="pill" :class="shown(p).cls">{{ shown(p).label }}</span>
        <button type="button" class="btn sm ghost" :aria-expanded="isOpen(p)" @click="toggle(p)">{{ isOpen(p) ? t('pending.hideDetail') : t('pending.showDetail') }}</button>
      </header>

      <div v-if="isOpen(p)" class="detail">
        <section v-for="(c, i) in p.preview.rows" :key="i" class="chg">
          <div class="chg-h"><span class="pill" :class="c.op === 'insert' ? 'ok' : c.op === 'delete' ? 'bad' : 'mute'">{{ t(`history.op.${c.op}`) }}</span><b>{{ rowTarget(c) }}</b></div>
          <div v-if="isUpdate(c)" class="tw">
            <table>
              <tbody>
                <tr v-for="f in rowFields(c)" :key="f.k">
                  <td class="k">{{ fieldName(f.k) }}</td>
                  <td class="from num">{{ worded(f.k, f.b, c.before) }}</td>
                  <td class="arr">→</td>
                  <td class="to num">{{ worded(f.k, f.a, c.after) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <dl v-else class="dl" :class="{ gone: c.op === 'delete' }">
            <div v-for="f in rowFields(c)" :key="f.k">
              <dt>{{ fieldName(f.k) }}</dt>
              <dd :class="{ sig: f.k === 'verified' && !(c.after ?? c.before)?.verified, subtle: worded(f.k, c.op === 'delete' ? f.b : f.a, c.op === 'delete' ? c.before : c.after) === '—' }">{{ worded(f.k, c.op === 'delete' ? f.b : f.a, c.op === 'delete' ? c.before : c.after) }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="p.preview.months.length" class="months">
          <b class="mt">{{ t('pending.monthsTitle') }}</b>
          <div class="mgrid">
            <div v-for="mo in p.preview.months" :key="mo.month" class="mbox">
              <div class="mh"><span class="num">{{ monthLabel(mo.month) }}</span><b v-if="net(mo)" class="num" :class="net(mo)!.cls">{{ net(mo)!.name }} {{ net(mo)!.text }}</b></div>
              <div class="mr" :class="{ same: !changed(mo.transferKrw) }">
                <span>{{ t('pending.transfer') }}</span>
                <span class="num old" :class="{ strike: changed(mo.transferKrw) }">{{ money(mo.transferKrw.before) }}</span><span class="ar">→</span>
                <span class="num new" :class="{ chg: changed(mo.transferKrw) }">{{ money(mo.transferKrw.after) }}</span>
              </div>
              <div v-for="r in mo.distribution" :key="r.targetId" class="mr" :class="{ same: !changed(r.amountKrw) }">
                <span>{{ r.name }}</span>
                <span class="num old" :class="{ strike: changed(r.amountKrw) }">{{ money(r.amountKrw.before) }}</span><span class="ar">→</span>
                <span class="num new" :class="{ chg: changed(r.amountKrw) }">{{ money(r.amountKrw.after) }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer class="pfoot">
        <template v-if="p.status === 'pending'">
          <div class="note small">
            <span>{{ t('pending.expires', { at: when(p.expiresAt) }) }}<template v-if="p.confirm === 'chat'"> · {{ t('pending.inChat') }}</template></span>
            <p v-if="!p.keyUsable" class="warn" role="note">{{ t('pending.keyGone') }}</p>
          </div>
          <button class="btn sm bad" type="button" :disabled="!!proposals.busy" @click="decide(p, 'reject')">{{ t('pending.rejectBtn') }}</button>
          <button class="btn sm pri" type="button" :disabled="!!proposals.busy || !p.keyUsable" @click="decide(p, 'apply')">{{ t('pending.confirmBtn') }}</button>
        </template>
        <template v-else>
          <span class="note small">{{ proposals.decided[p.id] === 'reverted' ? t('pending.noteReverted') : handledNote(p) }}</span>
          <button v-if="canUndo(p)" class="btn sm" type="button" :disabled="!!proposals.busy" @click="undo(p.id)"><Icon name="undo" />{{ t('pending.undo') }}</button>
          <a v-if="p.status === 'applied'" class="btn sm ghost" href="#history">{{ t('pending.viewHistory') }}</a>
        </template>
      </footer>
    </article>

    <div v-if="proposals.moreHandled && filter !== 'waiting'" class="btns more"><button class="btn" type="button" @click="moreProposals()">{{ t('history.more') }}</button></div>
  </section>
</template>

<style scoped>
.pend-ph :deep(.sub){max-width:680px}
.fbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.fbar :deep(.seg){flex:none}
.empty-card{display:flex;flex-direction:column;align-items:center;gap:6px;padding:36px 18px;text-align:center}
.prop{display:flex;flex-direction:column}
.ph2{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--divider)}
.ico{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:var(--r-ctl);background:var(--accent-soft);color:var(--accent-text)}
.ico svg{width:15px;height:15px}
.tt{flex:1 1 240px;min-width:0;display:flex;flex-direction:column}
.tt b{overflow-wrap:anywhere}
.detail{display:flex;flex-direction:column}
.chg{padding:12px 18px 4px}
.chg + .chg{padding-top:8px}
.chg-h{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tw{overflow-x:auto}
.tw table{width:100%;border-collapse:collapse;font-size:13px}
.tw td{padding:8px 12px;border-bottom:1px solid var(--divider)}
.tw td.k{width:34%;color:var(--muted);padding-left:0}
.tw td.from{color:var(--subtle);text-decoration:line-through}
.tw td.arr{color:var(--subtle);padding:8px 0}
.tw td.to{font-weight:600;padding-right:0}
.dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));column-gap:24px;font-size:13px}
.dl > div{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed var(--border)}
.dl dt{color:var(--muted)}
.dl dd{margin:0;font-weight:600;text-align:right;overflow-wrap:anywhere}
.dl dd.sig{color:var(--accent-text)}
.dl dd.subtle{color:var(--subtle);font-weight:400}
.dl.gone dd{text-decoration:line-through;color:var(--subtle)}
.months{padding:12px 18px 16px;background:var(--surface-2);margin-top:8px;border-top:1px solid var(--divider)}
.mt{display:block;font-size:13px;margin-bottom:8px}
.mgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.mbox{border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);overflow:hidden}
.mh{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--divider);font-size:13px}
.mh b{font-size:12px}
.mh b.down{color:var(--primary-text)}
.mr{display:grid;grid-template-columns:minmax(0,1fr) 104px 16px 104px;gap:8px;align-items:baseline;padding:6px 12px;font-size:13px}
.mr .old{color:var(--muted)}
.mr .old.strike{text-decoration:line-through;color:var(--subtle)}
.mr .ar{color:var(--subtle);text-align:center}
.mr .new,.mr .old{text-align:right}
.mr .new.chg{font-weight:700}
.mr.same{color:var(--subtle)}
.pfoot{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 18px;background:var(--surface-2);border-top:1px solid var(--divider);border-radius:0 0 var(--r-card) var(--r-card)}
.pfoot .note{flex:1 1 200px;color:var(--muted);display:flex;flex-direction:column;gap:2px}
.pfoot .warn{color:var(--neg-text);margin:0}
.more{justify-content:center;margin:0}
.save-err{margin:0}
@media (max-width:760px){
  .ph2{padding:12px 14px}
  .tw table{white-space:nowrap}
  .mr{grid-template-columns:minmax(0,1fr) auto 16px auto}
}
</style>
