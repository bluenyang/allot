<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import { computed, onActivated, onMounted, ref } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import SubTabs from '../components/SubTabs.vue'
import { ApiError, api } from '../lib/api'
import { lang, t, type MessageKey } from '../i18n'
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
const tabs = computed(() => [{ id: 'users', label: t('admin.tabUsers'), icon: 'account' }, { id: 'methods', label: t('admin.tabMethods'), icon: 'security' }, { id: 'keys', label: t('settingsAi.apiKey'), icon: 'list' }])
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
const STATUS = (u: User) => (u.banned ? t('admin.statusBanned') : u.status === 'pending' ? t('admin.statusPending') : t('admin.statusActive'))
const ADMISSION = (a: string) => (['seed', 'admin', 'approval', 'rule', 'bootstrap'].includes(a) ? t(`admin.admission.${a}` as MessageKey) : a)
const pending = computed(() => users.value.filter((u) => u.status === 'pending' && !u.banned))
const fmt = (at: string) => new Date(at).toLocaleDateString(lang.value === 'en' ? 'en-US' : 'ko-KR', { dateStyle: 'medium' })

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
    editError.value = e instanceof ApiError ? e.message : t('admin.failed')
  } finally {
    busy.value = false
  }
}
async function saveUser() {
  const e = edit.value
  if (!e) return
  if (!e.user) {
    if (!/^\S+@\S+\.\S+$/.test(e.email.trim())) return (editError.value = t('admin.checkEmail'))
    if (!e.name.trim()) return (editError.value = t('admin.needName'))
    if (e.password && e.password.length < 8) return (editError.value = t('admin.tempPwShort'))
    return act(() => api('POST', '/api/auth/admin/create-user', {
      email: e.email.trim(), name: e.name.trim(), role: e.role, ...(e.password ? { password: e.password } : {}),
    }), e.password ? t('admin.created') : t('admin.createdLink'))
  }
  const u = e.user
  await act(async () => {
    if (e.name.trim() && e.name.trim() !== u.name) await api('POST', '/api/auth/admin/update-user', { userId: u.id, data: { name: e.name.trim() } })
    if (e.role !== u.role) await api('POST', `/api/admin/users/${u.id}/role`, { role: e.role })
  }, t('settings.general.saved'))
}
const approve = (u: User) => act(() => api('POST', '/api/auth/admin/update-user', { userId: u.id, data: { status: 'active' } }), t('admin.approved', { email: u.email }), !!edit.value)
const ban = (u: User) => confirm(t('admin.confirmBan', { email: u.email }))
  && act(() => api('POST', `/api/admin/users/${u.id}/ban`, {}), t('admin.banned'), true)
const unban = (u: User) => act(() => api('POST', '/api/auth/admin/unban-user', { userId: u.id }), t('admin.unbanned'), true)
const endSessions = (u: User) => act(() => api('POST', '/api/auth/admin/revoke-user-sessions', { userId: u.id }), t('admin.sessionsEnded'), true)
function resetPassword(u: User) {
  const p = edit.value?.password ?? ''
  if (p.length < 8) return (editError.value = t('account.pwShort'))
  return act(() => api('POST', '/api/auth/admin/set-user-password', { userId: u.id, newPassword: p }), t('admin.pwReset'), true)
}
function remove(u: User) {
  if ((edit.value?.confirm ?? '').trim().toLowerCase() !== u.email.toLowerCase()) return (editError.value = t('admin.confirmEmailText'))
  return act(() => api('DELETE', `/api/admin/users/${u.id}`, { confirmEmail: edit.value!.confirm.trim() }), t('admin.deleted', { email: u.email }))
}

