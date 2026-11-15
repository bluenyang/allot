<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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

// Shell (spec 007 S-2): grouped sidebar with the user at the bottom, a footer on every page;
// on a phone a top bar and a bottom tab bar. Menus for features that do not exist yet are not here (S-3).
interface Page { id: string; label: string; comp: unknown; short?: string }
const PAGES: Record<string, Page> = {
  home: { id: 'home', label: '현황', comp: Dashboard },
  subs: { id: 'subs', label: '구독', comp: Subscriptions },
  pay: { id: 'pay', label: '월급 분배', comp: Payroll },
  events: { id: 'events', label: '일정', comp: Timeline },
  history: { id: 'history', label: '변경 내역', comp: History },
  settings: { id: 'settings', label: '설정', comp: Settings },
  admin: { id: 'admin', label: '관리', comp: Admin },
  dev: { id: 'dev', label: '개발', comp: Dev },
}
const groups = [
  { label: '개요', items: ['home'] },
  { label: '관리', items: ['subs', 'pay', 'events', 'history'] },
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
// notifications as drawn (not there yet → "준비 중"), and the light/dark switch (S-16).
const GROUP_OF: Record<string, string> = { home: '개요', subs: '관리', pay: '관리', events: '관리', history: '관리', settings: '설정', admin: '설정', dev: '설정' }
const SETTINGS_TAB: Record<string, string> = { general: '일반', theme: '테마', security: '로그인·보안' }
const crumbPage = computed(() => (route.value.page === 'settings' ? (SETTINGS_TAB[route.value.sub] ?? '일반') : PAGES[route.value.page]!.label))
const tools = computed(() => !['settings', 'admin', 'dev'].includes(route.value.page))
const phase = computed(() => phaseAt(store.phases, view.ym))
const prefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => { prefersDark.value = e.matches })
const dark = computed(() => store.preferences.themeMode === 'dark' || (store.preferences.themeMode === 'system' && prefersDark.value))
const flipTheme = () => savePreferences({ ...store.preferences, themeMode: dark.value ? 'light' : 'dark' }).catch(() => {})
const onSearch = (e: Event) => { e.preventDefault(); notReady('검색') }
const logout = () => authClient.signOut()
const version = __APP_VERSION__
const REPO = 'https://github.com/bluenyang/allot'
</script>

