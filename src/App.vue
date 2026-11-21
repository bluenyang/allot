<script setup lang="ts">
import { computed, defineAsyncComponent, type AsyncComponentLoader, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SIDE, sideFolded, sideWidth, setSideWidth, toggleSide } from './lib/sidebar'
import Icon from './components/Icon.vue'
import MoreSheet from './components/MoreSheet.vue'
import Soon from './components/Soon.vue'
import Toast from './components/Toast.vue'
import PageLoadError from './components/PageLoadError.vue'
import Dashboard from './pages/Dashboard.vue'
import { api } from './lib/api'
import { status, store } from './lib/store'
import { toast, hideToast } from './lib/toast'
import { view } from './lib/view'
import { addYm, phaseAt, ymLabel } from './lib/calc'
import { authClient } from './lib/auth-client'
import { t, type MessageKey } from './i18n'
import { phaseTag } from './lib/labels'

// Shell (spec 010 S-4): a grouped sidebar with the user at the bottom, a header bar and a footer on
// every page; on a phone a top bar, a bottom bar and a "더보기" sheet. Menu entries for features that
// do not exist yet are `Soon` (S-3): shown, inert, with no route behind them.
// A page loaded on first open; if its code cannot be downloaded, say so and offer a reload.
const lazyPage = (loader: AsyncComponentLoader) =>
  defineAsyncComponent({ loader, errorComponent: PageLoadError, delay: 200 })
interface Page { id: string; comp: unknown }
const PAGES: Record<string, Page> = {
  // Only the dashboard is in the first chunk; every other page loads when it is first opened (spec 010 V-1, A-24).
  home: { id: 'home', comp: Dashboard },
  spend: { id: 'spend', comp: lazyPage(() => import('./pages/Spending.vue')) },
  pay: { id: 'pay', comp: lazyPage(() => import('./pages/Payroll.vue')) },
  events: { id: 'events', comp: lazyPage(() => import('./pages/Timeline.vue')) },
  pending: { id: 'pending', comp: lazyPage(() => import('./pages/Pending.vue')) },
  history: { id: 'history', comp: lazyPage(() => import('./pages/History.vue')) },
  settings: { id: 'settings', comp: lazyPage(() => import('./pages/Settings.vue')) },
  admin: { id: 'admin', comp: lazyPage(() => import('./pages/Admin.vue')) },
  dev: { id: 'dev', comp: lazyPage(() => import('./pages/Dev.vue')) }, // no menu entry: reached by the address #dev only
}
const label = (id: string) => t(`shell.pages.${id}` as MessageKey)
interface Entry { id: string; soon?: boolean }
const groups: { id: 'overview' | 'budget' | 'manage' | 'ai'; items: Entry[] }[] = [
  { id: 'overview', items: [{ id: 'home' }] },
  { id: 'budget', items: [{ id: 'pay' }, { id: 'living', soon: true }, { id: 'spend' }, { id: 'saving', soon: true }, { id: 'invest', soon: true }] },
  { id: 'manage', items: [{ id: 'events' }, { id: 'pending' }, { id: 'history' }] },
  { id: 'ai', items: [{ id: 'statements', soon: true }, { id: 'assistant', soon: true }] },
]
const GROUP_LABEL = { overview: 'shell.groupOverview', budget: 'shell.groupBudget', manage: 'shell.groupManage', ai: 'shell.groupAi' } as const

interface Me { name: string; email: string; role: string }
const me = ref<Me | null>(null)
onMounted(async () => {
  try { me.value = (await api<{ user: Me }>('GET', '/api/me')).user } catch { /* the shell works without it */ }
})
const isAdmin = computed(() => me.value?.role === 'admin')
/** The admin page shows for admins only; the server refuses everyone else anyway. */
const lower = computed(() => ['settings', ...(isAdmin.value ? ['admin'] : [])])

// Hash routes: #home, #spend/<tab>, …, #settings/<tab>. #account is kept as an alias of the
// login & security tab, because external-login linking returns to /#account (spec 007 S-12).
// #subs is kept too (spec 011 S-1): it shows the 지출 page on its 구독 tab and the address stays as typed.
const SPEND_TABS = ['general', 'inst', 'subs']
const read = () => {
  const [head = '', sub = ''] = location.hash.slice(1).split('?')[0]!.split('/')
  if (head === 'account') return { page: 'settings', sub: 'security' }
  if (head === 'subs') return { page: 'spend', sub: 'subs' }
  if (head === 'spend') return { page: 'spend', sub: SPEND_TABS.includes(sub) ? sub : 'general' }
  return PAGES[head] ? { page: head, sub } : { page: 'home', sub: '' }
}
const route = ref(read())
const onHash = () => {
  route.value = read()
  window.scrollTo(0, 0)
}
onMounted(() => window.addEventListener('hashchange', onHash))
onBeforeUnmount(() => window.removeEventListener('hashchange', onHash))

