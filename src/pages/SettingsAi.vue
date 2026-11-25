<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import Soon from '../components/Soon.vue'
import ConnectedApps from '../components/ConnectedApps.vue'
import ConnectApps from '../components/ConnectApps.vue'
import { ApiError } from '../lib/api'
import { lang, t } from '../i18n'
import { countProposalsByKey, createKey, listKeys, revokeKey, updateKey, type KeyChange, type KeyItem } from '../lib/keys'
import { copyText } from '../lib/clipboard'
import { sessionScope } from '../lib/store'
import { extendChoices } from '../lib/key-extend'

// 설정 › AI·연동 (spec 008 S-4, redrawn by spec 010 S-11): API keys for the MCP endpoint and how to connect.
// A key's text is shown once, in the box after it is made; the server keeps only its hash. Its name, scope and
// expiry can be changed in the manage sheet (spec 013 S-25, PATCH /api/keys/:id). The apps connected with OAuth are listed
// under the connection steps (spec 015 S-10, components/ConnectedApps.vue). How to connect each AI app is the card above
// them (spec 017, components/ConnectApps.vue); the key command that was here is its 'API key, directly' dialog (S-6).
const keys = ref<KeyItem[]>([])
const noExpiry = ref(false)
const max = ref(10)
const loaded = ref(false)
const error = ref('')
const notice = ref('')
const busy = ref(false)
/** Proposals each key made, all time; null until counted. */
const made = ref<Record<string, number> | null>(null)
const madeCapped = ref(false)

/** Counts the times the screen was left: an answer that began in an earlier showing is dropped. */
let generation = 0
/** Counts the loads started: only the newest load's answers are applied (a refresh after a change supersedes one still counting). */
let seq = 0
let inflight: { gen: number; p: Promise<void> } | null = null
/** Lifecycle load: one per showing (mount and the first activation both ask and share it). */
function load() {
  if (inflight && inflight.gen === generation) return inflight.p
  return start()
}
/** After a key was made or revoked: always read the list again and count again; whatever was still loading is dropped. */
const refresh = () => start()
function start() {
  const mine: { gen: number; p: Promise<void> } = { gen: generation, p: run().finally(() => { if (inflight === mine) inflight = null }) }
  inflight = mine
  return mine.p
}
async function run() {
  const scope = sessionScope()
  const gen = generation
  const mySeq = ++seq
  const current = () => scope.alive() && gen === generation && mySeq === seq
  try {
    const r = await listKeys()
    if (current()) {
      keys.value = r.keys
      noExpiry.value = r.policy.noExpiry
      max.value = r.max
      loaded.value = true
    }
  } catch (e) {
    if (current()) error.value = e instanceof ApiError ? e.message : t('settingsAi.loadFailed')
    return
  }
  // The count goes on by itself: whoever waited for the list (a save that just made or revoked a key) is not held up by it.
  void (async () => {
    try {
      const c = await countProposalsByKey(current)
      if (current()) { made.value = c.counts; madeCapped.value = c.capped }
    } catch {
      // the count is a nicety: without it the line is left out
    }
  })()
}
onMounted(() => { void load() })
onActivated(() => { void load() })
// The page is kept alive when left: a key shown once must not stay in memory for the next visit, and an answer still on its way is dropped.
onDeactivated(() => { generation++; inflight = null; fresh.value = null })

const activeCount = computed(() => keys.value.length)
const proposalTotal = computed(() => (made.value ? keys.value.reduce((a, k) => a + (made.value![k.id] ?? 0), 0) : null))
const countText = (n: number) => t('settingsAi.proposalsN', { n: `${n}${madeCapped.value ? '+' : ''}` })

