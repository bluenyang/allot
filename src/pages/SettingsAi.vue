<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import { ApiError } from '../lib/api'
import { createKey, listKeys, revokeKey, type KeyItem } from '../lib/keys'

// 설정 › AI·연동 (spec 008 S-4): API keys for the read-only MCP endpoint, and how to connect.
// A key's text is shown once, in the box after it is made; the server keeps only its hash.
const keys = ref<KeyItem[]>([])
const noExpiry = ref(false)
const max = ref(10)
const loaded = ref(false)
const error = ref('')
const notice = ref('')
const busy = ref(false)

async function load() {
  try {
    const r = await listKeys()
    keys.value = r.keys
    noExpiry.value = r.policy.noExpiry
    max.value = r.max
    loaded.value = true
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '키 목록을 불러오지 못했어요.'
  }
}
onMounted(load)
onActivated(load)
// The page is kept alive when left: a key shown once must not stay in memory for the next visit.
onDeactivated(() => { fresh.value = null })

// ── make a key ──
const DAYS = [30, 90, 180, 365]
interface Draft { name: string; expires: string }
const draft = ref<Draft | null>(null)
const draftError = ref('')
const open = () => { draft.value = { name: '', expires: '90' }; draftError.value = '' }
const full = computed(() => keys.value.length >= max.value)
/** Shown once after a key is made; leaving the page or closing the box forgets it. */
const fresh = ref<{ key: string; name: string } | null>(null)

async function make() {
  const d = draft.value
  if (!d) return
  const name = d.name.trim()
  if (!name) return (draftError.value = '키 이름을 적어 주세요.')
  if (name.length > 32) return (draftError.value = '키 이름은 32자까지예요.')
  busy.value = true
  draftError.value = ''
  try {
    const r = await createKey(name, d.expires === 'none' ? null : Number(d.expires))
    fresh.value = { key: r.key, name: r.item.name }
    notice.value = ''
    draft.value = null
    await load()
  } catch (e) {
    draftError.value = e instanceof ApiError ? e.message : '키를 만들지 못했어요.'
  } finally {
    busy.value = false
  }
}

async function revoke(k: KeyItem) {
  if (!confirm(`'${k.name}' 키를 폐기할까요? 이 키로 연결한 앱은 바로 연결이 끊겨요.`)) return
  error.value = ''
  busy.value = true
  try {
    await revokeKey(k.id)
    notice.value = `'${k.name}' 키를 폐기했어요.`
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : '폐기하지 못했어요.'
  } finally {
    busy.value = false
  }
}

// ── copy ──
/** The clipboard API needs a secure page; a LAN address over http is not one, so fall back to selecting. */
async function copy(text: string, what: string) {
  error.value = ''
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    t.remove()
    if (!ok) return (error.value = '복사하지 못했어요. 직접 선택해서 복사해 주세요.')
  }
  notice.value = `${what}을(를) 복사했어요.`
}

// ── how to connect ──
const url = `${window.location.origin}/api/mcp`
const command = `claude mcp add --transport http allot ${url} --header "Authorization: Bearer <키>"`