// ── Header bar (spec 010 S-4): where you are (the overview: its month and phase), search and
// notifications as drawn (not there yet → `Soon`). No light/dark switch: the theme is chosen in Settings (D-10).
const GROUP_OF: Record<string, MessageKey> = { spend: 'shell.groupBudget', pay: 'shell.groupBudget', events: 'shell.groupManage', pending: 'shell.groupManage', history: 'shell.groupManage', admin: 'shell.groupSystem', dev: 'shell.groupSystem' }
const crumbPage = computed(() => (route.value.page === 'settings'
  ? t(`settings.tabs.${['general', 'theme', 'ai', 'security'].includes(route.value.sub) ? route.value.sub : 'general'}` as MessageKey)
  : label(route.value.page)))
const spendTab = computed(() => t(`spending.tabs.${route.value.sub}` as MessageKey))
const phase = computed(() => phaseAt(store.phases, view.ym))
const soonName = (what: string) => `${what} (${t('common.soon')})`
const logout = () => authClient.signOut()
const version = __APP_VERSION__
const REPO = 'https://github.com/bluenyang/allot'

// ── Phone: the bottom bar and the "더보기" sheet (spec 010 S-4). The pending page has a place on the
// bar only while something waits there (spec 009 A-7); the budget slot opens the pay split, and
// stays current on the spending page too.
const bottom = computed(() => [
  { id: 'home', href: '#home', icon: 'home', label: t('shell.tabs.home'), on: route.value.page === 'home' },
  { id: 'budget', href: '#pay', icon: 'pay', label: t('shell.tabs.budget'), on: ['pay', 'spend'].includes(route.value.page) },
  { id: 'events', href: '#events', icon: 'events', label: t('shell.tabs.events'), on: route.value.page === 'events' },
  ...(store.pendingProposals ? [{ id: 'pending', href: '#pending', icon: 'pending', label: t('shell.tabs.pending'), on: route.value.page === 'pending', badge: store.pendingProposals }] : []),
])
const moreOpen = ref(false)
const moreOn = computed(() => ['history', 'settings', 'admin', 'dev'].includes(route.value.page))
watch(route, () => { moreOpen.value = false })
// The sheet is for the phone layout: it goes away when the window becomes wide.
const wide = window.matchMedia('(min-width: 761px)')
const onWide = (e: MediaQueryListEvent) => { if (e.matches) moreOpen.value = false }
onMounted(() => wide.addEventListener('change', onWide))
onBeforeUnmount(() => wide.removeEventListener('change', onWide))
const toastAction = () => { const f = toast.onAction; hideToast(); f?.() }

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
        <button class="fold" type="button" :aria-label="sideFolded ? t('shell.foldOpen') : t('shell.foldClose')" :title="sideFolded ? t('shell.foldOpen') : t('shell.foldClose')"
          :aria-expanded="!sideFolded" aria-controls="side" @click="toggleSide"><Icon name="panel" /></button>
      </div>
      <nav :aria-label="t('shell.menu')" class="groups">
        <div v-for="g in groups" :key="g.id" class="grp">
          <span class="glabel">{{ t(GROUP_LABEL[g.id]) }}</span>
          <template v-for="it in g.items" :key="it.id">
            <Soon v-if="it.soon" tag="div" class="ni" :title="sideFolded ? soonName(label(it.id)) : undefined"><Icon :name="it.id" /><span class="grow lbl">{{ label(it.id) }}</span></Soon>
            <a v-else class="ni" :href="'#' + it.id" :aria-current="route.page === it.id ? 'true' : 'false'" :title="sideFolded ? label(it.id) : undefined">
              <Icon :name="it.id" /><span class="grow lbl">{{ label(it.id) }}</span>
              <span v-if="it.id === 'pending' && store.pendingProposals" class="ncount badge" :aria-label="t('shell.pendingN', { n: store.pendingProposals })">{{ store.pendingProposals }}</span>
            </a>
          </template>
        </div>
      </nav>
      <div class="lower">
        <nav :aria-label="t('shell.settingsMenu')">
          <a v-for="id in lower" :key="id" class="ni" :href="'#' + id" :aria-current="route.page === id ? 'true' : 'false'" :title="sideFolded ? label(id) : undefined"><Icon :name="id" /><span class="lbl">{{ label(id) }}</span></a>
        </nav>
        <div class="who">
          <template v-if="me">
            <span class="ava" aria-hidden="true">{{ (me.name || me.email).slice(0, 1) }}</span>
            <span class="wn"><b>{{ me.name || me.email }}</b><small>{{ me.role === 'admin' ? t('shell.roleAdmin') : t('shell.roleUser') }}</small></span>
          </template>
          <button class="lo" type="button" :aria-label="t('shell.logout')" :title="t('shell.logout')" @click="logout"><Icon name="logout" :stroke="1.9" /></button>
        </div>
      </div>
    </aside>
    <!-- On the sidebar's border line, outside its scroll box so the knob can straddle it (S-20) -->
    <div v-if="!sideFolded" class="grip" role="separator" aria-orientation="vertical" :aria-label="t('shell.sideWidth')" aria-controls="side" tabindex="0"
      :aria-valuemin="SIDE.min" :aria-valuemax="SIDE.max" :aria-valuenow="sideWidth" :title="t('shell.sideWidthHint')"
      @pointerdown="onGripDown" @pointermove="onGripMove" @pointerup="onGripUp" @pointercancel="onGripUp" @lostpointercapture="onGripUp" @keydown="onGripKey" @dblclick="setSideWidth(SIDE.default)"><span class="knob" aria-hidden="true"></span></div>

    <div class="col">
      <div class="mbar">
        <span class="logo" aria-hidden="true">A</span>
        <b>{{ label(route.page) }}</b>
        <span class="sp"></span>
        <Soon class="tb" :pill="false" :aria-label="soonName(t('shell.search'))" :title="soonName(t('shell.search'))"><Icon name="search" :stroke="2" /></Soon>
        <Soon class="tb" :pill="false" :aria-label="soonName(t('shell.notifications'))" :title="soonName(t('shell.notifications'))"><Icon name="bell" /></Soon>
      </div>
      <header class="topbar">
        <div v-if="route.page === 'home'" class="monthnav">
          <button class="btn icon" type="button" :aria-label="t('shell.prevMonth')" @click="view.ym = addYm(view.ym, -1)"><Icon name="prev" :stroke="2" /></button>
          <span class="ml">{{ ymLabel(view.ym).replace('.', '. ') }}</span>
          <button class="btn icon" type="button" :aria-label="t('shell.nextMonth')" @click="view.ym = addYm(view.ym, 1)"><Icon name="next" :stroke="2" /></button>
          <span class="phasebadge">{{ phase ? phaseTag(store.phases, phase) : t('shell.outOfPhase') }}</span>
        </div>
        <nav v-else class="crumbs" :aria-label="t('shell.here')">
          <template v-if="route.page === 'settings'"><b>{{ label('settings') }}</b><span aria-hidden="true">/</span><span>{{ crumbPage }}</span></template>
          <template v-else-if="route.page === 'spend'"><span>{{ t(GROUP_OF.spend!) }}</span><span aria-hidden="true">/</span><b>{{ crumbPage }}</b><span aria-hidden="true">/</span><span>{{ spendTab }}</span></template>
          <template v-else><span>{{ t(GROUP_OF[route.page]!) }}</span><span aria-hidden="true">/</span><b>{{ crumbPage }}</b></template>
        </nav>
        <span class="sp"></span>
        <Soon class="search" :aria-label="soonName(t('shell.search'))">
          <Icon name="search" :stroke="2" /><span class="st">{{ t('shell.searchPlaceholder') }}</span><span class="kbds" aria-hidden="true"><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd></span>
        </Soon>
        <Soon class="tb" :pill="false" :aria-label="soonName(t('shell.notifications'))" :title="soonName(t('shell.notifications'))"><Icon name="bell" /></Soon>
      </header>
      <Toast v-if="toast.message" :message="toast.message" :action-label="toast.actionLabel || undefined" :error="toast.error" :dismissible="toast.error" @action="toastAction" @dismiss="hideToast" />
      <main class="main">
        <p v-if="status.error" class="save-err" role="alert">{{ status.error }} <button type="button" @click="status.error = ''">{{ t('common.close') }}</button></p>
        <KeepAlive><component :is="PAGES[route.page]!.comp" :key="route.page" v-bind="route.page === 'settings' || route.page === 'spend' ? { sub: route.sub } : {}" /></KeepAlive>
      </main>
      <footer class="foot-bar">
        <div class="fl"><b>Allot</b><span class="mono">v{{ version }}</span><span aria-hidden="true">·</span><span>{{ t('shell.footerTagline') }}</span></div>
        <nav :aria-label="t('shell.footerLabel')">
          <a :href="REPO" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a :href="REPO + '/releases'" target="_blank" rel="noopener noreferrer">{{ t('shell.changelog') }}</a>
          <a :href="REPO + '/issues'" target="_blank" rel="noopener noreferrer">{{ t('shell.issues') }}</a>
          <Soon tag="span" class="fsoon">{{ t('shell.apiDocs') }}</Soon>
        </nav>
        <div class="where">{{ t('shell.dataNote') }}</div>
      </footer>
    </div>

    <nav class="botnav" :aria-label="t('shell.menu')">
      <a v-for="it in bottom" :key="it.id" class="mi" :href="it.href" :aria-current="it.on ? 'true' : 'false'">
        <Icon :name="it.icon" />{{ it.label }}<span v-if="it.badge" class="b" :aria-label="t('shell.pendingN', { n: it.badge })">{{ it.badge }}</span>
      </a>
      <button class="mi" :class="{ on: moreOn }" type="button" aria-haspopup="dialog" :aria-expanded="moreOpen" @click="moreOpen = true"><Icon name="more" />{{ t('shell.tabs.more') }}</button>
    </nav>
    <MoreSheet v-model="moreOpen" :name="me?.name ?? ''" :email="me?.email ?? ''" :admin="isAdmin" :pending="store.pendingProposals" @logout="logout" />
  </div>
