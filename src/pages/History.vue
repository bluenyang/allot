<script setup lang="ts">
import { lang, t, te, type MessageKey } from '../i18n'
import PageHeader from '../components/PageHeader.vue'
import EditSheet from '../components/EditSheet.vue'
import Icon from '../components/Icon.vue'
import Seg from '../components/Seg.vue'
import Soon from '../components/Soon.vue'
import { fmtDate } from '../lib/display'
import { weekdayShort } from '../lib/format'
import { showToast } from '../lib/toast'
import { computed, onActivated, onMounted, ref } from 'vue'
import { ApiError, api } from '../lib/api'
import { loadState, store, subName } from '../lib/store'

// Change history (spec 005 S-3, restyled by spec 010 S-9): one save = one change set, newest first, grouped by
// day. A set can be reverted like a commit: the opposite change is saved as a new set (also a revert can be
// reverted again, D-10). The server refuses when a row changed since (409) or a rule would break (400); the
// modal shows the reason and stays open. The filters (who, item type) work on the sets loaded so far.
interface Change {
  id: number
  tableName: string
  rowKey: Record<string, string>
  op: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}
interface ChangeSet {
  id: string
  at: string
  actorKind: 'user' | 'api_key'
  /** The AI key's name when an AI key made the set (spec 009). */
  actorLabel: string | null
  method: string
  path: string
  revertOf: string | null
  revertedBy: string | null
  changes: Change[]
}

const tableName = (name: string) => { const k = `history.table.${name}`; return te(k) ? t(k as MessageKey) : name }
const OP = { insert: 'insert', update: 'update', delete: 'delete' } as const
/** What the opposite change was, for a set that reverts another. */
const WAS = { insert: 'delete', delete: 'insert', update: 'update' } as const
const HIDDEN = new Set(['userId', 'seq', 'id'])

const sets = ref<ChangeSet[]>([])
const open = ref<Set<string>>(new Set())
const busy = ref(false)
const more = ref(true)
const error = ref('')
const PAGE = 30

async function load(reset = true) {
  busy.value = true
  error.value = ''
  try {
    const last = sets.value.at(-1)
    const before = !reset && last ? `&before=${encodeURIComponent(last.at)}&beforeId=${encodeURIComponent(last.id)}` : ''
    const page = await api<ChangeSet[]>('GET', `/api/changes?limit=${PAGE}${before}`)
    sets.value = reset ? page : [...sets.value, ...page]
    more.value = page.length === PAGE
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('history.loadFailed')
  } finally {
    busy.value = false
  }
}
onMounted(() => load())
onActivated(() => load())

const locale = () => (lang.value === 'en' ? 'en-US' : 'ko-KR')
const timeOf = (at: string) => new Date(at).toLocaleTimeString(locale(), { timeStyle: 'short' })
const dayKey = (at: string) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** A subscription's name, also when it has been deleted since (taken from the loaded history). */
const subLabel = (id: string) => {
  if (store.subscriptions.some((x) => x.id === id)) return subName(id)
  for (const set of sets.value) for (const ch of set.changes) {
    const r = ch.tableName === 'subscription' && ch.rowKey.id === id ? ch.after ?? ch.before : null
    if (typeof r?.name === 'string') return r.name
  }
  return t('history.deletedSub')
}
const targetName = (id: string) => store.targets.find((x) => x.id === id)?.name ?? id
const phaseName = (id: string) => { const p = store.phases.find((x) => x.id === id); return p ? `${p.label} ${p.name}` : id }
const label = (c: Change) => {
  const r = c.after ?? c.before ?? {}
  if (c.tableName === 'plan_change' && typeof r.subId === 'string') return subLabel(r.subId)
  if (c.tableName === 'phase_amount') return `${phaseName(String(r.phaseId))} · ${targetName(String(r.targetId))}`
  const name = r.name ?? r.text ?? r.title ?? r.label ?? r.note
  return typeof name === 'string' && name ? name : Object.values(c.rowKey).join(' · ')
}
const opWord = (c: Change) => `${tableName(c.tableName)} ${t(`history.op.${OP[c.op]}`)}`
// Single-row tables (settings, preferences) have no name: no trailing separator (spec 007 V-9 b).
const title = (c: Change) => { const l = label(c); return `${opWord(c)}${l ? ` · ${l}` : ''}` }
/** The row's two parts: what was done, and to what. A revert names the change it undoes. */
const parts = (s: ChangeSet) => {
  const first = s.changes[0]
  if (!first) return { op: t('history.noChange'), target: '' }
  const op = s.revertOf ? t('history.revertOp', { op: `${tableName(first.tableName)} ${t(`history.op.${WAS[first.op]}`)}` }) : opWord(first)
  const l = label(first)
  return { op, target: s.changes.length > 1 ? t('history.andMore', { head: l, n: s.changes.length - 1 }) : l }
}
const summary = (s: ChangeSet) => { const p = parts(s); return p.target ? `${p.op} · ${p.target}` : p.op }
/** Fields that differ (update), or every visible field (insert / delete). */
const fields = (c: Change) => {
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})].filter((k) => !HIDDEN.has(k)))
  return [...keys]
    .map((k) => ({ k, b: c.before?.[k], a: c.after?.[k] }))
    .filter((f) => c.op !== 'update' || JSON.stringify(f.b) !== JSON.stringify(f.a))
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const actorOf = (s: ChangeSet) => (s.actorKind === 'api_key' ? (s.actorLabel ? t('history.byKey', { key: s.actorLabel }) : t('history.aiOnly')) : t('history.you'))