<template>
  <div class="app">
    <aside class="side">
      <div class="brand"><span class="logo" aria-hidden="true">A</span><span class="bn"><b>Allot</b><small>개인 재무 원장</small></span></div>
      <nav aria-label="메뉴" class="groups">
        <div v-for="g in groups" :key="g.label" class="grp">
          <span class="glabel">{{ g.label }}</span>
          <a v-for="id in g.items" :key="id" :href="'#' + id" :aria-current="route.page === id ? 'true' : 'false'">
            <Icon :name="id" /><span class="grow">{{ PAGES[id]!.label }}</span>
            <span v-if="id === 'subs'" class="ncount" :aria-label="`활성 ${activeSubs}개`">{{ activeSubs }}</span>
          </a>
        </div>
      </nav>
      <div class="lower">
        <nav aria-label="설정 메뉴">
          <a v-for="id in lower" :key="id" :href="'#' + id" :aria-current="route.page === id ? 'true' : 'false'"><Icon :name="id" />{{ PAGES[id]!.label }}</a>
        </nav>
        <div v-if="me" class="who">
          <span class="ava" aria-hidden="true">{{ (me.name || me.email).slice(0, 1) }}</span>
          <span class="wn"><b>{{ me.name || me.email }}</b><small>{{ me.role === 'admin' ? '관리자' : '사용자' }}</small></span>
          <button class="btn icon" type="button" aria-label="로그아웃" title="로그아웃" @click="logout"><Icon name="logout" /></button>
        </div>
        <button v-else class="logout" type="button" @click="logout">로그아웃</button>
      </div>
    </aside>

    <div class="col">
      <header class="topbar">
        <div v-if="route.page === 'home'" class="monthnav">
          <button class="btn icon" type="button" aria-label="이전 달" @click="view.ym = addYm(view.ym, -1)"><Icon name="prev" /></button>
          <span class="ml">{{ ymLabel(view.ym).replace('.', '. ') }}</span>
          <button class="btn icon" type="button" aria-label="다음 달" @click="view.ym = addYm(view.ym, 1)"><Icon name="next" /></button>
          <span class="phasebadge">{{ phase ? `${phase.label} · ${phase.name}` : '구간 밖' }}</span>
        </div>
        <nav v-else class="crumbs" aria-label="현재 위치"><span>{{ GROUP_OF[route.page] }}</span><Icon name="chev" /><b>{{ crumbPage }}</b></nav>
        <span class="sp"></span>
        <form v-if="tools" class="search" role="search" @submit="onSearch">
          <Icon name="search" />
          <input type="search" aria-label="검색" placeholder="거래, 구독, 메모 검색" @focus="notReady('검색')">
          <kbd>/</kbd>
        </form>
        <button v-if="tools" class="btn icon tb" type="button" aria-label="알림" @click="notReady('알림')"><Icon name="bell" /><i class="dotn" aria-hidden="true"></i></button>
        <button class="btn icon tb" type="button" :aria-label="dark ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'" :title="dark ? '라이트 모드로' : '다크 모드로'" @click="flipTheme"><Icon :name="dark ? 'sun' : 'moon'" /></button>
      </header>
      <p v-if="view.notice" class="toast" role="status">{{ view.notice }}</p>
      <main class="main">
        <div class="mtop">
          <span class="logo" aria-hidden="true">A</span><b>Allot</b><span class="ver">v{{ version }}</span>
          <button class="acct" type="button" :aria-label="dark ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기'" @click="flipTheme"><Icon :name="dark ? 'sun' : 'moon'" /></button>
          <a class="acct" href="#settings" aria-label="설정"><Icon name="settings" /></a>
          <button class="logout m" type="button" @click="logout">로그아웃</button>
        </div>
        <p v-if="status.error" class="save-err" role="alert">{{ status.error }} <button type="button" @click="status.error = ''">닫기</button></p>
        <KeepAlive><component :is="PAGES[route.page]!.comp" :key="route.page" v-bind="route.page === 'settings' ? { sub: route.sub } : {}" /></KeepAlive>
      </main>
      <footer class="foot-bar">
        <div class="fl"><b>Allot</b><span class="mono">v{{ version }}</span><span aria-hidden="true">·</span><span>셀프 호스팅 개인 재무 관리</span></div>
        <nav aria-label="바닥글">
          <a :href="REPO" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a :href="REPO + '/releases'" target="_blank" rel="noopener noreferrer">변경 기록</a>
          <a :href="REPO + '/issues'" target="_blank" rel="noopener noreferrer">문제 신고</a>
          <a href="#" @click.prevent="notReady('API 문서')">API 문서</a>
        </nav>
        <div class="where"><Icon name="security" /><span>데이터는 이 서버에만 저장됩니다 · 개발 BlueNyang</span></div>
      </footer>
    </div>

    <nav class="botnav" aria-label="메뉴">
      <a v-for="id in bottom" :key="id" :href="'#' + id" :aria-current="route.page === id ? 'true' : 'false'"><Icon :name="id" />{{ PAGES[id]!.label }}</a>
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
.col{display:flex;flex-direction:column;min-width:0;min-height:100vh}
.topbar{display:none}
.topbar .sp{flex:1}
@media (min-width:761px){
  .topbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 32px;min-height:61px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:30}
}
.crumbs{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--subtle)}
.crumbs svg{width:14px;height:14px}
.crumbs b{color:var(--text);font-weight:600}
.monthnav{display:flex;align-items:center;gap:4px}
.monthnav .btn{width:32px;height:32px;color:var(--muted)}
.monthnav .ml{font-weight:600;padding:0 10px;font-variant-numeric:tabular-nums}
.phasebadge{margin-left:8px;font-size:12px;color:var(--muted);padding:2px 8px;border:1px solid var(--border);border-radius:var(--r-badge);background:var(--surface-2)}
.search{display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface-2);width:300px;max-width:100%;color:var(--subtle)}
.search svg{width:16px;height:16px;flex:none}
.search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text)}
.search:focus-within{border-color:var(--primary-text);box-shadow:0 0 0 3px var(--primary-soft)}
.search kbd{font:11px var(--f-mono);border:1px solid var(--border);border-radius:var(--r-badge);padding:0 5px;background:var(--surface)}
.tb{width:36px;height:36px;position:relative;color:var(--muted)}
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
@media (min-width:761px){.foot-bar{padding:16px 32px}}
@media (max-width:760px){.col .main{padding-bottom:16px}}
</style>
