<script setup lang="ts">
import { onActivated, onMounted, ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { lang, t, te, type MessageKey } from '../i18n'
import { ApiError, api } from '../lib/api'
import { fmtDate, fmtMoney } from '../lib/display'
import { loadState, store, subName } from '../lib/store'

// 대기 중인 변경 (spec 009 S-9): what an AI key proposed. Each proposal shows what it changes — the
// rows before and after, and this month's and next month's transfer and distribution before and after,
// computed by the server by really applying it and rolling back — and waits for the user's
// confirm or reject. Confirming applies it as one change set (it shows in 변경 내역 as "AI · key name").
interface RowChange { table: string; op: 'insert' | 'update' | 'delete'; key: Record<string, string>; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
interface Delta { before: number; after: number }
interface MonthPreview {
  month: string
  transferKrw: Delta
  neededKrw: Delta
  distribution: { targetId: string; name: string; kind: string; amountKrw: { before: number | null; after: number | null } }[]
  remainderKrw: Delta
}
type Status = 'pending' | 'applied' | 'rejected' | 'expired' | 'stale'
interface Proposal {
  id: string
  keyName: string
  keyUsable: boolean
  confirm: 'ui' | 'chat'
  note: string | null
  status: Status
  createdAt: string
  expiresAt: string
  decidedAt: string | null
  decidedBy: 'user' | 'key' | null
  changeSetId: string | null
  revertOf: string | null
  preview: { rows: RowChange[]; months: MonthPreview[] }
}

const waiting = ref<Proposal[]>([])
const handled = ref<Proposal[]>([])
const moreHandled = ref(false)
const loaded = ref(false)
const busy = ref('')
const error = ref('')
const notice = ref('')
const open = ref<string | null>(null)
const HANDLED_PAGE = 20

/** Every waiting proposal (at most 20 can wait), and so the number for the badge: this list is never cut short. */
async function loadWaiting() {
  waiting.value = await api<Proposal[]>('GET', '/api/proposals?status=pending')
  store.pendingProposals = waiting.value.length
  // The first one is open: the numbers are what the user came to see.
  if (open.value === null) open.value = waiting.value[0]?.id ?? null
}

/** The handled ones, a page at a time, newest first. */
async function loadHandled(more = false) {
  const last = more ? handled.value.at(-1) : undefined
  const after = last ? `&before=${encodeURIComponent(last.createdAt)}&beforeId=${encodeURIComponent(last.id)}` : ''
  const page = await api<Proposal[]>('GET', `/api/proposals?status=handled&limit=${HANDLED_PAGE}${after}`)
  handled.value = more ? [...handled.value, ...page] : page
  moreHandled.value = page.length === HANDLED_PAGE
}

async function load() {
  try {
    await Promise.all([loadWaiting(), loadHandled()])
    loaded.value = true
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('pending.loadFailed')
  }
}
onMounted(load)
onActivated(load)

async function more() {
  try { await loadHandled(true) } catch (e) { error.value = e instanceof ApiError ? e.message : t('pending.loadFailed') }
}

async function decide(p: Proposal, what: 'apply' | 'reject') {
  busy.value = p.id
  error.value = ''
  notice.value = ''
  try {
    await api('POST', `/api/proposals/${p.id}/${what}`)
    notice.value = t(what === 'apply' ? 'pending.applied' : 'pending.rejected')
    if (what === 'apply') await loadState() // the screens show what the server holds now
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('pending.failed')
  } finally {
    busy.value = ''
    await load()
  }
}

// ── What a row is ──
const tableName = (name: string) => { const k = `history.table.${name}`; return te(k) ? t(k as MessageKey) : name }
const HIDDEN = new Set(['userId', 'seq', 'id'])
const targetName = (id: string) => store.targets.find((x) => x.id === id)?.name ?? id
const phaseName = (id: string) => { const p = store.phases.find((x) => x.id === id); return p ? `${p.label} ${p.name}` : id }
const label = (c: RowChange) => {
  const r = c.after ?? c.before ?? {}
  if (c.table === 'plan_change' && typeof r.subId === 'string') return subName(r.subId)
  if (c.table === 'phase_amount') return `${phaseName(String(r.phaseId))} · ${targetName(String(r.targetId))}`
  const name = r.name ?? r.text ?? r.title ?? r.label
  return typeof name === 'string' && name ? name : ''
}
const title = (c: RowChange) => `${tableName(c.table)} ${t(`history.op.${c.op}`)}${label(c) ? ` · ${label(c)}` : ''}`
const fields = (c: RowChange) => {
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})].filter((k) => !HIDDEN.has(k)))
  return [...keys]
    .map((k) => ({ k, b: c.before?.[k], a: c.after?.[k] }))
    .filter((f) => c.op !== 'update' || JSON.stringify(f.b) !== JSON.stringify(f.a))
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const summary = (p: Proposal) => {
  const first = p.preview.rows[0]
  if (!first) return t('history.noChange')
  const head = title(first)
  return p.preview.rows.length > 1 ? t('history.andMore', { head, n: p.preview.rows.length - 1 }) : head
}
const money = (n: number | null) => (n === null ? '—' : fmtMoney(n))
const changed = (d: { before: number | null; after: number | null }) => d.before !== d.after
const monthLabel = (ym: string) => ym.replace('-', '. ')
const loc = () => (lang.value === 'en' ? 'en-US' : 'ko-KR')
const when = (at: string) => { const d = new Date(at); return `${fmtDate(d)} ${d.toLocaleTimeString(loc(), { timeStyle: 'short' })}` }
const STATUS: Record<Status, MessageKey> = { pending: 'pending.status.pending', applied: 'pending.status.applied', rejected: 'pending.status.rejected', expired: 'pending.status.expired', stale: 'pending.status.stale' }
</script>