// ── make a key ──
const DAYS = [30, 90, 180, 365]
interface Draft { name: string; expires: string; write: boolean; confirm: 'ui' | 'chat' }
const draft = ref<Draft | null>(null)
const draftError = ref('')
const open = () => { draft.value = { name: '', expires: '90', write: false, confirm: 'ui' }; draftError.value = '' }
const full = computed(() => keys.value.length >= max.value)
/** Shown once after a key is made; leaving the page or closing the box forgets it. */
const fresh = ref<{ key: string; name: string } | null>(null)
const expOptions = computed(() => [...DAYS.map((d) => ({ id: String(d), label: t('settingsAi.days', { n: d }) })), ...(noExpiry.value ? [{ id: 'none', label: t('settingsAi.noExpiry') }] : [])])
const loc = () => (lang.value === 'en' ? 'en-US' : 'ko-KR')
const dateOf = (at: string | null) => (at ? new Date(at).toLocaleDateString(loc(), { dateStyle: 'medium' }) : '')
const expFoot = computed(() => {
  const d = draft.value
  if (!d) return ''
  if (d.expires === 'none') return t('settingsAi.expiresNone')
  return t('settingsAi.expiresOn', { date: new Date(Date.now() + Number(d.expires) * 86_400_000).toLocaleDateString(loc(), { dateStyle: 'medium' }) })
})

async function make() {
  const d = draft.value
  if (!d) return
  const name = d.name.trim()
  if (!name) return (draftError.value = t('settingsAi.needName'))
  if (name.length > 32) return (draftError.value = t('settingsAi.nameMax'))
  busy.value = true
  draftError.value = ''
  const scope = sessionScope()
  const gen = generation
  try {
    const r = await createKey({
      name, expiresInDays: d.expires === 'none' ? null : Number(d.expires),
      ...(d.write ? { write: true, confirm: d.confirm } : {}),
    })
    if (!scope.alive() || gen !== generation) return // the screen was left (or the account changed): the key text is not kept
    fresh.value = { key: r.key, name: r.item.name }
    notice.value = ''
    draft.value = null
    await refresh()
  } catch (e) {
    draftError.value = e instanceof ApiError ? e.message : t('settingsAi.createFailed')
  } finally {
    busy.value = false
  }
}

// ── manage a key: look at it, revoke it (the other changes are 준비 중) ──
const managing = ref<KeyItem | null>(null)
const confirming = ref(false)
const manageError = ref('')
/** Which part of the manage sheet is open for a change. */
const changing = ref<'name' | 'scope' | 'extend' | null>(null)
const nameDraft = ref('')
const scopeDraft = ref<{ write: boolean; confirm: 'ui' | 'chat' }>({ write: false, confirm: 'ui' })
const manage = (k: KeyItem) => { managing.value = k; confirming.value = false; manageError.value = ''; changing.value = null }
function startChange(what: 'name' | 'scope' | 'extend') {
  const k = managing.value
  if (!k) return
  manageError.value = ''
  changing.value = changing.value === what ? null : what
  nameDraft.value = k.name
  scopeDraft.value = { write: writes(k), confirm: k.confirm ?? 'ui' }
}
/** Send one change; the sheet and the list take the server's answer. */
async function change(body: KeyChange, done: string | ((k: KeyItem) => string)) {
  const k = managing.value
  if (!k) return
  manageError.value = ''
  busy.value = true
  const scope = sessionScope()
  const gen = generation
  try {
    const r = await updateKey(k.id, body)
    if (!scope.alive() || gen !== generation) return
    managing.value = r.item
    changing.value = null
    notice.value = typeof done === 'string' ? done : done(r.item)
    await refresh()
  } catch (e) {
    manageError.value = e instanceof ApiError ? e.message : t('security.updateFailed')
  } finally {
    busy.value = false
  }
}
function saveName() {
  const name = nameDraft.value.trim()
  if (!name) return (manageError.value = t('settingsAi.needName'))
  if (name.length > 32) return (manageError.value = t('settingsAi.nameMax'))
  return change({ name }, (k) => t('security.renamed', { name: k.name }))
}
const saveScope = () => change(scopeDraft.value.write ? { write: true, confirm: scopeDraft.value.confirm } : { write: false }, t('security.scopeSaved'))
const EXTEND = [30, 90, 365]
/** The choices with the date each gives; one that ends sooner than the key does now is marked (review rc3-1 F-9). */
const extendOpts = computed(() => extendChoices(EXTEND, managing.value?.expiresAt ?? null))
const extend = (days: number | null) => change({ extendDays: days }, t('security.extended'))
const closeManage = () => { managing.value = null; confirming.value = false }
async function revoke() {
  const k = managing.value
  if (!k) return
  manageError.value = ''
  busy.value = true
  try {
    await revokeKey(k.id)
    notice.value = t('settingsAi.revoked', { name: k.name })
    closeManage()
    await refresh()
  } catch (e) {
    manageError.value = e instanceof ApiError ? e.message : t('settingsAi.revokeFailed')
  } finally {
    busy.value = false
  }
}
/** In the manage dialog: 돌아가기 leaves the confirm step, 닫기 closes. */
const manageCancel = () => { if (confirming.value) confirming.value = false; else closeManage() }
const manageSave = () => { if (confirming.value) void revoke() }

