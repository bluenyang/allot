<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import { computed, onActivated, onMounted, ref } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import SubTabs from '../components/SubTabs.vue'
import { ApiError, api } from '../lib/api'
import { getKeyPolicy, setKeyPolicy, type KeyPolicy } from '../lib/keys'

// Admin (spec 006 S-3, S-8): accounts and login methods. Account details only; nobody's
// financial data is shown or reachable here. The server checks every action again.
interface User {
  id: string; email: string; name: string; role: 'admin' | 'user'; status: 'active' | 'pending'
  admission: string; banned: boolean; createdAt: string
}
type Field = 'enabled' | 'signup' | 'name' | 'clientId' | 'clientSecret' | 'discoveryUrl' | 'scopes' | 'groupsClaim' | `rules.${string}`
interface Provider {
  id: 'password' | 'oidc' | 'github' | 'google'
  values: { enabled: boolean; signup: 'closed' | 'approval' | 'rules'; rules: Record<string, string[]>; name: string; clientId: string; discoveryUrl: string; scopes: string[]; groupsClaim: string }
  secretSet: boolean
  source: Partial<Record<Field, 'default' | 'db' | 'env'>>
  problem: string | null
  usable: boolean
  ruleKinds: string[]
}

const origin = window.location.origin
const tab = ref('users')
const tabs = [{ id: 'users', label: '사용자', icon: 'account' }, { id: 'methods', label: '로그인 방식', icon: 'security' }, { id: 'keys', label: 'API 키', icon: 'list' }]
const error = ref('')
const notice = ref('')
const busy = ref(false)
const fail = (e: unknown, fallback: string) => { error.value = e instanceof ApiError ? e.message : fallback }
const say = (m: string) => { notice.value = m; error.value = '' }

// ── users ──
const users = ref<User[]>([])
const meId = ref('')
async function loadUsers() {
  const r = await api<{ users: User[] }>('GET', '/api/auth/admin/list-users?limit=500&sortBy=createdAt&sortDirection=asc')
  users.value = r.users
}
const STATUS = (u: User) => (u.banned ? '정지' : u.status === 'pending' ? '승인 대기' : '활성')
const ADMISSION: Record<string, string> = { seed: '처음 계정', admin: '관리자가 만듦', approval: '승인', rule: '규칙', bootstrap: '초기 관리자' }
const pending = computed(() => users.value.filter((u) => u.status === 'pending' && !u.banned))
const fmt = (at: string) => new Date(at).toLocaleDateString('ko-KR', { dateStyle: 'medium' })

interface UserEdit { user: User | null; email: string; name: string; role: 'admin' | 'user'; password: string; confirm: string }
const edit = ref<UserEdit | null>(null)
const editError = ref('')
function openUser(u?: User) {
  editError.value = ''
  edit.value = u ? { user: u, email: u.email, name: u.name, role: u.role, password: '', confirm: '' }
    : { user: null, email: '', name: '', role: 'user', password: '', confirm: '' }
}
async function act(fn: () => Promise<unknown>, done: string, keepOpen = false) {
  busy.value = true
  editError.value = ''
  try {
    await fn()
    await loadUsers()
    say(done)
    if (!keepOpen) edit.value = null
    else if (edit.value?.user) edit.value.user = users.value.find((x) => x.id === edit.value!.user!.id) ?? null
  } catch (e) {
    editError.value = e instanceof ApiError ? e.message : '하지 못했어요.'
  } finally {
    busy.value = false
  }
}
async function saveUser() {
  const e = edit.value
  if (!e) return
  if (!e.user) {
    if (!/^\S+@\S+\.\S+$/.test(e.email.trim())) return (editError.value = '이메일을 확인해 주세요.')
    if (!e.name.trim()) return (editError.value = '이름을 넣어 주세요.')
    if (e.password && e.password.length < 8) return (editError.value = '임시 비밀번호는 8자 이상이어야 해요.')
    return act(() => api('POST', '/api/auth/admin/create-user', {
      email: e.email.trim(), name: e.name.trim(), role: e.role, ...(e.password ? { password: e.password } : {}),
    }), e.password ? '계정을 만들었어요.' : '계정을 만들었어요. 그 이메일로 처음 외부 로그인하면 연결돼요.')
  }
  const u = e.user
  await act(async () => {
    if (e.name.trim() && e.name.trim() !== u.name) await api('POST', '/api/auth/admin/update-user', { userId: u.id, data: { name: e.name.trim() } })
    if (e.role !== u.role) await api('POST', `/api/admin/users/${u.id}/role`, { role: e.role })
  }, '저장했어요.')
}
const approve = (u: User) => act(() => api('POST', '/api/auth/admin/update-user', { userId: u.id, data: { status: 'active' } }), `${u.email}을(를) 승인했어요.`, !!edit.value)
const ban = (u: User) => confirm(`${u.email}을(를) 정지할까요? 로그인이 모두 끊겨요.`)
  && act(() => api('POST', `/api/admin/users/${u.id}/ban`, {}), '정지했어요.', true)
