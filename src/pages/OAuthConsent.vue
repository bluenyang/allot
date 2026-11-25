<script setup lang="ts">
// The consent screen of an external app connection (spec 015 S-4, S-5): which app asks, where it goes back,
// and one of the three permissions. The authorization endpoint sends the browser here with a signed request in
// the address; the server checks the signature and says which app it is (GET /api/oauth-apps/request).
// Allow or deny goes to Better Auth's /oauth2/consent, which answers with the address to go to next.
import { computed, onMounted, ref } from 'vue'
import { authClient } from '../lib/auth-client'
import { api, ApiError } from '../lib/api'
import { t, type MessageKey } from '../i18n'

type Scope = 'allot:read' | 'allot:propose' | 'allot:apply'
interface Request { clientId: string; name: string; redirectHost: string; redirectUri: string; localhostOnly: boolean; requested: Scope[]; extra: string[] }

const SCOPES: Scope[] = ['allot:read', 'allot:propose', 'allot:apply']
const LABEL: Record<Scope, [MessageKey, MessageKey]> = {
  'allot:read': ['oauth.consent.read', 'oauth.consent.readDesc'],
  'allot:propose': ['oauth.consent.propose', 'oauth.consent.proposeDesc'],
  'allot:apply': ['oauth.consent.apply', 'oauth.consent.applyDesc'],
}

const session = authClient.useSession()
const req = ref<Request | null>(null)
const err = ref('')
const busy = ref(false)
const chosen = ref<Scope | null>(null)
const query = window.location.search.replace(/^\?/, '')
const asked = (s: Scope) => req.value?.requested.includes(s) ?? false
const canAllow = computed(() => !!chosen.value && asked(chosen.value) && !busy.value)

onMounted(async () => {
  try {
    req.value = await api<Request>('GET', `/api/oauth-apps/request?q=${encodeURIComponent(query)}`)
    // the narrowest permission the app asked for is the starting choice
    chosen.value = SCOPES.find((s) => req.value!.requested.includes(s)) ?? null
  } catch (e) {
    err.value = e instanceof ApiError ? e.message : t('oauth.consent.failed')
  }
})

/** Better Auth answers { redirect, url }; the client's redirect plugin follows it. Follow it here too, in case. */
async function decide(accept: boolean) {
  if (!req.value || busy.value) return
  err.value = ''
  busy.value = true
  const scope = accept && chosen.value ? [chosen.value, ...req.value.extra].join(' ') : undefined
  const { data, error } = await authClient.$fetch<{ redirect: boolean; url: string }>('/oauth2/consent', {
    method: 'POST',
    body: { accept, ...(scope ? { scope } : {}), oauth_query: query },
  })
  if (error || !data?.url) {
    busy.value = false
    err.value = t('oauth.consent.failed')
    return
  }
  window.location.href = data.url
}
</script>

<template>
  <div class="lg">
    <main class="login">
      <section class="lcard" aria-labelledby="c-t">
        <div class="brand"><span class="logo" aria-hidden="true">A</span><span class="bn"><b>Allot</b><small>{{ t('oauth.consent.title') }}</small></span></div>
        <div class="pbody">
          <p v-if="!req && !err" class="note">{{ t('oauth.consent.loading') }}</p>
          <template v-if="req">
            <h1 id="c-t">{{ t('oauth.consent.asks', { name: req.name }) }}</h1>
            <p v-if="session.data" class="note">{{ t('oauth.consent.account', { email: session.data.user.email }) }}</p>
            <div class="back">
              <span class="note">{{ t('oauth.consent.returnsTo') }}</span>
              <b class="mono host">{{ req.redirectHost }}</b>
            </div>
            <p v-if="req.localhostOnly" class="warn" role="note">{{ t('oauth.consent.localhostWarn') }}</p>
            <p v-if="!req.requested.length" class="warn" role="note">{{ t('oauth.consent.noneAsked') }}</p>
            <div v-else>
              <p id="c-scope" class="lbl">{{ t('oauth.consent.choose') }}</p>
              <div class="choices" role="radiogroup" aria-labelledby="c-scope">
                <button
                  v-for="s in SCOPES" :key="s" type="button" role="radio" class="choice"
                  :class="{ on: chosen === s }" :aria-checked="chosen === s" :disabled="!asked(s) || busy"
                  @click="chosen = s"
                >
                  <b>{{ t(LABEL[s][0]) }}</b>
                  <small class="hint">{{ asked(s) ? t(LABEL[s][1]) : t('oauth.consent.notAsked') }}</small>
                </button>
              </div>
            </div>
            <div class="acts">
              <button class="btn" type="button" :disabled="busy" @click="decide(false)">{{ t('oauth.consent.deny') }}</button>
              <button class="btn pri" type="button" :disabled="!canAllow" @click="decide(true)">{{ busy ? t('oauth.consent.sending') : t('oauth.consent.allow') }}</button>
            </div>
          </template>
          <p v-if="err" class="err" role="alert">{{ err }}</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.lg{min-height:100vh;display:flex;flex-direction:column}
.login{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 16px}
.lcard{width:440px;max-width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-pop);overflow:hidden;box-shadow:var(--shadow-login)}
.brand{display:flex;align-items:center;gap:10px;padding:20px 24px 16px;border-bottom:1px solid var(--border)}
.bn{display:flex;flex-direction:column}
.bn b{font-weight:700;font-size:17px}
.bn small{font-size:11px;color:var(--subtle)}
.pbody{padding:20px 24px 24px;display:flex;flex-direction:column;gap:16px}
h1{margin:0;font-size:18px;font-weight:700;overflow-wrap:anywhere}
.back{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--border);border-radius:var(--r-card)}
.host{font-size:18px;overflow-wrap:anywhere}
.lbl{margin:0 0 8px;font-size:13px;font-weight:600}
.choices{display:flex;flex-direction:column;gap:8px}
.choice{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--surface);color:var(--text);text-align:left;cursor:pointer;font:inherit}
.choice:hover:not(:disabled){border-color:var(--border-strong)}
.choice.on{border:2px solid var(--primary-text);padding:11px;background:var(--primary-tint)}
.choice:disabled{cursor:not-allowed;opacity:.55}
.choice b{font-size:14px}
.hint{font-size:12px;color:var(--muted)}
.acts{display:flex;gap:8px}
.acts .btn{flex:1;height:44px}
.warn{margin:0;padding:10px 12px;border:1px solid var(--accent-line);border-radius:var(--r-card);background:var(--accent-soft);color:var(--accent-text);font-size:13px}
.err{margin:0;color:var(--neg-text);font-size:13px}
.note{margin:0;font-size:13px;color:var(--muted)}
@media (max-width:760px){
  .login{padding:24px 16px;align-items:flex-start}
  .lcard{margin-top:24px}
}
</style>