// ── copy ──
async function copy(text: string, what: string) {
  error.value = ''
  if (!(await copyText(text))) return (error.value = t('settingsAi.copyFailed'))
  notice.value = t('settingsAi.copied', { what })
}

// ── how to connect ──
// spec 015 S-11: the root /mcp takes keys and OAuth; /api/mcp keeps taking keys.
const url = `${window.location.origin}/mcp`
const oldUrl = `${window.location.origin}/api/mcp`

const used = (at: string | null) => (at ? new Date(at).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }) : t('settingsAi.neverUsed'))
const writes = (k: KeyItem) => (k.permissions.mcp ?? []).includes('write')
const scope = (k: KeyItem) => {
  if (!writes(k)) return t('settingsAi.read')
  return `${t('settingsAi.readWrite')} · ${k.confirm === 'chat' ? t('settingsAi.confirmChatShort') : t('settingsAi.confirmUiShort')}`
}
const PROVIDERS = [['Anthropic Claude', 'AC'], ['OpenAI', 'OA'], ['Google Gemini', 'GG'], ['OpenAI compatible', 'OC']] as const
</script>

<template>
  <section class="ai">
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <section class="card">
      <div class="ch"><h2>{{ t('settingsAi.modelTitle') }} <span class="hint plain">{{ t('settingsAi.modelSub') }}</span></h2><Soon class="btn sm">{{ t('settingsAi.addModel') }}</Soon></div>
      <p class="mtext">{{ t('settingsAi.modelText') }}</p>
      <ul class="provs" :aria-label="t('settingsAi.modelTitle')">
        <li v-for="[name, mono] in PROVIDERS" :key="name">
          <Soon tag="div" class="prov"><span class="tile" aria-hidden="true">{{ mono }}</span><span class="pn"><b>{{ name }}</b><small class="hint">{{ t('settingsAi.notConnected') }}</small></span></Soon>
        </li>
      </ul>
    </section>

    <i18n-t keypath="settingsAi.lede" tag="p" class="intro"><template #only><b>{{ t('settingsAi.ledeOnly') }}</b></template></i18n-t>

    <div v-if="fresh" class="card fresh" role="status" :aria-label="t('settingsAi.newKeyTitle')">
      <div class="ch"><h2>{{ t('settingsAi.made', { name: fresh.name }) }}</h2></div>
      <div class="fs">
        <p class="small" style="margin:0">{{ t('settingsAi.shownOnce') }}</p>
        <div class="keybox">
          <input class="in mono" readonly :value="fresh.key" :aria-label="t('settingsAi.apiKey')" @focus="($event.target as HTMLInputElement).select()">
          <button class="btn pri" type="button" @click="copy(fresh.key, t('settingsAi.whatKey'))">{{ t('settingsAi.copy') }}</button>
        </div>
        <div><button class="btn" type="button" @click="fresh = null">{{ t('common.close') }}</button></div>
      </div>
    </div>

    <section class="card">
      <div class="ch"><h2>{{ t('settingsAi.apiKey') }}</h2><span class="hint num grow">{{ keys.length }} / {{ max }}</span><button class="btn sm pri" type="button" :disabled="full" @click="open()">{{ t('settingsAi.makeKey') }}</button></div>
      <div class="sum"><span>{{ t('settingsAi.activeN', { n: activeCount }) }}<template v-if="proposalTotal !== null"> · {{ t('settingsAi.writeProposals') }} <b class="num">{{ proposalTotal }}{{ madeCapped ? '+' : '' }}</b></template></span></div>

      <div v-if="keys.length" class="dtable">
        <table>
          <thead><tr><th scope="col">{{ t('settingsAi.colName') }}</th><th scope="col">{{ t('settingsAi.colKey') }}</th><th scope="col" class="c">{{ t('settingsAi.scopeLabel') }}</th><th scope="col">{{ t('settingsAi.colCreated') }}</th><th scope="col">{{ t('settingsAi.expiry') }}</th><th scope="col">{{ t('settingsAi.colLastUsed') }}</th><th scope="col" class="r"><span class="sr">{{ t('settingsAi.manage') }}</span></th></tr></thead>
          <tbody>
            <tr v-for="k in keys" :key="k.id">
              <td><b>{{ k.name }}</b></td>
              <td class="mono key">{{ k.start }}…</td>
              <td class="c"><span class="pill" :class="writes(k) ? 'ok' : 'mute'">{{ scope(k) }}</span></td>
              <td class="num">{{ dateOf(k.createdAt) }}</td>
              <td class="num">{{ k.expiresAt ? dateOf(k.expiresAt) : t('common.none') }}</td>
              <td class="used">{{ used(k.lastUsedAt) }}</td>
              <td class="r"><button class="btn sm" type="button" :disabled="busy" :aria-label="t('settingsAi.manageLabel', { name: k.name })" @click="manage(k)">{{ t('settingsAi.manage') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul v-if="keys.length" class="mlist">
        <li v-for="k in keys" :key="k.id"><button type="button" :aria-label="t('settingsAi.manageLabel', { name: k.name })" @click="manage(k)">
          <span class="l1"><b>{{ k.name }}</b><span class="pill" :class="writes(k) ? 'ok' : 'mute'">{{ scope(k) }}</span></span>
          <span class="mono key">{{ k.start }}…</span>
          <span class="l3"><span>{{ t('settingsAi.expiresShort', { date: k.expiresAt ? dateOf(k.expiresAt) : t('common.none') }) }} · {{ used(k.lastUsedAt) }}</span><span class="go">{{ t('settingsAi.manageGo') }}</span></span>
        </button></li>
      </ul>
      <p v-if="loaded && !keys.length" class="hint none">{{ t('settingsAi.none') }}</p>
    </section>

    <ConnectApps />

    <section class="card">
      <div class="ch"><h2>{{ t('settingsAi.connect') }}</h2></div>
      <div class="fs">
        <div class="field"><span class="lbl">{{ t('settingsAi.mcpUrl') }}</span>
          <div class="cbrow"><code class="codebox url">{{ url }}</code><button class="btn" type="button" @click="copy(url, t('settingsAi.whatUrl'))">{{ t('settingsAi.copy') }}</button></div></div>
        <p class="hint" style="margin:0">{{ t('connect.moved') }}</p>
        <p class="hint" style="margin:0">{{ t('settingsAi.keyScope') }}</p>
        <i18n-t keypath="oauth.apps.keyPath" tag="p" class="hint" style="margin:0"><template #old><span class="mono">{{ oldUrl }}</span></template></i18n-t>
        <ConnectedApps />
      </div>
    </section>

    <EditSheet v-if="draft" :title="t('settingsAi.newKeyTitle')" :desc="t('settingsAi.shownOnceNote')" :error="draftError" :busy="busy" :save-label="t('settingsAi.makeBtn')" :hint="expFoot" @save="make" @cancel="draft = null">
      <div class="field"><label for="k-name">{{ t('settingsAi.nameLabel') }} <span class="req">*</span></label><input id="k-name" v-model="draft.name" class="in" maxlength="32" autocomplete="off" :placeholder="t('settingsAi.namePh')"><span class="hint">{{ t('settingsAi.nameHint') }}</span></div>
      <div class="field"><span id="k-exp" class="lbl">{{ t('settingsAi.expiry') }}</span>
        <div class="seg" role="group" aria-labelledby="k-exp">
          <button v-for="o in expOptions" :key="o.id" type="button" :aria-pressed="draft.expires === o.id ? 'true' : 'false'" @click="draft.expires = o.id">{{ o.label }}</button>
        </div>
        <span v-if="!noExpiry" class="hint">{{ t('settingsAi.noExpiryOff') }}</span></div>
      <div class="field"><span id="k-scope" class="lbl">{{ t('settingsAi.scopeLabel') }}</span>
        <div class="choices" role="radiogroup" aria-labelledby="k-scope">
          <button type="button" role="radio" class="choice" :class="{ on: !draft.write }" :aria-checked="!draft.write" @click="draft.write = false"><b>{{ t('settingsAi.scopeRead') }}</b><small class="hint">{{ t('settingsAi.scopeReadDesc') }}</small></button>
          <button type="button" role="radio" class="choice" :class="{ on: draft.write }" :aria-checked="draft.write" @click="draft.write = true"><b>{{ t('settingsAi.scopeWrite') }}</b><small class="hint">{{ t('settingsAi.scopeWriteDesc') }}</small></button>
        </div>
      </div>
      <fieldset v-if="draft.write" class="field confirm">
        <legend>{{ t('settingsAi.confirmLabel') }}</legend>
        <label class="chk" style="border:0"><input v-model="draft.confirm" type="radio" name="k-confirm" value="ui"><span>{{ t('settingsAi.confirmUi') }}</span></label>
        <label class="chk" style="border:0"><input v-model="draft.confirm" type="radio" name="k-confirm" value="chat"><span>{{ t('settingsAi.confirmChat') }}</span></label>
        <p class="small muted" style="margin:4px 0 0">{{ draft.confirm === 'ui' ? t('settingsAi.confirmUiNote') : t('settingsAi.confirmChatNote') }}</p>
        <p class="small warn" role="note">{{ t('settingsAi.writeWarn') }}</p>
      </fieldset>
    </EditSheet>

    <EditSheet v-if="managing" :title="confirming ? t('settingsAi.revokeAsk', { name: managing.name }) : t('settingsAi.manageTitle', { name: managing.name })"
      :desc="confirming ? t('settingsAi.revokeAskDesc') : t('settingsAi.manageSub', { made: dateOf(managing.createdAt), used: used(managing.lastUsedAt) })"
      :error="manageError" :busy="busy" :hide-save="!confirming" danger :save-label="t('settingsAi.revokeBtn')"
      :cancel-label="confirming ? t('settingsAi.revokeBack') : t('common.close')" :hint="confirming ? t('settingsAi.revokeFoot') : ''" @save="manageSave" @cancel="manageCancel">
      <template v-if="!confirming">
        <div class="field"><span class="lbl">{{ t('settingsAi.nameShort') }}</span>
          <div v-if="changing !== 'name'" class="cbrow"><span class="ro">{{ managing.name }}</span><button class="btn sm" type="button" :disabled="busy" @click="startChange('name')">{{ t('settingsAi.rename') }}</button></div>
          <div v-else class="cbrow"><input v-model="nameDraft" class="in grow" maxlength="32" autocomplete="off" :aria-label="t('settingsAi.nameShort')" @keydown.enter.prevent="saveName"><button class="btn sm pri" type="button" :disabled="busy" @click="saveName">{{ t('security.renameSave') }}</button><button class="btn sm ghost" type="button" @click="changing = null">{{ t('common.cancel') }}</button></div></div>
        <div class="field"><span class="lbl">{{ t('settingsAi.colKey') }}</span>
          <div class="cbrow"><code class="codebox key">{{ managing.start }}…</code></div>
          <span class="hint">{{ t('settingsAi.keyOnce') }}</span></div>
        <div class="field"><span class="lbl">{{ t('settingsAi.scopeLabel') }}</span>
          <div class="cbrow"><span class="ro"><span class="pill" :class="writes(managing) ? 'ok' : 'mute'">{{ scope(managing) }}</span></span><button class="btn sm" type="button" :disabled="busy" :aria-expanded="changing === 'scope'" @click="startChange('scope')">{{ t('settingsAi.changeScope') }}</button></div>
          <template v-if="changing === 'scope'">
            <div class="choices sc" role="radiogroup" :aria-label="t('settingsAi.scopeLabel')">
              <button type="button" role="radio" class="choice" :class="{ on: !scopeDraft.write }" :aria-checked="!scopeDraft.write" @click="scopeDraft.write = false"><b>{{ t('settingsAi.scopeRead') }}</b><small class="hint">{{ t('settingsAi.scopeReadDesc') }}</small></button>
              <button type="button" role="radio" class="choice" :class="{ on: scopeDraft.write }" :aria-checked="scopeDraft.write" @click="scopeDraft.write = true"><b>{{ t('settingsAi.scopeWrite') }}</b><small class="hint">{{ t('settingsAi.scopeWriteDesc') }}</small></button>
            </div>
            <fieldset v-if="scopeDraft.write" class="field confirm">
              <legend>{{ t('settingsAi.confirmLabel') }}</legend>
              <label class="chk" style="border:0"><input v-model="scopeDraft.confirm" type="radio" name="m-confirm" value="ui"><span>{{ t('settingsAi.confirmUi') }}</span></label>
              <label class="chk" style="border:0"><input v-model="scopeDraft.confirm" type="radio" name="m-confirm" value="chat"><span>{{ t('settingsAi.confirmChat') }}</span></label>
              <p class="small muted" style="margin:4px 0 0">{{ scopeDraft.confirm === 'ui' ? t('settingsAi.confirmUiNote') : t('settingsAi.confirmChatNote') }}</p>
            </fieldset>
            <div class="cbrow"><button class="btn sm pri" type="button" :disabled="busy" @click="saveScope">{{ t('security.scopeSave') }}</button><button class="btn sm ghost" type="button" @click="changing = null">{{ t('common.cancel') }}</button></div>
          </template>
          <span class="hint">{{ t('settingsAi.writeWarn') }}</span></div>
        <div class="field"><span class="lbl">{{ t('settingsAi.expiry') }}</span>
          <div class="cbrow"><span class="ro">{{ t('settingsAi.expiresNow', { date: managing.expiresAt ? dateOf(managing.expiresAt) : t('common.none') }) }}</span><button class="btn sm" type="button" :disabled="busy" :aria-expanded="changing === 'extend'" @click="startChange('extend')">{{ t('settingsAi.extend') }}</button></div>
          <template v-if="changing === 'extend'">
            <div class="cbrow ext"><button v-for="o in extendOpts" :key="o.days" class="btn sm" type="button" :disabled="busy" @click="extend(o.days)">{{ t('security.extendTo', { n: o.days, date: dateOf(o.at) }) }}<span v-if="o.shorter" class="shorter"> · {{ t('security.extendShorter') }}</span></button><button v-if="noExpiry" class="btn sm" type="button" :disabled="busy" @click="extend(null)">{{ t('security.extendNone') }}</button></div>
            <span class="hint">{{ t('security.extendHint') }}</span><span v-if="!noExpiry" class="hint">{{ t('settingsAi.noExpiryOff') }}</span>
          </template></div>
        <div v-if="writes(managing) && made" class="field"><span class="lbl">{{ t('settingsAi.writeProposals') }}</span>
          <span class="ro">{{ countText(made[managing.id] ?? 0) }}</span></div>
        <div class="field"><span class="lbl">{{ t('settingsAi.recent') }}</span>
          <dl class="usage"><dt>{{ t('security.lastUsed') }}</dt><dd>{{ used(managing.lastUsedAt) }}</dd><dt>{{ t('security.requests') }}</dt><dd class="num">{{ managing.requestCount }}</dd></dl></div>
        <div class="danger-box">
          <span><b>{{ t('settingsAi.revokeTitle') }}</b>{{ t('settingsAi.revokeDesc') }}</span>
          <button class="btn sm bad" type="button" :aria-label="t('settingsAi.revokeLabel', { name: managing.name })" @click="confirming = true">{{ t('settingsAi.revoke') }}</button>
        </div>
      </template>
      <template v-else>
        <p class="small muted" style="margin:0">{{ t('settingsAi.revokeAskText') }}</p>
      </template>
    </EditSheet>
  </section>
</template>

<style scoped>
.ai{display:flex;flex-direction:column;gap:16px}
.ch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}
.ch h2{margin:0;font-size:15px;font-weight:600}
.hint.plain{font-weight:400}
.grow{flex-grow:1}
.mtext{margin:0;padding:12px 18px 0;font-size:13px;color:var(--text-2)}
.provs{list-style:none;margin:0;padding:12px 18px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.provs li{padding:14px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface)}
.prov{display:flex;width:100%}
.prov :deep(.soon-in){display:flex;align-items:center;gap:10px;min-width:0}
.tile{width:32px;height:32px;border-radius:var(--r-card);background:var(--fill);color:var(--text-2);display:grid;place-items:center;font:600 12px var(--f-mono);flex:none}
.pn{display:flex;flex-direction:column;min-width:0}
.pn b{font-size:14px}
.intro{margin:0;font-size:13px;color:var(--text-2)}
.sum{padding:12px 18px;border-bottom:1px solid var(--border);font-size:13px;color:var(--text-2)}
.dtable{overflow-x:auto;position:relative}
.dtable table{min-width:880px}
td.c,th.c{text-align:center}
td.r,th.r{text-align:right}
td.num{font-variant-numeric:tabular-nums;font-weight:400}
td.key,.key{font-size:12px;color:var(--muted)}
td.used{color:var(--muted);font-weight:400}
td b{font-weight:600}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.mlist{display:none;list-style:none;margin:0;padding:0}
.mlist li{border-bottom:1px solid var(--divider)}
.mlist button{display:flex;flex-direction:column;gap:6px;width:100%;padding:12px 16px;border:0;background:transparent;text-align:left;font:inherit;color:var(--text);cursor:pointer}
.l1,.l3{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%}
.l3{font-size:12px;color:var(--subtle)}
.go{color:var(--primary-text);font-weight:600}
.none{margin:0;padding:20px 18px;text-align:center}
.fs .field{display:block}
.fs .lbl,.field .lbl{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px}
.fs .hint,.field .hint{display:block;margin-top:4px}
.cbrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.codebox{display:block;flex:1;min-width:0;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--surface-2);font:12px var(--f-mono);color:var(--text);overflow-x:auto}
.codebox.cmd{white-space:pre-wrap;overflow-wrap:anywhere}
.url{overflow-wrap:anywhere}
.ro{flex:1;min-width:0;font-size:14px;overflow-wrap:anywhere}
.fresh{border-color:var(--accent-line);background:var(--accent-soft)}
.fresh .ch{border-color:var(--accent-line)}
.fresh h2{color:var(--accent-text)}
.keybox{display:flex;gap:8px;align-items:center}
.keybox .in{flex:1;min-width:0;height:40px}
.choices{display:flex;flex-direction:column;gap:8px}
.choice{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);color:var(--text);text-align:left;cursor:pointer;font:inherit}
.choice:hover{border-color:var(--border-strong)}
.choice.on{border:2px solid var(--primary-text);padding:11px;background:var(--primary-tint)}
.choice b{font-size:14px}
.confirm{border:0;padding:0;margin:0;min-width:0}
.confirm legend{padding:0;margin-bottom:4px;font-size:13px}
.warn{color:var(--neg-text);margin:6px 0 0}
.sc{margin-top:8px}
.ext{margin-top:8px}
.ext .shorter{color:var(--neg-text)}
.usage{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px}
.usage dt{color:var(--subtle)}
.usage dd{margin:0}
.danger-box{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--neg-line);border-radius:var(--r-card);background:var(--neg-soft)}
.danger-box span{flex:1;font-size:13px;color:var(--text-2)}
.danger-box b{display:block;color:var(--neg-text)}
@media (max-width:760px){
  .dtable{display:none}
  .mlist{display:block}
  .sum{padding:12px 16px}
}
</style>