// ── login methods ──
const providers = ref<Provider[]>([])
interface ProvEdit { id: Provider['id']; enabled: boolean; signup: Provider['values']['signup']; name: string; clientId: string; discoveryUrl: string; scopes: string; groupsClaim: string; rules: Record<string, string>; secret: string; dropSecret: boolean }
const pedit = ref<ProvEdit | null>(null)
const peditError = ref('')
const TITLE = (id: string) => (id === 'password' ? t('auth.password') : ({ oidc: 'OIDC', github: 'GitHub', google: 'Google' } as Record<string, string>)[id] ?? id)
const SIGNUP_IDS = ['closed', 'approval', 'rules'] as const
const SIGNUP = (id: string) => t(`admin.signup.${id}` as MessageKey)
const RULE = (k: string) => (k === 'emails' ? t('admin.rule.emails') : k === 'domains' ? t('admin.rule.domains') : ({ groups: 'group', orgs: 'GitHub organization' } as Record<string, string>)[k] ?? k)
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
    say(t('admin.providerSaved', { name: TITLE(p.id) }))
    pedit.value = null
  } catch (err) {
    peditError.value = err instanceof ApiError ? err.message : t('admin.saveFailed')
  } finally {
    busy.value = false
  }
}

// ── API keys (spec 008 S-3): may a key have no expiry date ──
const keyPolicy = ref<KeyPolicy | null>(null)
async function toggleNoExpiry(e: Event) {
  const box = e.target as HTMLInputElement
  const next = box.checked
  if (!next && !confirm(t('admin.confirmOff'))) { box.checked = true; return }
  busy.value = true
  error.value = ''
  try {
    keyPolicy.value = await setKeyPolicy(next)
    say(next ? t('admin.noExpiryOn') : t('admin.noExpiryOff') + (keyPolicy.value.capped ? ` ${t('admin.capped', { n: keyPolicy.value.capped })}` : ''))
  } catch (err) {
    box.checked = !next
    fail(err, t('admin.saveFailed'))
  } finally {
    busy.value = false
  }
}

async function load() {
  try {
    meId.value = (await api<{ user: { id: string } }>('GET', '/api/me')).user.id
    await Promise.all([loadUsers(), loadProviders(), getKeyPolicy().then((p) => { keyPolicy.value = p })])
  } catch (e) {
    fail(e, t('admin.loadFailed'))
  }
}
onMounted(load)
onActivated(load)
</script>

