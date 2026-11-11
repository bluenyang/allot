<script setup lang="ts">
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

const TABLE: Record<string, string> = {
  settings: '설정', living: '생활비', subscription: '구독', plan_change: '요금 변경', phase: '구간',
  plan_event: '일정', check_item: '체크리스트', bank_account: '통장', debt: '부채',
  allocation_target: '분배 대상', phase_amount: '구간 금액', remainder_split: '나머지 배분',
}
const OP = { insert: '추가', update: '수정', delete: '삭제' } as const
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
    error.value = e instanceof ApiError ? e.message : '변경 내역을 불러오지 못했어요.'
  } finally {
    busy.value = false
  }
}
onMounted(() => load())
onActivated(() => load())

const fmt = (at: string) => new Date(at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
/** A subscription's name, also when it has been deleted since (taken from the loaded history). */
const subLabel = (id: string) => {
  if (store.subscriptions.some((x) => x.id === id)) return subName(id)
  for (const set of sets.value) for (const ch of set.changes) {
    const r = ch.tableName === 'subscription' && ch.rowKey.id === id ? ch.after ?? ch.before : null
    if (typeof r?.name === 'string') return r.name
  }
  return '삭제된 구독'
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
const summary = (s: ChangeSet) => {
  const first = s.changes[0]
  if (!first) return '변경 없음'
  const head = `${TABLE[first.tableName] ?? first.tableName} ${OP[first.op]} · ${label(first)}`
  return s.changes.length > 1 ? `${head} 외 ${s.changes.length - 1}건` : head
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
  if (!confirm(`이 변경을 되돌릴까요?\n${summary(s)}\n\n되돌린 내용도 새 변경으로 남아요.`)) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await api('POST', `/api/changes/${s.id}/revert`)
    notice.value = '되돌렸어요.'
    await loadState() // the screens show what the server holds now
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '되돌리지 못했어요.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section>
    <h1>변경 내역</h1>
    <p class="lede">저장 한 번이 변경 하나로 남아요. 되돌리면 반대 변경이 새로 저장돼요. 그 뒤에 같은 항목이 다시 바뀌었으면 되돌릴 수 없어요.</p>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">닫기</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <div class="panel">
      <ul class="list" aria-label="변경 목록">
        <li v-for="s in sets" :key="s.id" class="chg" :data-set="s.id">
          <button type="button" class="ev-t" :aria-expanded="open === s.id" @click="open = open === s.id ? null : s.id">
            <span v-if="s.revertOf" class="pill mute">되돌림</span>
            <span v-if="s.actorKind === 'api_key'" class="pill mute">AI</span>
            {{ summary(s) }}
            <span class="at mono small muted">{{ fmt(s.at) }}</span>
          </button>
          <span v-if="s.revertedBy" class="pill mute">되돌려짐</span>
          <button v-else type="button" class="btn" :disabled="busy" @click="revert(s)">되돌리기</button>
          <div v-if="open === s.id" class="chg-body">
            <div v-for="c in s.changes" :key="c.id" class="chg-row">
              <b class="small">{{ TABLE[c.tableName] ?? c.tableName }} {{ OP[c.op] }} · {{ label(c) }}</b>
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
      <p v-if="!sets.length && !busy" class="empty">아직 변경이 없어요.</p>
      <div v-if="more && sets.length" class="btns" style="margin-top:12px"><button class="btn" type="button" :disabled="busy" @click="load(false)">더 보기</button></div>
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
