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
import { status, store } from './lib/store'
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
      <main class="main">
        <div class="mtop">
          <span class="logo" aria-hidden="true">A</span><b>Allot</b><span class="ver">v{{ version }}</span>
          <a class="acct" href="#settings" aria-label="설정"><Icon name="settings" /></a>
          <button class="logout m" type="button" @click="logout">로그아웃</button>
        </div>
        <p v-if="status.error" class="save-err" role="alert">{{ status.error }} <button type="button" @click="status.error = ''">닫기</button></p>
        <KeepAlive><component :is="PAGES[route.page]!.comp" :key="route.page" v-bind="route.page === 'settings' ? { sub: route.sub } : {}" /></KeepAlive>
      </main>
      <footer class="foot-bar">
        <span><b>Allot</b> v{{ version }} · 셀프 호스팅 개인 재무 관리</span>
        <nav aria-label="프로젝트 링크">
          <a :href="REPO" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a :href="REPO + '/blob/master/CHANGELOG.md'" target="_blank" rel="noopener noreferrer">변경 기록</a>
          <a :href="REPO + '/issues'" target="_blank" rel="noopener noreferrer">문제 신고</a>
        </nav>
        <span class="where">데이터는 이 서버에만 저장됩니다 · 개발 BlueNyang</span>
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
.col .main{flex:1;width:100%}
.foot-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:14px max(16px,env(safe-area-inset-right,0px)) calc(96px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));border-top:1px solid var(--border);background:var(--surface);font-size:12px;color:var(--subtle)}
.foot-bar b{color:var(--text-2)}
.foot-bar nav{display:flex;gap:14px;flex-wrap:wrap}
.foot-bar a{color:var(--muted)}
.foot-bar .where{margin-left:auto}
@media (min-width:900px){.foot-bar{padding:14px 32px}}
@media (max-width:899px){.col .main{padding-bottom:16px}.foot-bar .where{margin-left:0}}
</style>