<template>
  <section>
    <PageHeader :title="t('pending.title')" :desc="t('pending.desc')" />
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <p v-if="loaded && !waiting.length" class="panel muted">{{ t('pending.none') }}</p>
    <article v-for="p in waiting" :key="p.id" class="panel prop" :data-proposal="p.id" :aria-label="summary(p)">
      <header class="phead">
        <div class="pt">
          <span class="pill mute">AI</span>
          <b>{{ t('pending.from', { key: p.keyName }) }}</b>
          <span v-if="p.revertOf" class="pill mute">{{ t('history.revertOf') }}</span>
        </div>
        <div class="small muted">{{ summary(p) }} · {{ when(p.createdAt) }}</div>
        <div v-if="p.note" class="note">{{ p.note }}</div>
      </header>

      <button type="button" class="btn toggle" :aria-expanded="open === p.id" @click="open = open === p.id ? null : p.id">{{ open === p.id ? t('pending.hideDetail') : t('pending.showDetail') }}</button>

      <div v-if="open === p.id" class="detail">
        <section v-for="(c, i) in p.preview.rows" :key="i" class="chg-row">
          <b class="small">{{ title(c) }}</b>
          <table class="small">
            <tbody>
              <tr v-for="f in fields(c)" :key="f.k">
                <th scope="row">{{ f.k }}</th>
                <td v-if="c.op !== 'insert'" class="muted">{{ show(f.b) }}</td>
                <td v-if="c.op === 'update'">→</td>
                <td v-if="c.op !== 'delete'">{{ show(f.a) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-for="mo in p.preview.months" :key="mo.month" class="month">
          <b class="small">{{ t('pending.monthTitle', { month: monthLabel(mo.month) }) }}</b>
          <table class="small">
            <tbody>
              <tr><th scope="row">{{ t('pending.transfer') }}</th><td class="n muted">{{ money(mo.transferKrw.before) }}</td><td>→</td><td class="n" :class="{ chg: changed(mo.transferKrw) }">{{ money(mo.transferKrw.after) }}</td></tr>
              <tr v-for="r in mo.distribution" :key="r.targetId" :class="{ same: !changed(r.amountKrw) }">
                <th scope="row">{{ r.name }}</th><td class="n muted">{{ money(r.amountKrw.before) }}</td><td>→</td><td class="n" :class="{ chg: changed(r.amountKrw) }">{{ money(r.amountKrw.after) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <footer class="pfoot">
        <span class="small muted">{{ t('pending.expires', { at: when(p.expiresAt) }) }}<template v-if="p.confirm === 'chat'"> · {{ t('pending.inChat') }}</template></span>
        <p v-if="!p.keyUsable" class="small warn" role="note">{{ t('pending.keyGone') }}</p>
        <div class="btns">
          <button class="btn pri" type="button" :disabled="!!busy || !p.keyUsable" @click="decide(p, 'apply')">{{ t('pending.confirmBtn') }}</button>
          <button class="btn" type="button" :disabled="!!busy" @click="decide(p, 'reject')">{{ t('pending.rejectBtn') }}</button>
        </div>
      </footer>
    </article>

    <div v-if="handled.length" class="panel">
      <h3>{{ t('pending.decided') }}</h3>
      <ul class="list" :aria-label="t('pending.decided')">
        <li v-for="p in handled" :key="p.id" class="done">
          <span class="small">{{ t('pending.from', { key: p.keyName }) }} · {{ summary(p) }}<br><span class="muted mono">{{ when(p.decidedAt ?? p.createdAt) }}</span></span>
          <span class="pill" :class="p.status === 'applied' ? 'ok' : 'mute'">{{ t(STATUS[p.status]) }}</span>
        </li>
      </ul>
      <div v-if="moreHandled" class="btns" style="margin-top:12px"><button class="btn" type="button" @click="more()">{{ t('history.more') }}</button></div>
    </div>
  </section>
</template>

<style scoped>
.prop{margin-bottom:14px;display:grid;gap:10px}
.phead{display:grid;gap:4px}
.pt{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.note{font-size:13px;color:var(--text-2);overflow-wrap:anywhere}
.toggle{justify-self:start}
.detail{display:grid;gap:12px}
.chg-row table,.month table{border-collapse:collapse;margin-top:4px}
.chg-row th,.month th{text-align:left;font-weight:500;padding:2px 12px 2px 0;color:var(--muted)}
.chg-row td,.month td{padding:2px 8px 2px 0;word-break:break-all}
.month td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.month .chg{font-weight:600;color:var(--accent-text)}
.month .same{opacity:.55}
.pfoot{display:grid;gap:8px}
.warn{color:var(--neg-text);margin:0}
.done{grid-template-columns:minmax(0,1fr) auto !important}
</style>
