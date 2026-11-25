<script setup lang="ts">
// 설정 › AI·연동 › 앱 연결 (spec 017 S-1–S-3): one tile per AI app (src/lib/connect-guide.ts); a tile opens a dialog with
// the steps, this server's MCP address filled in, copy buttons and the official help links. A centred dialog on a wide
// screen, a bottom sheet at phone width. When OAuth is not possible on this server (GET /api/oauth-apps → enabled:false,
// the same value the connected-apps list reads), the apps that need it are dimmed with the reason, and still open.
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onActivated, onMounted, ref } from 'vue'
import { api } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { CONNECT_APPS, blockedWithoutOauth, filled, type ConnectApp } from '../lib/connect-guide'
import { sessionScope } from '../lib/store'
import { t, type MessageKey } from '../i18n'

const origin = window.location.origin
const fill = computed(() => ({ url: `${origin}/mcp`, origin, keyPh: t('settingsAi.keyPh') }))
/** null until the server answered; a failed answer dims nothing (the connected-apps list shows that error). */
const oauthOn = ref<boolean | null>(null)
const open = ref<ConnectApp | null>(null)
const status = ref('')
const failed = ref('')
/** The skills this server offers (S-4): null until asked, then the list (empty when the server has no skills/ folder). */
const skills = ref<{ name: string; file: string; bytes: number }[] | null>(null)
const skillsError = ref('')

async function load() {
  const scope = sessionScope()
  try {
    const r = await api<{ enabled: boolean }>('GET', '/api/oauth-apps')
    if (scope.alive()) oauthOn.value = r.enabled
  } catch { /* keep every app as it is */ }
}
onMounted(load)
onActivated(load)

const off = computed(() => oauthOn.value === false)
const dimmed = (app: ConnectApp) => off.value && blockedWithoutOauth(app)
const authLabel = (app: ConnectApp) => t(app.auth === 'oauth' ? 'connect.oauthOnly' : app.auth === 'key' ? 'connect.keyOnly' : 'connect.either')
const steps = computed(() => (open.value ? filled(open.value, fill.value) : []))