</template>

<style scoped>
.bn{display:flex;flex-direction:column;line-height:1.25}
.bn small{font-size:11px;color:var(--subtle)}
.grow{flex-grow:1}
.wn{display:flex;flex-direction:column;min-width:0;flex:1}
.wn b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wn small{font-size:12px;color:var(--subtle)}
/* Sidebar width and folding (spec 007 S-20) */
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
.col{display:flex;flex-direction:column;min-width:0;min-height:100vh;container:col / inline-size}
.topbar{display:none}
.topbar .sp,.mbar .sp{flex:1}
@media (min-width:761px){
  .topbar{display:flex;flex-wrap:nowrap;align-items:center;gap:12px;padding:12px var(--col-pad);min-height:61px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:30}
}
.crumbs{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--subtle)}
.crumbs b{color:var(--text);font-weight:700}
.monthnav{display:flex;align-items:center;gap:4px;flex:0 1 auto;min-width:0}
.monthnav .btn{width:32px;height:30px;color:var(--text);flex:none;border-color:var(--border-strong)}
.monthnav .btn svg{width:16px;height:16px}
.monthnav .ml{font-weight:700;padding:0 10px;font-variant-numeric:tabular-nums;white-space:nowrap;flex:none}
.phasebadge{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;margin-left:8px;font-size:12px;color:var(--muted);padding:2px 8px;border:1px solid var(--border);border-radius:var(--r-badge);background:var(--surface-2)}
/* search box and bell: drawn as in the design, inert for now (`Soon`) */
.search{display:flex;align-items:center;gap:8px;height:36px;padding:0 8px 0 10px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface-2);flex:0 20 320px;min-width:0;max-width:100%;color:var(--subtle);overflow:hidden}
.search:hover{background:var(--surface-2);color:var(--subtle)}
.search svg{width:16px;height:16px;flex:none}
.search .st{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.search .kbds{display:inline-flex;gap:3px;flex:none}
/* A narrow content column (small window or a wide sidebar): the hints (keys, 준비 중 pill) go first, then the box becomes its icon (review 22) */
@container col (max-width: 720px){ .search .kbds,.search :deep(.soon-pill){display:none} }
@container col (max-width: 600px){ .search{flex:none;width:36px;padding:0;justify-content:center} .search .st,.search :deep(.soon-pill){display:none} }
.tb{display:grid;place-items:center;width:36px;height:36px;padding:0;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface);color:var(--text-2);flex:none}
.tb:hover{background:var(--surface);color:var(--text-2)}
.tb svg{width:18px;height:18px}
.col .main{flex:1;width:100%}
.foot-bar .fsoon{color:var(--subtle)}
@media (max-width:760px){.col .main{padding-bottom:16px}}
</style>
