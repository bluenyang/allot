<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref } from 'vue'
import EditSheet from '../components/EditSheet.vue'
import { ApiError } from '../lib/api'
import { lang, t } from '../i18n'
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
    error.value = e instanceof ApiError ? e.message : t('settingsAi.loadFailed')
  }
}
onMounted(load)
onActivated(load)
// The page is kept alive when left: a key shown once must not stay in memory for the next visit.
onDeactivated(() => { fresh.value = null })

// ── make a key ──
const DAYS = [30, 90, 180, 365]
interface Draft { name: string; expires: string; write: boolean; confirm: 'ui' | 'chat' }
const draft = ref<Draft | null>(null)
const draftError = ref('')
const open = () => { draft.value = { name: '', expires: '90', write: false, confirm: 'ui' }; draftError.value = '' }
const full = computed(() => keys.value.length >= max.value)
/** Shown once after a key is made; leaving the page or closing the box forgets it. */
const fresh = ref<{ key: string; name: string } | null>(null)

async function make() {
  const d = draft.value
  if (!d) return
  const name = d.name.trim()
  if (!name) return (draftError.value = t('settingsAi.needName'))
  if (name.length > 32) return (draftError.value = t('settingsAi.nameMax'))
  busy.value = true
  draftError.value = ''
  try {
    const r = await createKey({
      name, expiresInDays: d.expires === 'none' ? null : Number(d.expires),
      ...(d.write ? { write: true, confirm: d.confirm } : {}),
    })
    fresh.value = { key: r.key, name: r.item.name }
    notice.value = ''
    draft.value = null
    await load()
  } catch (e) {
    draftError.value = e instanceof ApiError ? e.message : t('settingsAi.createFailed')
  } finally {
    busy.value = false
  }
}

async function revoke(k: KeyItem) {
  if (!confirm(t('settingsAi.confirmRevoke', { name: k.name }))) return
  error.value = ''
  busy.value = true
  try {
    await revokeKey(k.id)
    notice.value = t('settingsAi.revoked', { name: k.name })
    await load()
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('settingsAi.revokeFailed')
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
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand('copy')
    box.remove()
    if (!ok) return (error.value = t('settingsAi.copyFailed'))
  }
  notice.value = t('settingsAi.copied', { what })
}

// ── how to connect ──
const url = `${window.location.origin}/api/mcp`
const command = computed(() => `claude mcp add --transport http allot ${url} --header "Authorization: Bearer ${t('settingsAi.keyPh')}"`)

const loc = () => (lang.value === 'en' ? 'en-US' : 'ko-KR')
const when = (at: string | null) => (at ? new Date(at).toLocaleDateString(loc(), { dateStyle: 'medium' }) : '')
const used = (at: string | null) => (at ? new Date(at).toLocaleString(loc(), { dateStyle: 'medium', timeStyle: 'short' }) : t('settingsAi.neverUsed'))
const scope = (k: KeyItem) => {
  if (!(k.permissions.mcp ?? []).includes('write')) return t('settingsAi.read')
  return `${t('settingsAi.readWrite')} · ${k.confirm === 'chat' ? t('settingsAi.confirmChatShort') : t('settingsAi.confirmUiShort')}`
}
</script>