const when = (at: string | null) => (at ? new Date(at).toLocaleDateString('ko-KR', { dateStyle: 'medium' }) : '')
const used = (at: string | null) => (at ? new Date(at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '아직 안 씀')
const scope = (k: KeyItem) => ((k.permissions.mcp ?? []).includes('write') ? '읽기·쓰기' : '읽기')
</script>

<template>
  <section>
    <p class="lede">AI 클라이언트(Claude Code 등)가 내 데이터를 읽을 수 있게 API 키를 만들어요. 키는 읽기만 되고, 이 서버의 MCP 주소에서만 쓸 수 있어요.</p>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">닫기</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <div v-if="fresh" class="panel fresh" role="status" aria-label="새 API 키">
      <h3>'{{ fresh.name }}' 키를 만들었어요</h3>
      <p class="small">지금만 볼 수 있어요. 이 창을 닫으면 다시 볼 수 없으니 안전한 곳에 복사해 두세요.</p>
      <div class="keybox">
        <input class="in mono" readonly :value="fresh.key" aria-label="API 키" @focus="($event.target as HTMLInputElement).select()">
        <button class="btn pri" type="button" @click="copy(fresh.key, '키')">복사</button>
      </div>
      <div class="btns"><button class="btn" type="button" @click="fresh = null">닫기</button></div>
    </div>

    <div class="panel">
      <h3>API 키</h3>
      <div class="btns head">
        <button class="btn pri" type="button" :disabled="full" @click="open()">+ 키 만들기</button>
        <span class="small muted">{{ keys.length }} / {{ max }}</span>
      </div>

      <EditSheet v-if="draft" title="새 API 키" :error="draftError" :busy="busy" @save="make" @cancel="draft = null">
        <div class="field"><label for="k-name">이름 (이 키를 쓰는 곳)</label><input id="k-name" v-model="draft.name" class="in" maxlength="32" autocomplete="off" placeholder="예: 노트북 Claude Code"></div>
        <div class="field"><label for="k-exp">만료</label>
          <select id="k-exp" v-model="draft.expires" class="in">
            <option v-for="d in DAYS" :key="d" :value="String(d)">{{ d }}일 뒤</option>
            <option v-if="noExpiry" value="none">만료 없음</option>
          </select>
        </div>
        <div class="field"><label>범위</label><p class="small" style="margin:0">읽기 전용 — 내 데이터를 읽기만 하고 바꾸지 못해요.</p></div>
        <template #after>
          <p v-if="!noExpiry" class="small muted">이 서버는 만료 없는 키를 허용하지 않아요. 키는 최대 365일 쓸 수 있어요.</p>
          <p class="small muted">만든 뒤 키 값을 한 번만 보여 줘요.</p>
        </template>
      </EditSheet>

      <p v-if="loaded && !keys.length" class="muted empty">아직 만든 키가 없어요.</p>
      <div v-else-if="keys.length" class="scroll-x">
        <table class="tbl">
          <thead><tr><th>이름</th><th>키</th><th>범위</th><th>만든 날</th><th>만료</th><th>마지막 사용</th><th><span class="sr">폐기</span></th></tr></thead>
          <tbody>
            <tr v-for="k in keys" :key="k.id">
              <td>{{ k.name }}</td>
              <td class="mono">{{ k.start }}…</td>
              <td>{{ scope(k) }}</td>
              <td class="n">{{ when(k.createdAt) }}</td>
              <td class="n">{{ k.expiresAt ? when(k.expiresAt) : '없음' }}</td>
              <td class="n">{{ used(k.lastUsedAt) }}</td>
              <td><button class="btn" type="button" :disabled="busy" :aria-label="`${k.name} 키 폐기`" @click="revoke(k)">폐기</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>연결 방법</h3>
      <p class="small">MCP 주소 <span class="mono url">{{ url }}</span> <button class="btn" type="button" @click="copy(url, '주소')">복사</button></p>
      <p class="small">Claude Code에서는 이렇게 추가해요. <span class="mono">&lt;키&gt;</span> 자리에 위에서 만든 키를 넣어요.</p>
      <div class="cmd"><code class="mono">{{ command }}</code><button class="btn" type="button" @click="copy(command, '명령')">복사</button></div>
      <p class="small muted">키는 이 주소에서만 통하고 다른 API에는 쓸 수 없어요. 폐기하면 바로 쓸 수 없게 돼요.</p>
      <p class="small muted">claude.ai의 원격 커넥터와 휴대폰 앱은 OAuth 로그인이 필요해서 0.1.10에서 지원할 예정이에요.</p>
    </div>
  </section>
</template>

<style scoped>
.panel{margin-bottom:14px}
.head{margin:0 0 12px;margin-top:0}
.empty{margin:8px 0 0}
.fresh{border-color:var(--accent-line);background:var(--accent-soft)}
.fresh h3{color:var(--accent-text)}
.keybox{display:flex;gap:8px;align-items:center;margin:10px 0}
.keybox .in{flex:1;min-width:0}
.cmd{display:flex;gap:8px;align-items:center;margin:8px 0 12px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--r-ctl)}
.cmd code{flex:1;min-width:0;overflow-wrap:anywhere;font-size:12px}
.url{overflow-wrap:anywhere}
.scroll-x{overflow-x:auto}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th,.tbl td{text-align:left;padding:var(--row-pad) 12px;border-bottom:1px solid var(--divider);white-space:nowrap}
.tbl th{font-weight:500;color:var(--subtle);font-size:12px;background:var(--surface-2);border-bottom-color:var(--border)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (max-width:640px){.tbl th:nth-child(3),.tbl td:nth-child(3),.tbl th:nth-child(4),.tbl td:nth-child(4){display:none}}
</style>