// ---------- filters ----------
const actor = ref<'all' | 'me' | 'ai'>('all')
const kind = ref('')
const KIND_IDS = ['subscription', 'plan_change', 'living', 'allocation_target', 'phase', 'phase_amount', 'remainder_split', 'bank_account', 'debt', 'plan_event', 'check_item', 'settings', 'preference', 'holiday_set']
/** The remainder split's rows are named after what the remainder target is, not a fixed word (spec 010 S-9). */
const kindOpts = computed(() => KIND_IDS.map((id) => ({ id, label: id === 'remainder_split' ? t('history.kindRemainder') : tableName(id) })))
const byKind = computed(() => sets.value.filter((s) => !kind.value || s.changes.some((c) => c.tableName === kind.value)))
const actorOpts = computed(() => [
  { id: 'all', label: t('history.actorAll'), count: byKind.value.length },
  { id: 'me', label: t('history.actorMe'), count: byKind.value.filter((s) => s.actorKind === 'user').length },
  { id: 'ai', label: t('history.actorAi'), count: byKind.value.filter((s) => s.actorKind === 'api_key').length },
])
const shown = computed(() => byKind.value.filter((s) => actor.value === 'all' || (actor.value === 'ai') === (s.actorKind === 'api_key')))
const days = computed(() => {
  const out: { key: string; head: string; sets: ChangeSet[] }[] = []
  for (const s of shown.value) {
    const k = dayKey(s.at)
    const last = out.at(-1)
    if (last?.key === k) last.sets.push(s)
    else out.push({ key: k, head: `${fmtDate(new Date(s.at))} (${weekdayShort(new Date(s.at))})`, sets: [s] })
  }
  return out
})

const toggle = (id: string) => { const n = new Set(open.value); if (!n.delete(id)) n.add(id); open.value = n }