<template>
  <section>
    <p class="lede">{{ t('settingsAi.lede') }}</p>
    <p v-if="error" class="save-err" role="alert">{{ error }} <button type="button" @click="error = ''">{{ t('common.close') }}</button></p>
    <p v-if="notice" class="small muted" role="status">{{ notice }}</p>

    <div v-if="fresh" class="panel fresh" role="status" :aria-label="t('settingsAi.newKeyTitle')">
      <h3>{{ t('settingsAi.made', { name: fresh.name }) }}</h3>
      <p class="small">{{ t('settingsAi.shownOnce') }}</p>
      <div class="keybox">
        <input class="in mono" readonly :value="fresh.key" :aria-label="t('settingsAi.apiKey')" @focus="($event.target as HTMLInputElement).select()">
        <button class="btn pri" type="button" @click="copy(fresh.key, t('settingsAi.whatKey'))">{{ t('settingsAi.copy') }}</button>
      </div>
      <div class="btns"><button class="btn" type="button" @click="fresh = null">{{ t('common.close') }}</button></div>
    </div>

    <div class="panel">
      <h3>{{ t('settingsAi.apiKey') }}</h3>
      <div class="btns head">
        <button class="btn pri" type="button" :disabled="full" @click="open()">{{ t('settingsAi.makeKey') }}</button>
        <span class="small muted">{{ keys.length }} / {{ max }}</span>
      </div>

      <EditSheet v-if="draft" :title="t('settingsAi.newKeyTitle')" :error="draftError" :busy="busy" @save="make" @cancel="draft = null">
        <div class="field"><label for="k-name">{{ t('settingsAi.nameLabel') }}</label><input id="k-name" v-model="draft.name" class="in" maxlength="32" autocomplete="off" :placeholder="t('settingsAi.namePh')"></div>
        <div class="field"><label for="k-exp">{{ t('settingsAi.expiry') }}</label>
          <select id="k-exp" v-model="draft.expires" class="in">
            <option v-for="d in DAYS" :key="d" :value="String(d)">{{ t('settingsAi.daysLater', { n: d }) }}</option>
            <option v-if="noExpiry" value="none">{{ t('settingsAi.noExpiry') }}</option>
          </select>
        </div>
        <div class="field"><label>{{ t('settingsAi.scopeLabel') }}</label>
          <p v-if="!draft.write" class="small" style="margin:0">{{ t('settingsAi.readOnly') }}</p>
          <p v-else class="small" style="margin:0">{{ t('settingsAi.readWriteNote') }}</p>
          <label class="chk" style="border:0"><input id="k-write" v-model="draft.write" type="checkbox"><span>{{ t('settingsAi.allowWrite') }}</span></label>
        </div>
        <fieldset v-if="draft.write" class="field confirm">
          <legend>{{ t('settingsAi.confirmLabel') }}</legend>
          <label class="chk" style="border:0"><input v-model="draft.confirm" type="radio" name="k-confirm" value="ui"><span>{{ t('settingsAi.confirmUi') }}</span></label>
          <label class="chk" style="border:0"><input v-model="draft.confirm" type="radio" name="k-confirm" value="chat"><span>{{ t('settingsAi.confirmChat') }}</span></label>
          <p class="small muted" style="margin:4px 0 0">{{ draft.confirm === 'ui' ? t('settingsAi.confirmUiNote') : t('settingsAi.confirmChatNote') }}</p>
          <p class="small warn" role="note">{{ t('settingsAi.writeWarn') }}</p>
        </fieldset>
        <template #after>
          <p v-if="!noExpiry" class="small muted">{{ t('settingsAi.noExpiryOff') }}</p>
          <p class="small muted">{{ t('settingsAi.shownOnceNote') }}</p>
        </template>
      </EditSheet>

      <p v-if="loaded && !keys.length" class="muted empty">{{ t('settingsAi.none') }}</p>
      <div v-else-if="keys.length" class="scroll-x">
        <table class="tbl">
          <thead><tr><th>{{ t('settingsAi.colName') }}</th><th>{{ t('settingsAi.colKey') }}</th><th>{{ t('settingsAi.scopeLabel') }}</th><th>{{ t('settingsAi.colCreated') }}</th><th>{{ t('settingsAi.expiry') }}</th><th>{{ t('settingsAi.colLastUsed') }}</th><th><span class="sr">{{ t('settingsAi.revoke') }}</span></th></tr></thead>
          <tbody>
            <tr v-for="k in keys" :key="k.id">
              <td>{{ k.name }}</td>
              <td class="mono">{{ k.start }}…</td>
              <td>{{ scope(k) }}</td>
              <td class="n">{{ when(k.createdAt) }}</td>
              <td class="n">{{ k.expiresAt ? when(k.expiresAt) : t('common.none') }}</td>
              <td class="n">{{ used(k.lastUsedAt) }}</td>
              <td><button class="btn" type="button" :disabled="busy" :aria-label="t('settingsAi.revokeLabel', { name: k.name })" @click="revoke(k)">{{ t('settingsAi.revoke') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h3>{{ t('settingsAi.connect') }}</h3>
      <p class="small">{{ t('settingsAi.mcpUrl') }} <span class="mono url">{{ url }}</span> <button class="btn" type="button" @click="copy(url, t('settingsAi.whatUrl'))">{{ t('settingsAi.copy') }}</button></p>
      <i18n-t keypath="settingsAi.addHow" tag="p" class="small"><template #ph><span class="mono">{{ t('settingsAi.keyPh') }}</span></template></i18n-t>
      <div class="cmd"><code class="mono">{{ command }}</code><button class="btn" type="button" @click="copy(command, t('settingsAi.whatCommand'))">{{ t('settingsAi.copy') }}</button></div>
      <p class="small muted">{{ t('settingsAi.keyScope') }}</p>
      <p class="small muted">{{ t('settingsAi.later') }}</p>
    </div>
  </section>
</template>

<style scoped>
.panel{margin-bottom:14px}
.head{margin:0 0 12px;margin-top:0}
.empty{margin:8px 0 0}
.confirm{border:0;padding:0;margin:0 0 12px;min-width:0}
.confirm legend{padding:0;margin-bottom:4px;font-size:13px}
.warn{color:var(--neg-text);margin:6px 0 0}
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