<template>
  <section>
    <PageHeader :title="t('admin.title')" :desc="t('admin.desc')" />
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>
    <SubTabs v-model="tab" :tabs="tabs" />

    <template v-if="tab === 'users'">
      <div v-if="pending.length" class="panel warnbox">
        <h3 style="margin-top:0">{{ t('admin.pendingN', { n: pending.length }) }}</h3>
        <ul class="list">
          <li v-for="u in pending" :key="u.id"><span>{{ u.email }}</span><span class="small muted">{{ fmt(u.createdAt) }}</span>
            <button class="btn pri" type="button" :disabled="busy" @click="approve(u)">{{ t('admin.approve') }}</button></li>
        </ul>
      </div>
      <div class="btns" style="margin:0 0 12px"><button class="btn pri" type="button" @click="openUser()">{{ t('admin.newAccountBtn') }}</button></div>

      <EditSheet v-if="edit && !edit.user" :title="t('admin.newAccount')" :error="editError" :busy="busy" @save="saveUser" @cancel="edit = null">
        <div class="field"><label for="u-email">{{ t('login.email') }}</label><input id="u-email" v-model="edit.email" class="in" type="email" autocomplete="off"></div>
        <div class="field"><label for="u-name">{{ t('admin.name') }}</label><input id="u-name" v-model="edit.name" class="in"></div>
        <div class="field"><label for="u-role">{{ t('admin.role') }}</label><select id="u-role" v-model="edit.role" class="in"><option value="user">{{ t('shell.roleUser') }}</option><option value="admin">{{ t('shell.roleAdmin') }}</option></select></div>
        <div class="field"><label for="u-pw">{{ t('admin.tempPw') }}</label><input id="u-pw" v-model="edit.password" class="in" type="password" autocomplete="new-password"></div>
        <template #after><p class="small muted">{{ t('admin.tempPwNote') }}</p></template>
      </EditSheet>

      <div class="panel scroll-x">
        <table class="tbl">
          <thead><tr><th>{{ t('login.email') }}</th><th>{{ t('admin.name') }}</th><th>{{ t('admin.role') }}</th><th>{{ t('admin.status') }}</th><th>{{ t('admin.admissionCol') }}</th><th>{{ t('admin.createdCol') }}</th></tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="click" tabindex="0" @click="openUser(u)" @keydown.enter="openUser(u)">
              <td>{{ u.email }}<span v-if="u.id === meId" class="small muted"> {{ t('admin.me') }}</span></td><td>{{ u.name }}</td>
              <td>{{ u.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser') }}</td><td>{{ STATUS(u) }}</td>
              <td>{{ ADMISSION(u.admission) }}</td><td class="n">{{ fmt(u.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <EditSheet v-if="edit && edit.user" :title="edit.user.email" :error="editError" :busy="busy" @save="saveUser" @cancel="edit = null">
        <div class="field"><label for="ue-name">{{ t('admin.name') }}</label><input id="ue-name" v-model="edit.name" class="in"></div>
        <div class="field"><label for="ue-role">{{ t('admin.role') }}</label><select id="ue-role" v-model="edit.role" class="in" :disabled="edit.user.id === meId && edit.user.role === 'admin' && users.filter((x) => x.role === 'admin' && !x.banned).length <= 1"><option value="user">{{ t('shell.roleUser') }}</option><option value="admin">{{ t('shell.roleAdmin') }}</option></select></div>
        <template #after>
          <div class="acts">
            <button v-if="edit.user.status === 'pending'" class="btn pri" type="button" :disabled="busy" @click="approve(edit.user)">{{ t('admin.approve') }}</button>
            <template v-if="edit.user.id !== meId">
              <button v-if="!edit.user.banned" class="btn" type="button" :disabled="busy" @click="ban(edit.user)">{{ t('admin.ban') }}</button>
              <button v-else class="btn" type="button" :disabled="busy" @click="unban(edit.user)">{{ t('admin.unban') }}</button>
            </template>
            <button class="btn" type="button" :disabled="busy" @click="endSessions(edit.user)">{{ t('admin.endSessions') }}</button>
          </div>
          <div class="field"><label for="ue-pw">{{ t('admin.newPw') }}</label><input id="ue-pw" v-model="edit.password" class="in" type="password" autocomplete="new-password"></div>
          <div class="acts"><button class="btn" type="button" :disabled="busy" @click="resetPassword(edit.user)">{{ t('admin.resetPw') }}</button></div>
          <template v-if="edit.user.id !== meId">
            <div class="field"><label for="ue-del">{{ t('admin.deleteLabel') }}</label><input id="ue-del" v-model="edit.confirm" class="in" autocomplete="off"></div>
            <div class="acts"><button class="btn danger" type="button" :disabled="busy" @click="remove(edit.user)">{{ t('admin.deleteBtn') }}</button></div>
            <p class="small muted">{{ t('admin.deleteNote') }}</p>
          </template>
        </template>
      </EditSheet>
    </template>

    <template v-else-if="tab === 'keys'">
      <div class="panel">
        <h3>{{ t('admin.noExpiryTitle') }}</h3>
        <p class="small muted">{{ t('admin.noExpiryDesc') }}</p>
        <label v-if="keyPolicy" class="sw"><input type="checkbox" :checked="keyPolicy.noExpiry" :disabled="keyPolicy.locked || busy" @change="toggleNoExpiry"> {{ t('admin.noExpiryLabel') }}</label>
        <i18n-t v-if="keyPolicy?.locked" keypath="admin.envLocked" tag="p" class="small muted"><template #env><span class="mono">ALLOT_API_KEY_NO_EXPIRY</span></template></i18n-t>
        <p v-else class="small muted">{{ t('admin.noExpiryNote') }}</p>
      </div>
    </template>

    <template v-else>
      <div class="cards">
        <div v-for="p in providers" :key="p.id" class="panel click" tabindex="0" @click="openProvider(p)" @keydown.enter="openProvider(p)">
          <h3 style="margin-top:0">{{ TITLE(p.id) }}<span v-if="p.id === 'oidc' && p.values.name !== 'OIDC'" class="small muted"> · {{ p.values.name }}</span></h3>
          <p class="small">{{ p.usable ? t('common.on') : p.values.enabled ? t('admin.onUnusable') : t('common.off') }}<span v-if="p.id !== 'password'"> · {{ t('admin.signupIs', { how: SIGNUP(p.values.signup) }) }}</span></p>
          <p v-if="p.problem" class="small" style="color:var(--neg-text)">{{ p.problem }}</p>
          <p v-if="Object.values(p.source).includes('env')" class="small muted">{{ t('admin.someEnv') }}</p>
        </div>
      </div>

      <EditSheet v-if="pedit && current()" :title="t('admin.providerSettings', { name: TITLE(pedit.id) })" :error="peditError" :busy="busy" @save="saveProvider" @cancel="pedit = null">
        <div class="field"><label for="p-on">{{ t('admin.use') }}</label>
          <select id="p-on" v-model="pedit.enabled" class="in" :disabled="locked(current()!, 'enabled')"><option :value="true">{{ t('admin.turnOn') }}</option><option :value="false">{{ t('admin.turnOff') }}</option></select></div>
        <template v-if="pedit.id !== 'password'">
          <div class="field"><label for="p-signup">{{ t('admin.newUsers') }}</label>
            <select id="p-signup" v-model="pedit.signup" class="in" :disabled="locked(current()!, 'signup')">
              <option v-for="k in SIGNUP_IDS" :key="k" :value="k">{{ SIGNUP(k) }}</option></select></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-name">{{ t('admin.buttonName') }}</label><input id="p-name" v-model="pedit.name" class="in" :disabled="locked(current()!, 'name')"></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-disc">discovery URL</label><input id="p-disc" v-model="pedit.discoveryUrl" class="in" placeholder="https://…/.well-known/openid-configuration" :disabled="locked(current()!, 'discoveryUrl')"></div>
          <div class="field"><label for="p-cid">client id</label><input id="p-cid" v-model="pedit.clientId" class="in" autocomplete="off" :disabled="locked(current()!, 'clientId')"></div>
          <div class="field"><label for="p-sec">client secret {{ current()!.secretSet ? t('admin.secretSaved') : t('admin.secretNone') }}</label>
            <input id="p-sec" v-model="pedit.secret" class="in" type="password" autocomplete="new-password" :disabled="locked(current()!, 'clientSecret')"></div>
          <label v-if="current()!.secretSet && !locked(current()!, 'clientSecret')" class="small"><input v-model="pedit.dropSecret" type="checkbox"> {{ t('admin.dropSecret') }}</label>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-scopes">{{ t('admin.scopes') }}</label><input id="p-scopes" v-model="pedit.scopes" class="in" :disabled="locked(current()!, 'scopes')"></div>
          <div v-if="pedit.id === 'oidc'" class="field"><label for="p-gc">{{ t('admin.groupClaim') }}</label><input id="p-gc" v-model="pedit.groupsClaim" class="in" :disabled="locked(current()!, 'groupsClaim')"></div>
          <div v-for="k in current()!.ruleKinds" :key="k" class="field">
            <label :for="'p-r-' + k">{{ t('admin.ruleLabel', { kind: RULE(k) }) }}</label>
            <textarea :id="'p-r-' + k" v-model="pedit.rules[k]" class="in" rows="3" :disabled="locked(current()!, `rules.${k}`)" />
          </div>
        </template>
        <template #after>
          <p v-if="Object.values(current()!.source).includes('env')" class="small muted">{{ t('admin.greyEnv') }}</p>
          <p v-if="pedit.id === 'password'" class="small muted">{{ t('admin.pwOffNote') }}</p>
          <p v-else class="small muted">{{ t('admin.callback') }} <span class="mono">{{ origin }}/api/auth/callback/{{ pedit.id }}</span></p>
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