const unban = (u: User) => act(() => api('POST', '/api/auth/admin/unban-user', { userId: u.id }), '정지를 풀었어요.', true)
const endSessions = (u: User) => act(() => api('POST', '/api/auth/admin/revoke-user-sessions', { userId: u.id }), '로그인을 모두 끊었어요.', true)
function resetPassword(u: User) {
  const p = edit.value?.password ?? ''
  if (p.length < 8) return (editError.value = '새 비밀번호는 8자 이상이어야 해요.')
  return act(() => api('POST', '/api/auth/admin/set-user-password', { userId: u.id, newPassword: p }), '비밀번호를 바꿨어요. 그 사용자의 로그인은 끊었어요.', true)
}
function remove(u: User) {
  if ((edit.value?.confirm ?? '').trim().toLowerCase() !== u.email.toLowerCase()) return (editError.value = '확인란에 그 사용자의 이메일을 그대로 넣어 주세요.')
  return act(() => api('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: edit.value!.confirm.trim() }), `${u.email} 계정과 데이터를 모두 지웠어요.`)
}

// ── login methods ──
const providers = ref<Provider[]>([])
interface ProvEdit { id: Provider['id']; enabled: boolean; signup: Provider['values']['signup']; name: string; clientId: string; discoveryUrl: string; scopes: string; groupsClaim: string; rules: Record<string, string>; secret: string; dropSecret: boolean }
const pedit = ref<ProvEdit | null>(null)
const peditError = ref('')
const TITLE: Record<string, string> = { password: '비밀번호', oidc: 'OIDC', github: 'GitHub', google: 'Google' }
const SIGNUP = { closed: '관리자가 만든 계정만', approval: '승인 대기', rules: '규칙에 맞으면 바로' }
const RULE: Record<string, string> = { emails: '이메일', groups: 'group', orgs: 'GitHub organization', domains: 'Google 도메인' }
async function loadProviders() {
  providers.value = (await api<{ providers: Provider[] }>('GET', '/api/admin/providers')).providers
}
const locked = (p: Provider, f: Field) => p.source[f] === 'env'
const current = () => providers.value.find((p) => p.id === pedit.value?.id)
function openProvider(p: Provider) {
  peditError.value = ''
  pedit.value = {
    id: p.id, enabled: p.values.enabled, signup: p.values.signup, name: p.values.name, clientId: p.values.clientId,
    discoveryUrl: p.values.discoveryUrl, scopes: p.values.scopes.join(' '), groupsClaim: p.values.groupsClaim,
    rules: Object.fromEntries(p.ruleKinds.map((k) => [k, (p.values.rules[k] ?? []).join('\n')])), secret: '', dropSecret: false,
  }
}
const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)
async function saveProvider() {
  const e = pedit.value
  const p = current()
  if (!e || !p) return
  // Send only what changed and what env does not set.
  const body: Record<string, unknown> = {}
  const can = (f: Field) => !locked(p, f)
  if (can('enabled') && e.enabled !== p.values.enabled) body.enabled = e.enabled
  if (p.id !== 'password') {
    if (can('signup') && e.signup !== p.values.signup) body.signup = e.signup
    const rules: Record<string, string[]> = {}
    for (const k of p.ruleKinds) {
      const next = lines(e.rules[k] ?? '')
      if (can(`rules.${k}`) && JSON.stringify(next) !== JSON.stringify(p.values.rules[k] ?? [])) rules[k] = next
    }
    if (Object.keys(rules).length) body.rules = rules
    const options: Record<string, unknown> = {}
    if (can('clientId') && e.clientId.trim() && e.clientId.trim() !== p.values.clientId) options.clientId = e.clientId.trim()
    if (p.id === 'oidc') {
      if (can('name') && e.name.trim() && e.name.trim() !== p.values.name) options.name = e.name.trim()
      if (can('discoveryUrl') && e.discoveryUrl.trim() && e.discoveryUrl.trim() !== p.values.discoveryUrl) options.discoveryUrl = e.discoveryUrl.trim()
      const scopes = e.scopes.split(/\s+/).filter(Boolean)
      if (can('scopes') && scopes.length && scopes.join(' ') !== p.values.scopes.join(' ')) options.scopes = scopes
      if (can('groupsClaim') && e.groupsClaim.trim() && e.groupsClaim.trim() !== p.values.groupsClaim) options.groupsClaim = e.groupsClaim.trim()
    }
    if (Object.keys(options).length) body.options = options
    if (can('clientSecret') && e.secret) body.clientSecret = e.secret
    else if (can('clientSecret') && e.dropSecret) body.clientSecret = null
  }
  if (!Object.keys(body).length) return (pedit.value = null)
  busy.value = true
  peditError.value = ''
  try {
    await api('PUT', `/api/admin/providers/${p.id}`, body)
    await loadProviders()
    say(`${TITLE[p.id]} 설정을 저장했어요. 바로 적용돼요.`)
    pedit.value = null
  } catch (err) {
    peditError.value = err instanceof ApiError ? err.message : '저장하지 못했어요.'
  } finally {
    busy.value = false
  }
}

// ── API keys (spec 008 S-3): may a key have no expiry date ──
const keyPolicy = ref<KeyPolicy | null>(null)
async function toggleNoExpiry(e: Event) {
  const box = e.target as HTMLInputElement
  const next = box.checked
  if (!next && !confirm('끄면 만료 없는 키는 지금부터 365일 뒤에 만료돼요. 끌까요?')) { box.checked = true; return }
  busy.value = true
  error.value = ''
  try {
    keyPolicy.value = await setKeyPolicy(next)
    say(next ? '만료 없는 키를 허용해요.' : `만료 없는 키를 막았어요.${keyPolicy.value.capped ? ` 만료 없던 키 ${keyPolicy.value.capped}개는 365일 뒤 만료로 바꿨어요.` : ''}`)
  } catch (err) {
    box.checked = !next
    fail(err, '저장하지 못했어요.')
  } finally {
    busy.value = false
  }
}

async function load() {
  try {
    meId.value = (await api<{ user: { id: string } }>('GET', '/api/me')).user.id
    await Promise.all([loadUsers(), loadProviders(), getKeyPolicy().then((p) => { keyPolicy.value = p })])
  } catch (e) {
    fail(e, '관리 정보를 불러오지 못했어요.')
  }
}
onMounted(load)
onActivated(load)
</script>

<template>
  <section>
    <PageHeader title="관리" desc="계정과 로그인 방식을 관리해요. 다른 사용자의 금융 데이터는 여기서 보이지 않아요." />
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">닫기</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>
    <SubTabs v-model="tab" :tabs="tabs" />

    <template v-if="tab === 'users'">
      <div v-if="pending.length" class="panel warnbox">
        <h3 style="margin-top:0">승인 대기 {{ pending.length }}명</h3>
        <ul class="list">
          <li v-for="u in pending" :key="u.id"><span>{{ u.email }}</span><span class="small muted">{{ fmt(u.createdAt) }}</span>
            <button class="btn pri" type="button" :disabled="busy" @click="approve(u)">승인</button></li>
        </ul>
      </div>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="openUser()">+ 계정 만들기</button></div>

      <EditSheet v-if="edit && !edit.user" title="새 계정" :error="editError" :busy="busy" @save="saveUser" @cancel="edit = null">
        <div class="field"><label for="u-email">이메일</label><input id="u-email" v-model="edit.email" class="in" type="email" autocomplete="off"></div>
        <div class="field"><label for="u-name">이름</label><input id="u-name" v-model="edit.name" class="in"></div>
        <div class="field"><label for="u-role">역할</label><select id="u-role" v-model="edit.role" class="in"><option value="user">사용자</option><option value="admin">관리자</option></select></div>
        <div class="field"><label for="u-pw">임시 비밀번호 (선택)</label><input id="u-pw" v-model="edit.password" class="in" type="password" autocomplete="new-password"></div>
        <template #after><p class="small muted">비워 두면 비밀번호 없이 만들어요. 그 이메일로 처음 외부 로그인할 때 이 계정에 연결돼요.</p></template>
      </EditSheet>

      <div class="panel scroll-x">
        <table class="tbl">
          <thead><tr><th>이메일</th><th>이름</th><th>역할</th><th>상태</th><th>들어온 방식</th><th>만든 날</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="click" tabindex="0" @click="openUser(u)" @keydown.enter="openUser(u)">
              <td>{{ u.email }}<span v-if="u.id === meId" class="small muted"> (나)</span></td><td>{{ u.name }}</td>
              <td>{{ u.role === 'admin' ? '관리자' : '사용자' }}</td><td>{{ STATUS(u) }}</td>
              <td>{{ ADMISSION[u.admission] ?? u.admission }}</td><td class="n">{{ fmt(u.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <EditSheet v-if="edit && edit.user" :title="edit.user.email" :error="editError" :busy="busy" @save="saveUser" @cancel="edit = null">
        <div class="field"><label for="ue-name">이름</label><input id="ue-name" v-model="edit.name" class="in"></div>
        <div class="field"><label for="ue-role">역할</label><select id="ue-role" v-model="edit.role" class="in" :disabled="edit.user.id === meId && edit.user.role === 'admin' && users.filter((x) => x.role === 'admin' && !x.banned).length <= 1"><option value="user">사용자</option><option value="admin">관리자</option></select></div>
        <template #after>
          <div class="acts">
            <button v-if="edit.user.status === 'pending'" class="btn pri" type="button" :disabled="busy" @click="approve(edit.user)">승인</button>
            <template v-if="edit.user.id !== meId">
              <button v-if="!edit.user.banned" class="btn" type="button" :disabled="busy" @click="ban(edit.user)">정지</button>
              <button v-else class="btn" type="button" :disabled="busy" @click="unban(edit.user)">정지 풀기</button>
            </template>
            <button class="btn" type="button" :disabled="busy" @click="endSessions(edit.user)">로그인 모두 끊기</button>
          </div>
          <div class="field"><label for="ue-pw">새 비밀번호</label><input id="ue-pw" v-model="edit.password" class="in" type="password" autocomplete="new-password"></div>
          <div class="acts"><button class="btn" type="button" :disabled="busy" @click="resetPassword(edit.user)">비밀번호 재설정</button></div>
          <template v-if="edit.user.id !== meId">
            <div class="field"><label for="ue-del">완전 삭제 — 확인하려면 이메일을 그대로 입력</label><input id="ue-del" v-model="edit.confirm" class="in" autocomplete="off"></div>
            <div class="acts"><button class="btn danger" type="button" :disabled="busy" @click="remove(edit.user)">계정과 데이터 완전 삭제</button></div>
            <p class="small muted">그 사용자의 모든 데이터·변경 내역·로그인이 지워지고 되돌릴 수 없어요.</p>
          </template>
        </template>
      </EditSheet>
    </template>

    <template v-else-if="tab === 'keys'">
      <div class="panel">
        <h3>만료 없는 API 키</h3>
        <p class="small muted">켜면 사용자가 만료 없는 키를 만들 수 있어요. 끄면 키는 1~365일 안에 만료돼요(기본 90일).</p>
        <label v-if="keyPolicy" class="sw"><input type="checkbox" :checked="keyPolicy.noExpiry" :disabled="keyPolicy.locked || busy" @change="toggleNoExpiry"> 만료 없는 키 허용</label>
        <p v-if="keyPolicy?.locked" class="small muted">env(<span class="mono">ALLOT_API_KEY_NO_EXPIRY</span>)로 정해져 있어 화면에서 바꿀 수 없어요.</p>
        <p v-else class="small muted">끄는 순간, 이미 있는 만료 없는 키는 지금부터 365일 뒤에 만료돼요. 사용자들의 키는 여기서 보이지 않아요.</p>
      </div>
    </template>

    <template v-else>
      <div class="cards">
        <div v-for="p in providers" :key="p.id" class="panel click" tabindex="0" @click="openProvider(p)" @keydown.enter="openProvider(p)">
          <h3 style="margin-top:0">{{ TITLE[p.id] }}<span v-if="p.id === 'oidc' && p.values.name !== 'OIDC'" class="small muted"> · {{ p.values.name }}</span></h3>
          <p class="small">{{ p.usable ? '켜짐' : p.values.enabled ? '켜졌지만 쓸 수 없음' : '꺼짐' }}<span v-if="p.id !== 'password'"> · 가입: {{ SIGNUP[p.values.signup] }}</span></p>
          <p v-if="p.problem" class="small" style="color:var(--neg-text)">{{ p.problem }}</p>
          <p v-if="Object.values(p.source).includes('env')" class="small muted">일부 항목은 env로 정해져 있어요.</p>
        </div>
      </div>

      <EditSheet v-if="pedit && current()" :title="TITLE[pedit.id] + ' 설정'" :error="peditError" :busy="busy" @save="saveProvider" @cancel="pedit = null">
        <div class="field"><label for="p-on">사용</label>
          <select id="p-on" v-model="pedit.enabled" class="in" :disabled="locked(current()!, 'enabled')"><option :value="true">켜기</option><option :value="false">끄기</option></select></div>
        <template v-if="pedit.id !== 'password'">
          <div class="field"><label for="p-signup">새 사용자</label>
            <select id="p-signup" v-model="pedit.signup" class="in" :disabled="locked(current()!, 'signup')">
              <option v-for="(label, k) in SIGNUP" :key="k" :value="k">{{ label }}</option></select></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-name">버튼 이름</label><input id="p-name" v-model="pedit.name" class="in" :disabled="locked(current()!, 'name')"></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-disc">discovery URL</label><input id="p-disc" v-model="pedit.discoveryUrl" class="in" placeholder="https://…/.well-known/openid-configuration" :disabled="locked(current()!, 'discoveryUrl')"></div>
          <div class="field"><label for="p-cid">client id</label><input id="p-cid" v-model="pedit.clientId" class="in" autocomplete="off" :disabled="locked(current()!, 'clientId')"></div>
          <div class="field"><label for="p-sec">client secret {{ current()!.secretSet ? '(저장됨 · 바꿀 때만 입력)' : '(없음)' }}</label>
            <input id="p-sec" v-model="pedit.secret" class="in" type="password" autocomplete="new-password" :disabled="locked(current()!, 'clientSecret')"></div>
          <label v-if="current()!.secretSet && !locked(current()!, 'clientSecret')" class="small"><input v-model="pedit.dropSecret" type="checkbox"> 저장된 secret 지우기</label>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-scopes">scope (공백으로 구분)</label><input id="p-scopes" v-model="pedit.scopes" class="in" :disabled="locked(current()!, 'scopes')"></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-gc">group 클레임 이름</label><input id="p-gc" v-model="pedit.groupsClaim" class="in" :disabled="locked(current()!, 'groupsClaim')"></div>
          <div v-for="k in current()!.ruleKinds" :key="k" class="field">
            <label :for="'p-r-' + k">규칙: {{ RULE[k] }} (한 줄에 하나)</label>
            <textarea :id="'p-r-' + k" v-model="pedit.rules[k]" class="in" rows="3" :disabled="locked(current()!, `rules.${k}`)" />
          </div>
        </template>
        <template #after>
          <p v-if="Object.values(current()!.source).includes('env')" class="small muted">회색 항목은 env로 정해져 있어 화면에서 바꿀 수 없어요.</p>
          <p v-if="pedit.id === 'password'" class="small muted">관리자 계정에 다른 로그인 방식이 연결되어 있어야 끌 수 있어요.</p>
          <p v-else class="small muted">콜백 주소: <span class="mono">{{ origin }}/api/auth/callback/{{ pedit.id }}</span></p>
        </template>
      </EditSheet>
    </template>
  </section>
</template>

<style scoped>
.panel{margin-bottom:14px}
.list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.list li{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.list li .btn{margin-left:auto}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th,.tbl td{text-align:left;padding:var(--row-pad) 12px;border-bottom:1px solid var(--divider)}
.tbl th{font-weight:500;color:var(--subtle);font-size:12px;background:var(--surface-2);border-bottom-color:var(--border)}
.click{cursor:pointer}
.tbl tr.click:hover td{background:var(--surface-2)}
.scroll-x{overflow-x:auto}
.acts{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.sw{display:flex;gap:8px;align-items:center;margin:12px 0}
.warnbox{border-color:var(--accent-line);background:var(--accent-soft)}
.warnbox h3{color:var(--accent-text)}
@media (max-width:640px){.tbl th:nth-child(2),.tbl td:nth-child(2),.tbl th:nth-child(5),.tbl td:nth-child(5){display:none}}
</style>