async function copy(text: string) {
  failed.value = ''
  status.value = ''
  if (await copyText(text)) status.value = t('connect.copied')
  else failed.value = t('connect.copyFailed')
}
async function loadSkills() {
  if (skills.value) return
  const scope = sessionScope()
  skillsError.value = ''
  try {
    const r = await api<{ skills: { name: string; file: string; bytes: number }[] }>('GET', '/api/skills')
    if (scope.alive()) skills.value = r.skills
  } catch {
    if (scope.alive()) skillsError.value = t('connect.skills.failed')
  }
}
const skillTitle = (name: string) => {
  const key = `connect.skills.names.${name}` as MessageKey
  const s = t(key)
  return s === key ? name : s
}
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`

function show(app: ConnectApp) {
  status.value = ''
  failed.value = ''
  open.value = app
  if (app.skills) void loadSkills()
}
</script>

<template>
  <section class="card ca-card" :aria-labelledby="'ca-title'">
    <div class="ch"><h2 id="ca-title">{{ t('connect.title') }} <span class="hint plain">{{ t('connect.sub') }}</span></h2></div>
    <p v-if="off" class="hint ca-off" role="note">{{ t('connect.oauthOff') }}</p>
    <ul class="ca-apps" :aria-label="t('connect.title')">
      <li v-for="app in CONNECT_APPS" :key="app.id">
        <button type="button" class="ca-app" :class="{ dim: dimmed(app) }" :aria-label="t('connect.open', { name: t(app.name) })" :data-app="app.id" @click="show(app)">
          <b>{{ t(app.name) }}</b>
          <small class="hint">{{ dimmed(app) ? t('connect.oauthOffShort') : authLabel(app) }}</small>
        </button>
      </li>
    </ul>
    <p class="hint ca-asof">{{ t('connect.asOf') }}</p>
  </section>

  <DialogRoot :open="!!open" @update:open="(o: boolean) => { if (!o) open = null }">
    <DialogPortal>
      <div v-if="open" class="dlg-layer ca-layer">
        <DialogOverlay class="dlg-ov" />
        <DialogContent class="ca-dlg dlg">
          <div class="ca-head">
            <DialogTitle class="ca-t">{{ t(open.name) }}</DialogTitle>
            <DialogClose class="btn sm ghost" :aria-label="t('connect.close')">{{ t('connect.close') }}</DialogClose>
          </div>
          <DialogDescription class="hint ca-d">{{ authLabel(open) }} · {{ t('connect.asOf') }}</DialogDescription>
          <p v-if="off && open.auth !== 'key'" class="ca-warn" role="note">{{ t('connect.oauthOff') }}</p>
          <ol class="ca-steps">
            <li v-for="(s, i) in steps" :key="i" :class="{ dim: off && s.mode === 'oauth' }">
              <span>{{ s.text === 'connect.step.keyCommand' ? t(s.text, { key: fill.keyPh }) : t(s.text) }}</span>
              <span v-if="off && s.mode === 'oauth'" class="hint ca-why">{{ t('connect.stepOauthOff') }}</span>
              <div v-if="s.value" class="cbrow"><code class="codebox cmd">{{ s.value }}</code><button class="btn sm" type="button" @click="copy(s.value)">{{ t('connect.copy') }}</button></div>
            </li>
          </ol>
          <ul v-if="open.notes?.length" class="ca-notes">
            <li v-for="n in open.notes" :key="n" class="hint">{{ t(n) }}</li>
          </ul>
          <section v-if="open.skills" class="ca-skills" :aria-label="t('connect.skills.title')">
            <h3>{{ t('connect.skills.title') }}</h3>
            <p class="hint">{{ t('connect.skills.desc') }}</p>
            <p v-if="skillsError" class="save-err" role="alert">{{ skillsError }}</p>
            <p v-else-if="skills && !skills.length" class="hint">{{ t('connect.skills.none') }}</p>
            <ul v-else-if="skills">
              <li v-for="sk in skills" :key="sk.name"><span><b>{{ skillTitle(sk.name) }}</b> <span class="hint mono">{{ sk.file }} · {{ kb(sk.bytes) }}</span></span>
                <a class="btn sm" :href="`/api/skills/${encodeURIComponent(sk.file)}`" :download="sk.file">{{ t('connect.skills.download') }}</a></li>
            </ul>
          </section>
          <div class="ca-help">
            <span class="lbl">{{ t('connect.help') }}</span>
            <a v-for="h in open.help" :key="h.url" :href="h.url" target="_blank" rel="noopener noreferrer">{{ h.title }}</a>
          </div>
          <p v-if="status" class="hint ca-status" role="status">{{ status }}</p>
          <p v-if="failed" class="save-err" role="alert">{{ failed }}</p>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.ca-card .ch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}
.ca-card .ch h2{margin:0;font-size:15px;font-weight:600}
.ca-card .hint.plain{font-weight:400}
.ca-apps{list-style:none;margin:0;padding:12px 18px 4px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.ca-app{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;min-height:56px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);color:var(--text);text-align:left;cursor:pointer}
.ca-app:hover,.ca-app:focus-visible{border-color:var(--border-strong);background:var(--surface-2)}
.ca-app.dim{opacity:.55}
.ca-app small{font-size:12px}
.ca-off{margin:12px 18px 0}
.ca-asof{margin:4px 18px 16px;font-size:12px}
.ca-layer{display:flex;justify-content:center;align-items:flex-start;padding:72px 16px}
.ca-dlg{position:relative;z-index:1;width:640px;max-width:100%;max-height:calc(100vh - 120px);overflow:auto;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);padding:18px 20px 20px;outline:none}
.ca-head{display:flex;align-items:center;gap:12px}
.ca-t{flex:1;margin:0;font-size:17px;font-weight:700}
.ca-d{margin:4px 0 12px;font-size:12px}
.ca-warn{margin:0 0 12px;padding:10px 12px;border-radius:var(--r-ctl);background:var(--warn-soft, var(--fill));color:var(--text);font-size:13px}
.ca-steps{margin:0;padding:0;list-style:none;counter-reset:ca;display:flex;flex-direction:column;gap:12px}
.ca-steps li{counter-increment:ca;position:relative;padding-left:30px;display:flex;flex-direction:column;gap:6px;line-height:1.5}
.ca-steps li::before{content:counter(ca);position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;background:var(--fill);color:var(--text-2);font-size:12px;font-weight:600;display:grid;place-items:center}
.ca-steps li.dim > span:first-child{opacity:.55}
.ca-why{font-size:12px}
.ca-notes{margin:14px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.ca-notes li{font-size:12px}
.ca-skills{margin-top:16px;padding-top:12px;border-top:1px solid var(--border)}
.ca-skills h3{margin:0 0 4px;font-size:14px}
.ca-skills p{margin:0 0 8px;font-size:12px}
.ca-skills ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ca-skills li{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ca-help{margin-top:14px;display:flex;flex-direction:column;gap:4px;font-size:13px}
.ca-help a{color:var(--primary-text);overflow-wrap:anywhere}
.ca-status,.ca-dlg .save-err{margin:10px 0 0}
.ca-dlg .cbrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ca-dlg .codebox{display:block;flex:1;min-width:0;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--surface-2);font:12px var(--f-mono);color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width:760px){
  .ca-apps{grid-template-columns:1fr}
  .ca-layer{align-items:flex-end;padding:0}
  .ca-dlg{width:100%;max-height:88vh;border-radius:var(--r-pop) var(--r-pop) 0 0;padding:16px 16px 24px}
}
</style>
