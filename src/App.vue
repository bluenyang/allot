<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SIDE, sideFolded, sideWidth, setSideWidth, toggleSide } from './lib/sidebar'
import Icon from './components/Icon.vue'
import Dashboard from './pages/Dashboard.vue'
import Subscriptions from './pages/Subscriptions.vue'
import Payroll from './pages/Payroll.vue'
import Timeline from './pages/Timeline.vue'
import History from './pages/History.vue'
import Dev from './pages/Dev.vue'
import Settings from './pages/Settings.vue'
import Admin from './pages/Admin.vue'
import { api } from './lib/api'
import { savePreferences, status, store } from './lib/store'
import { notReady, view } from './lib/view'
import { addYm, phaseAt, ymLabel } from './lib/calc'
import { authClient } from './lib/auth-client'
import { t, type MessageKey } from './i18n'

// Shell (spec 007 S-2): grouped sidebar with the user at the bottom, a footer on every page;
// on a phone a top bar and a bottom tab bar. Menus for features that do not exist yet are not here (S-3).
interface Page { id: string; comp: unknown }
const PAGES: Record<string, Page> = {
  home: { id: 'home', comp: Dashboard },
  subs: { id: 'subs', comp: Subscriptions },
  pay: { id: 'pay', comp: Payroll },
  events: { id: 'events', comp: Timeline },
  history: { id: 'history', comp: History },
  settings: { id: 'settings', comp: Settings },
  admin: { id: 'admin', comp: Admin },
  dev: { id: 'dev', comp: Dev },
}
const label = (id: string) => t(`shell.pages.${id}` as MessageKey)
const groups = [
  { id: 'overview', items: ['home'] },
  { id: 'manage', items: ['subs', 'pay', 'events', 'history'] },
]
const bottom = ['home', 'subs', 'pay', 'events', 'history', 'settings']

interface Me { name: string; email: string; role: string }
const me = ref<Me | null>(null)
onMounted(async () => {
  try { me.value = (await api<{ user: Me }>('GET', '/api/me')).user } catch { /* the shell works without it */ }
})
const isAdmin = computed(() => me.value?.role === 'admin')
/** The admin page shows for admins only; the server refuses everyone else anyway. */
const lower = computed(() => ['settings', ...(isAdmin.value ? ['admin'] : []), 'dev'])

// Hash routes: #home, #subs, …, #settings/<tab>. #account is kept as an alias of the
// login & security tab, because external-login linking returns to /#account (spec 007 S-12).
const read = () => {
  const [head = '', sub = ''] = location.hash.slice(1).split('?')[0]!.split('/')
  if (head === 'account') return { page: 'settings', sub: 'security' }
  return PAGES[head] ? { page: head, sub } : { page: 'home', sub: '' }
}
const route = ref(read())
const onHash = () => {
  route.value = read()
  window.scrollTo(0, 0)
}
onMounted(() => window.addEventListener('hashchange', onHash))
onBeforeUnmount(() => window.removeEventListener('hashchange', onHash))

const activeSubs = computed(() => store.subscriptions.filter((s) => s.status === 'active').length)

// ── Header bar (spec 007 S-15): where you are (the dashboard: its month and phase), search and
// notifications as drawn (not there yet → "not available yet"), and the light/dark switch (S-16).
const GROUP_OF: Record<string, 'groupOverview' | 'groupManage' | 'groupSettings'> = { home: 'groupOverview', subs: 'groupManage', pay: 'groupManage', events: 'groupManage', history: 'groupManage', settings: 'groupSettings', admin: 'groupSettings', dev: 'groupSettings' }
const crumbPage = computed(() => (route.value.page === 'settings'
  ? t(`settings.tabs.${['general', 'theme', 'ai', 'security'].includes(route.value.sub) ? route.value.sub : 'general'}` as MessageKey)
  : label(route.value.page)))
const tools = computed(() => !['settings', 'admin', 'dev'].includes(route.value.page))
const phase = computed(() => phaseAt(store.phases, view.ym))
const prefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { prefersDark.value = e.matches })
const dark = computed(() => store.preferences.themeMode === 'dark' || (store.preferences.themeMode === 'system' && prefersDark.value))
const flipTheme = () => savePreferences({ ...store.preferences, themeMode: dark.value ? 'light' : 'dark' }).catch(() => {})
const onSearch = (e: Event) => { e.preventDefault(); notReady('shell.search') }
const logout = () => authClient.signOut()
const version = __APP_VERSION__
const REPO = 'https://github.com/bluenyang/allot'

