<script setup lang="ts">
import { lang, t, te, type MessageKey } from '../i18n'
import PageHeader from '../components/PageHeader.vue'
import { fmtDate } from '../lib/display'
import { onActivated, onMounted, ref } from 'vue'
import { ApiError, api } from '../lib/api'
import { loadState, store, subName } from '../lib/store'

// Change history (spec 005 S-3): one save = one change set, newest first. A set can be
// reverted like a commit: the opposite change is saved as a new set. The server refuses when
// a row changed since (409) or a rule would break (400); the message says why.
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
  method: string
  path: string
  revertOf: string | null
  revertedBy: string | null
  changes: Change[]
}

const tableName = (name: string) => { const k = `history.table.${name}`; return te(k) ? t(k as MessageKey) : name }
const OP = { insert: 'insert', update: 'update', delete: 'delete' } as const
const HIDDEN = new Set(['userId', 'seq', 'id'])

const sets = ref<ChangeSet[]>([])
const open = ref<string | null>(null)
const busy = ref(false)
const more = ref(true)
const error = ref('')
const notice = ref('')
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

// The date follows the display settings (spec 007 S-8, review 1 R10); the time is added after it.
const fmt = (at: string) => { const d = new Date(at); return `${fmtDate(d)} ${d.toLocaleTimeString(lang.value === 'en' ? 'en-US' : 'ko-KR', { timeStyle: 'short' })}` }
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
// Single-row tables (settings, preferences) have no name: no trailing separator (spec 007 V-9 b).
const title = (c: Change) => { const l = label(c); return `${tableName(c.tableName)} ${t(`history.op.${OP[c.op]}`)}${l ? ` · ${l}` : ''}` }
const summary = (s: ChangeSet) => {
  const first = s.changes[0]
  if (!first) return t('history.noChange')
  const head = title(first)
  return s.changes.length > 1 ? t('history.andMore', { head, n: s.changes.length - 1 }) : head
}
/** Fields that differ (update), or every visible field (insert / delete). */
const fields = (c: Change) => {
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})].filter((k) => !HIDDEN.has(k)))
  return [...keys]
    .map((k) => ({ k, b: c.before?.[k], a: c.after?.[k] }))
    .filter((f) => c.op !== 'update' || JSON.stringify(f.b) !== JSON.stringify(f.a))
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

async function revert(s: ChangeSet) {
  if (!confirm(t('history.confirmRevert', { summary: summary(s) }))) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api('POST', `/api/changes/${s.id}/revert`)
    notice.value = t('history.reverted')
    await loadState() // the screens show what the server holds now
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('history.revertFailed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <PageHeader :title="t('history.title')" :desc="t('history.desc')" />
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <div class="panel">
      <ul class="list" :aria-label="t('history.listLabel')">
        <li v-for="s in sets" :key="s.id" class="chg" :data-set="s.id">
          <button type="button" class="ev-t" :aria-expanded="open === s.id" @click="open = open === s.id ? null : s.id">
            <span v-if="s.revertOf" class="pill mute">{{ t('history.revertOf') }}</span>
            <span v-if="s.actorKind === 'api_key'" class="pill mute">AI</span>
            {{ summary(s) }}
            <span class="at mono small muted">{{ fmt(s.at) }}</span>
          </button>
          <span v-if="s.revertedBy" class="pill mute">{{ t('history.revertedBy') }}</span>
          <button v-else type="button" class="btn" :disabled="busy" @click="revert(s)">{{ t('history.revertBtn') }}</button>
          <div v-if="open === s.id" class="chg-body">
            <div v-for="c in s.changes" :key="c.id" class="chg-row">
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
            </div>
          </div>
        </li>
      </ul>
      <p v-if="!sets.length && !busy" class="empty">{{ t('history.empty') }}</p>
      <div v-if="more && sets.length" class="btns" style="margin-top:12px"><button class="btn" type="button" :disabled="busy" @click="load(false)">{{ t('history.more') }}</button></div>
    </div>
  </section>
</template>

<style scoped>
.chg { grid-template-columns: minmax(0, 1fr) auto; }
.chg .ev-t { overflow-wrap: anywhere; }
.at { display: block; margin-top: 2px; }

.chg-body { grid-column: 1 / -1; display: grid; gap: 10px; padding: 8px 0 4px; }
.chg-row table { border-collapse: collapse; margin-top: 4px; }
.chg-row th { text-align: left; font-weight: 500; padding: 2px 12px 2px 0; color: var(--muted); }
.chg-row td { padding: 2px 8px 2px 0; word-break: break-all; }
</style>