// ---------- revert ----------
const ask = ref<ChangeSet | null>(null)
const askError = ref('')
const effect = (s: ChangeSet) => {
  if (s.revertOf) return t('history.effectRevert')
  if (s.changes.length > 1) return t('history.effectMany', { n: s.changes.length })
  const c = s.changes[0]
  const target = c ? label(c) || tableName(c.tableName) : ''
  return t(c?.op === 'insert' ? 'history.effectInsert' : c?.op === 'delete' ? 'history.effectDelete' : 'history.effectUpdate', { target })
}
function openAsk(s: ChangeSet) { ask.value = s; askError.value = '' }
async function revert() {
  const s = ask.value
  if (!s) return
  busy.value = true
  askError.value = ''
  try {
    await api('POST', `/api/changes/${s.id}/revert`)
    ask.value = null
    showToast(t('history.revertedToast', { summary: summary(s) }))
    await loadState() // the screens show what the server holds now
    await load()
  } catch (e) {
    askError.value = e instanceof ApiError ? e.message : t('history.revertFailed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <PageHeader :title="t('history.title')" :desc="t('history.desc')">
      <a class="btn" href="#pending">{{ t('history.pendingLink') }}</a>
    </PageHeader>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>

    <section class="card">
      <div class="fbar">
        <Seg v-model="actor" :options="actorOpts" :label="t('history.actorFilter')" />
        <span class="vr" aria-hidden="true"></span>
        <select v-model="kind" class="in" :aria-label="t('history.kindFilter')">
          <option value="">{{ t('history.kindAll') }}</option>
          <option v-for="o in kindOpts" :key="o.id" :value="o.id">{{ o.label }}</option>
        </select>
        <Soon tag="span" class="period">{{ t('history.period') }}</Soon>
        <span class="hint cn">{{ t('history.count', { n: shown.length }) }}</span>
      </div>

      <ul :aria-label="t('history.listLabel')" class="chgs">
        <template v-for="d in days" :key="d.key">
          <li class="day" role="presentation"><span class="num">{{ d.head }}</span><span aria-hidden="true">·</span><span class="num">{{ t('history.dayCount', { n: d.sets.length }) }}</span></li>
          <li v-for="s in d.sets" :key="s.id" class="chg" :class="{ rev: s.revertOf }" :data-set="s.id">
            <div class="crow">
              <button type="button" class="disc" :aria-expanded="open.has(s.id) ? 'true' : 'false'" :aria-label="t('history.openLabel', { title: summary(s) })" @click="toggle(s.id)">
                <Icon name="chev" :stroke="2" :style="{ transform: open.has(s.id) ? 'rotate(90deg)' : 'none' }" />
              </button>
              <span class="pill" :class="s.actorKind === 'api_key' ? 'acc' : 'mute'">{{ actorOf(s) }}</span>
              <span class="tx">
                <span class="op">{{ parts(s).op }}</span> <span v-if="parts(s).target" class="sep" aria-hidden="true">·</span> <b v-if="parts(s).target" :class="{ struck: !!s.revertedBy }">{{ parts(s).target }}</b>
                <span v-if="s.revertedBy" class="pill mute">{{ t('history.revertOf') }}</span>
              </span>
              <span class="tm mono">{{ timeOf(s.at) }}</span>
              <span v-if="s.revertedBy" class="hint done">{{ t('history.revertedHint') }}</span>
              <button v-else type="button" class="btn sm" :disabled="busy" @click="openAsk(s)"><Icon name="undo" :stroke="2" />{{ t('history.revertBtn') }}</button>
            </div>
            <div v-if="open.has(s.id)" class="det">
              <div v-for="c in s.changes" :key="c.id" class="chg-row">
                <b v-if="s.changes.length > 1" class="small">{{ title(c) }}</b>
                <table class="small">
                  <thead><tr><th scope="col">{{ t('history.colField') }}</th><th scope="col">{{ t('history.colBefore') }}</th><th scope="col">{{ t('history.colAfter') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="f in fields(c)" :key="f.k">
                      <th scope="row">{{ f.k }}</th>
                      <td class="bef">{{ c.op === 'insert' ? '—' : show(f.b) }}</td>
                      <td class="aft">{{ c.op === 'delete' ? '—' : show(f.a) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="s.revertOf" class="hint">{{ t('history.revertNote') }}</p>
            </div>
          </li>
        </template>
      </ul>
      <div v-if="!sets.length && !busy" class="none"><b>{{ t('history.empty') }}</b></div>
      <div v-else-if="sets.length && !shown.length && more" class="none" data-more><b>{{ t('history.emptyLoaded') }}</b><span class="hint">{{ t('history.emptyLoadedHint') }}</span></div>
      <div v-else-if="sets.length && !shown.length" class="none"><b>{{ t('history.emptyFiltered') }}</b><span class="hint">{{ t('history.emptyFilteredHint') }}</span></div>
      <div v-if="more && sets.length" class="mr"><button class="btn sm" type="button" :disabled="busy" @click="load(false)">{{ t('history.more') }}</button></div>
    </section>

    <EditSheet
      v-if="ask" :title="t('history.askTitle')" :error="askError" :busy="busy" :save-label="t('history.revertBtn')" @save="revert" @cancel="ask = null"
    >
      <div class="askbox">
        <small class="hint">{{ actorOf(ask) }} · {{ fmtDate(new Date(ask.at)) }} {{ timeOf(ask.at) }}</small>
        <b>{{ summary(ask) }}</b>
      </div>
      <p class="eff">{{ effect(ask) }}</p>
      <p class="hint">{{ t('history.askHint') }}</p>
    </EditSheet>
  </section>
</template>

<style scoped>
.card{margin-top:0;overflow:hidden}
.fbar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border)}
.fbar .in{width:auto;height:34px;font-size:13px}
.vr{width:1px;height:24px;background:var(--border)}
.cn{margin-left:auto}
.chgs{list-style:none;margin:0;padding:0}
.day{display:flex;align-items:center;gap:8px;padding:8px 18px;background:var(--surface-2);border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--subtle)}
.chg{border-bottom:1px solid var(--divider)}
.chg.rev{background:var(--primary-tint)}
.crow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 18px 8px 10px;min-height:52px}
.disc{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:var(--r-ctl);background:transparent;color:var(--muted);cursor:pointer;padding:0}
.disc:hover{background:var(--fill);color:var(--text)}
.disc :deep(svg){width:16px;height:16px;transition:transform .15s}
.tx{flex:1 1 260px;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;overflow-wrap:anywhere}
.op{color:var(--muted)}
.sep{color:var(--subtle)}
.tx b{font-weight:600}
.tx b.struck{text-decoration:line-through;color:var(--subtle)}
.tm{font-size:12px;color:var(--subtle)}
.done{min-width:84px;text-align:right}
.btn svg{width:14px;height:14px}
.det{padding:0 18px 14px 56px;display:grid;gap:10px}
.chg-row table{width:100%;max-width:640px;border-collapse:collapse;border:1px solid var(--border)}
.chg-row th,.chg-row td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--divider);overflow-wrap:anywhere}
.chg-row thead th{background:var(--surface-2);color:var(--subtle);font-weight:500}
.chg-row tbody th{font-weight:500;color:var(--muted)}
.chg-row .bef{color:var(--subtle)}
.chg-row .aft{font-weight:600}
.det .hint{margin:0}
.none{padding:32px 18px;text-align:center;color:var(--muted);display:flex;flex-direction:column;gap:2px}
.none b{color:var(--text)}
.mr{display:flex;justify-content:center;padding:12px}
.askbox{padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface-2);display:grid;gap:2px}
.eff{margin:0;font-size:13px;color:var(--text-2)}
.hint{margin:0}
@media (max-width:760px){.vr{display:none}.det{padding-left:16px}.crow{padding-right:12px}}
</style>