// ── Sidebar width and folding (spec 007 S-20): drag or arrow keys on the edge, double-click for the default.
const side = ref<HTMLElement | null>(null)
let dragging = false
let grab = 0 // where on the handle it was grabbed, so the edge does not jump to the pointer
const resizing = ref(false)
const onGripDown = (e: PointerEvent) => {
  if (e.button !== 0 || !side.value) return
  grab = sideWidth.value - (e.clientX - side.value.getBoundingClientRect().left)
  dragging = true
  resizing.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  document.body.classList.add('resizing')
}
const onGripMove = (e: PointerEvent) => {
  if (!dragging || !side.value) return
  setSideWidth(e.clientX - side.value.getBoundingClientRect().left + grab, false)
}
const onGripUp = () => {
  if (!dragging) return
  dragging = false
  resizing.value = false
  document.body.classList.remove('resizing')
  setSideWidth(sideWidth.value)
}
// A drag never outlives the handle: folding removes it, and leaving the shell ends it (review 22).
watch(sideFolded, () => onGripUp())
onBeforeUnmount(() => document.body.classList.remove('resizing'))
const onGripKey = (e: KeyboardEvent) => {
  const step = e.shiftKey ? 48 : 16
  const next = { ArrowLeft: sideWidth.value - step, ArrowRight: sideWidth.value + step, Home: SIDE.min, End: SIDE.max }[e.key]
  if (next === undefined) return
  e.preventDefault()
  setSideWidth(next)
}
</script>

