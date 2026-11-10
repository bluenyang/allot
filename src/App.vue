<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './components/Icon.vue'
import Dashboard from './pages/Dashboard.vue'
import Subscriptions from './pages/Subscriptions.vue'
import Payroll from './pages/Payroll.vue'
import Timeline from './pages/Timeline.vue'
import Dev from './pages/Dev.vue'
import { status, store } from './lib/store'
import { authClient } from './lib/auth-client'
import { man, phaseAt, today, ymOf } from './lib/calc'

const pages = [
  { id: 'home', label: '현황', comp: Dashboard },
  { id: 'subs', label: '구독', comp: Subscriptions },
  { id: 'pay', label: '분배', comp: Payroll },
  { id: 'events', label: '일정', comp: Timeline },
  { id: 'dev', label: '개발', comp: Dev },
]
const ids = pages.map((p) => p.id)
const read = () => {
  const h = location.hash.slice(1)
  return ids.includes(h) ? h : 'home'
}
const page = ref(read())
const onHash = () => {
  page.value = read()
  window.scrollTo(0, 0)
}
onMounted(() => window.addEventListener('hashchange', onHash))
onBeforeUnmount(() => window.removeEventListener('hashchange', onHash))
const phase = computed(() => phaseAt(store.phases, ymOf(today())))
const logout = () => authClient.signOut()
</script>

<template>
  <div class="app">
    <aside class="side">
      <div class="brand"><span class="logo">A</span><b>Allot</b></div>
      <nav aria-label="메뉴">
        <a v-for="p in pages" :key="p.id" :href="'#' + p.id" :aria-current="page === p.id ? 'true' : 'false'"><Icon :name="p.id" />{{ p.label }}</a>
      </nav>
      <div class="foot">
        <span>월 실수령</span>
        <span class="big">{{ man(store.settings.netPay) }}</span>
        <span v-if="phase">{{ phase.label }} {{ phase.name }}</span>
        <span>v0.1 · PostgreSQL 저장</span>
        <button class="logout" type="button" @click="logout">로그아웃</button>
      </div>
    </aside>

    <main class="main">
      <div class="mtop"><span class="logo">A</span><b>Allot</b><span class="ver">v0.1</span><button class="logout m" type="button" @click="logout">로그아웃</button></div>
      <p v-if="status.error" class="save-err" role="alert">{{ status.error }} <button type="button" @click="status.error = ''">닫기</button></p>
      <KeepAlive><component :is="pages.find((p) => p.id === page)!.comp" /></KeepAlive>
    </main>

    <nav class="botnav" aria-label="메뉴">
      <a v-for="p in pages" :key="p.id" :href="'#' + p.id" :aria-current="page === p.id ? 'true' : 'false'"><Icon :name="p.id" />{{ p.label }}</a>
    </nav>
  </div>
</template>