<template>
  <div class="app" :class="{ folded: sideFolded, resizing }" :style="{ '--side-w': `${sideFolded ? SIDE.folded : sideWidth}px` }">
    <aside id="side" ref="side" class="side">
      <div class="brand">
        <span class="logo" aria-hidden="true">A</span><span class="bn"><b>Allot</b><small>{{ t('shell.tagline') }}</small></span>
        <button class="btn icon fold" type="button" :aria-label="sideFolded ? t('shell.foldOpen') : t('shell.foldClose')" :title="sideFolded ? t('shell.foldOpen') : t('shell.foldClose')"
          :aria-expanded="!sideFolded" aria-controls="side" @click="toggleSide"><Icon name="panel" /></button>
      </div>
      <nav :aria-label="t('shell.menu')" class="groups">
        <div v-for="g in groups" :key="g.id" class="grp">
          <span class="glabel">{{ g.id === 'overview' ? t('shell.groupOverview') : t('shell.groupManage') }}</span>
          <a v-for="id in g.items" :key="id" :href="'#' + id" :aria-current="route.page === id ? 'true' : 'false'" :title="sideFolded ? label(id) : undefined">
            <Icon :name="id" /><span class="grow lbl">{{ label(id) }}</span>
            <span v-if="id === 'subs'" class="ncount" :aria-label="t('shell.activeSubs', { n: activeSubs })">{{ activeSubs }}</span>
          </a>
        </div>
      </nav>
      <div class="lower">
        <nav :aria-label="t('shell.settingsMenu')">
          <a v-for="id in lower" :key="id" :href="'#' + id" :aria-current="route.page === id ? 'true' : 'false'" :title="sideFolded ? label(id) : undefined"><Icon :name="id" /><span class="lbl">{{ label(id) }}</span></a>
        </nav>
        <div v-if="me" class="who">
          <span class="ava" aria-hidden="true">{{ (me.name || me.email).slice(0, 1) }}</span>
          <span class="wn"><b>{{ me.name || me.email }}</b><small>{{ me.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser') }}</small></span>
          <button class="btn icon" type="button" :aria-label="t('shell.logout')" :title="t('shell.logout')" @click="logout"><Icon name="logout" /></button>
        </div>
        <button v-else class="logout" type="button" @click="logout">{{ t('shell.logout') }}</button>
      </div>
    </aside>
    <!-- On the sidebar's border line, outside its scroll box so the knob can straddle it (S-20) -->
    <div v-if="!sideFolded" class="grip" role="separator" aria-orientation="vertical" :aria-label="t('shell.sideWidth')" aria-controls="side" tabindex="0"
      :aria-valuemin="SIDE.min" :aria-valuemax="SIDE.max" :aria-valuenow="sideWidth" :title="t('shell.sideWidthHint')"
      @pointerdown="onGripDown" @pointermove="onGripMove" @pointerup="onGripUp" @pointercancel="onGripUp" @lostpointercapture="onGripUp" @keydown="onGripKey" @dblclick="setSideWidth(SIDE.default)"><span class="knob" aria-hidden="true"></span></div>

    <div class="col">
      <header class="topbar">
        <div v-if="route.page === 'home'" class="monthnav">
          <button class="btn icon" type="button" :aria-label="t('shell.prevMonth')" @click="view.ym = addYm(view.ym, -1)"><Icon name="prev" /></button>
          <span class="ml">{{ ymLabel(view.ym).replace('.', '. ') }}</span>
          <button class="btn icon" type="button" :aria-label="t('shell.nextMonth')" @click="view.ym = addYm(view.ym, 1)"><Icon name="next" /></button>
          <span class="phasebadge">{{ phase ? `${phase.label} · ${phase.name}` : t('shell.outOfPhase') }}</span>
        </div>
        <nav v-else class="crumbs" :aria-label="t('shell.here')"><span>{{ t(`shell.${GROUP_OF[route.page]}`) }}</span><Icon name="chev" /><b>{{ crumbPage }}</b></nav>
        <span class="sp"></span>
        <form v-if="tools" class="search" role="search" @submit="onSearch" @click="notReady('shell.search')">
          <Icon name="search" />
          <input type="search" :aria-label="t('shell.search')" :placeholder="t('shell.searchPlaceholder')" @focus="notReady('shell.search')">
          <kbd>/</kbd>
        </form>
        <button v-if="tools" class="btn icon tb" type="button" :aria-label="t('shell.notifications')" @click="notReady('shell.notifications')"><Icon name="bell" /><i class="dotn" aria-hidden="true"></i></button>
        <button class="btn icon tb" type="button" :aria-label="dark ? t('shell.toLight') : t('shell.toDark')" :title="dark ? t('shell.toLightShort') : t('shell.toDarkShort')" @click="flipTheme"><Icon :name="dark ? 'sun' : 'moon'" /></button>
      </header>
      <p v-if="view.notice" class="toast" role="status">{{ view.notice }}</p>
      <main class="main">
        <div class="mtop">
          <span class="logo" aria-hidden="true">A</span><b>Allot</b><span class="ver">v{{ version }}</span>
          <button class="acct" type="button" :aria-label="dark ? t('shell.toLight') : t('shell.toDark')" @click="flipTheme"><Icon :name="dark ? 'sun' : 'moon'" /></button>
          <a class="acct" href="#settings" :aria-label="t('shell.settingsLink')"><Icon name="settings" /></a>
          <button class="logout m" type="button" @click="logout">{{ t('shell.logout') }}</button>
        </div>
        <p v-if="status.error" class="save-err" role="alert">{{ status.error }} <button type="button" @click="status.error = ''">{{ t('common.close') }}</button></p>
        <KeepAlive><component :is="PAGES[route.page]!.comp" :key="route.page" v-bind="route.page === 'settings' ? { sub: route.sub } : {}" /></KeepAlive>
      </main>
      <footer class="foot-bar">
        <div class="fl"><b>Allot</b><span class="mono">v{{ version }}</span><span aria-hidden="true">·</span><span>{{ t('shell.footerTagline') }}</span></div>
        <nav :aria-label="t('shell.footerLabel')">
          <a :href="REPO" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a :href="REPO + '/releases'" target="_blank" rel="noopener noreferrer">{{ t('shell.changelog') }}</a>
          <a :href="REPO + '/issues'" target="_blank" rel="noopener noreferrer">{{ t('shell.issues') }}</a>
          <a href="#" @click.prevent="notReady('shell.apiDocs')">{{ t('shell.apiDocs') }}</a>
        </nav>
        <div class="where"><Icon name="security" /><span>{{ t('shell.dataNote') }}</span></div>
      </footer>
    </div>

    <nav class="botnav" :aria-label="t('shell.menu')">
      <a v-for="id in bottom" :key="id" :href="'#' + id" :aria-current="route.page === id ? 'true' : 'false'"><Icon :name="id" />{{ label(id) }}</a>
    </nav>
  </div>
</template>

<style scoped>
.bn{display:flex;flex-direction:column;line-height:1.25}
.bn small{font-size:11px;color:var(--subtle)}
.groups{display:flex !important;flex-direction:column;gap:18px}
.grp{display:grid;gap:2px}
.glabel{font-size:11px;font-weight:600;color:var(--subtle);padding:0 10px 6px;letter-spacing:.04em}
.grow{flex-grow:1}
.ncount{font-size:12px;color:var(--subtle);font-variant-numeric:tabular-nums}
.lower{margin-top:auto;display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--border);padding-top:12px}
.who{display:flex;align-items:center;gap:10px;padding:6px 4px 0 10px}
.ava{width:32px;height:32px;border-radius:var(--r-ctl);background:var(--fill);color:var(--text-2);display:grid;place-items:center;font-weight:600;font-size:13px;flex:none}
.wn{display:flex;flex-direction:column;min-width:0;flex:1}
.wn b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wn small{font-size:12px;color:var(--subtle)}
.who .btn{color:var(--muted)}
/* Sidebar width and folding (spec 007 S-20) */
.brand .fold{margin-left:auto;width:30px;height:30px;color:var(--muted);flex:none}
.brand .fold svg{width:18px;height:18px}
.grip{display:none}
@media (min-width:761px){
  .grip{display:block;position:fixed;top:0;bottom:0;left:calc(var(--side-w) - 5px);width:10px;cursor:col-resize;touch-action:none;z-index:35}
  .grip::after{content:"";position:absolute;top:0;bottom:0;left:4px;width:2px;background:transparent;transition:background .15s}
  /* the knob: shows the edge can be dragged (the user, after rc.2) */
  .knob{position:absolute;top:50%;left:50%;width:10px;height:44px;transform:translate(-50%,-50%);border-radius:5px;border:1px solid var(--border-strong);background:linear-gradient(var(--subtle),var(--subtle)) center/2px 18px no-repeat,var(--surface);box-shadow:0 1px 3px rgba(0,0,0,.08);transition:border-color .15s,background .15s;z-index:1}
  .grip:hover::after,.grip:focus-visible::after,.app.resizing .grip::after{background:var(--primary-text)}
  .grip:hover .knob,.grip:focus-visible .knob,.app.resizing .knob{border-color:var(--primary-text);background:linear-gradient(var(--primary-text),var(--primary-text)) center/2px 18px no-repeat,var(--surface)}
  .grip:focus-visible{outline:none}
}
:global(body.resizing){cursor:col-resize;user-select:none}
.folded .bn,.folded .glabel,.folded .ncount,.folded .wn{display:none}
.folded .lbl{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.folded .brand{flex-direction:column;gap:8px;padding:2px 0 10px}
.folded .brand .fold{margin-left:0}
.folded .groups{gap:10px}
.folded nav a{justify-content:center;padding:0;gap:0}
.folded .grp + .grp{border-top:1px solid var(--border);padding-top:10px}
.folded .who{flex-direction:column;padding:6px 0 0;gap:8px}
.col{display:flex;flex-direction:column;min-width:0;min-height:100vh;container:col / inline-size}
.topbar{display:none}
.topbar .sp{flex:1}
@media (min-width:761px){
  .topbar{display:flex;flex-wrap:nowrap;align-items:center;gap:12px;padding:12px var(--col-pad);min-height:61px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:30}
}
.crumbs{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--subtle)}
.crumbs svg{width:14px;height:14px}
.crumbs b{color:var(--text);font-weight:600}
.monthnav{display:flex;align-items:center;gap:4px;flex:0 1 auto;min-width:0}
.monthnav .btn{width:32px;height:32px;color:var(--muted);flex:none}
.monthnav .ml{font-weight:600;padding:0 10px;font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.phasebadge{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;margin-left:8px;font-size:12px;color:var(--muted);padding:2px 8px;border:1px solid var(--border);border-radius:var(--r-badge);background:var(--surface-2)}
.search{display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface-2);flex:0 20 300px;min-width:0;color:var(--subtle)}
.search svg{width:16px;height:16px;flex:none}
.search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text)}
.search:focus-within{border-color:var(--primary-text);box-shadow:0 0 0 3px var(--primary-soft)}
.search kbd{font:11px var(--f-mono);border:1px solid var(--border);border-radius:var(--r-badge);padding:0 5px;background:var(--surface)}
/* A narrow content column (small window or a wide sidebar): the hint goes first, then the box becomes its icon (review 22) */
@container col (max-width: 720px){ .search kbd{display:none} }
@container col (max-width: 600px){ .search{flex:none;width:36px;padding:0;justify-content:center;position:relative;cursor:pointer} .search input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none} }
.tb{width:36px;height:36px;position:relative;color:var(--muted);flex:none}
.tb svg{width:18px;height:18px}
.dotn{position:absolute;top:6px;right:7px;width:7px;height:7px;border-radius:50%;background:var(--accent);border:1.5px solid var(--surface)}
.toast{position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:80;margin:0;padding:8px 14px;border-radius:var(--r-ctl);background:var(--text);color:var(--surface);font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.18)}
.mtop .acct{background:var(--surface)}
.col .main{flex:1;width:100%}
.foot-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px;padding:16px max(16px,env(safe-area-inset-right,0px)) calc(96px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));border-top:1px solid var(--border);background:var(--surface);font-size:12px;color:var(--subtle)}
.foot-bar .fl{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.foot-bar .fl b{font-weight:700;color:var(--text)}
.foot-bar .fl .mono{font-size:12px}
.foot-bar nav{display:flex;gap:16px;flex-wrap:wrap}
.foot-bar a{color:var(--muted);text-decoration:none}
.foot-bar a:hover{text-decoration:underline}
.foot-bar .where{display:flex;align-items:center;gap:6px}
.foot-bar .where svg{width:14px;height:14px}
@media (min-width:761px){.foot-bar{padding:16px var(--col-pad)}}
@media (max-width:760px){.col .main{padding-bottom:16px}}
</style>
