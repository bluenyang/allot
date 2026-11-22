// Routes (spec 012 S-1): history addresses with the names the hash addresses had. The shell (App.vue)
// shows the matched page inside <KeepAlive>, keyed by `meta.page` (a page, not a tab, as before).
import { defineAsyncComponent, type AsyncComponentLoader, type Component } from 'vue'
import { createRouter, createWebHistory, type LocationQuery, type RouteRecordRaw } from 'vue-router'
import PageLoadError from './components/PageLoadError.vue'
import Dashboard from './pages/Dashboard.vue'
import { loadSpendingMessages } from './i18n/spending'
import { fromOldHash } from './lib/old-hash'

declare module 'vue-router' {
  interface RouteMeta { page?: string }
}

// A page loaded on first open; if its code cannot be downloaded, say so and offer a reload. Kept as an
// async component (not a lazy route), so a failed download shows PageLoadError instead of failing the
// navigation (spec 012 S-4, spec 010 A-24).
const lazyPage = (loader: AsyncComponentLoader) =>
  defineAsyncComponent({ loader, errorComponent: PageLoadError, delay: 200 })

/** Every page by id. Only the dashboard is in the first chunk (spec 010 V-1, A-24). */
export const PAGES: Record<string, Component> = {
  home: Dashboard,
  spend: lazyPage(() => loadSpendingMessages().then(() => import('./pages/Spending.vue'))),
  pay: lazyPage(() => import('./pages/Payroll.vue')),
  events: lazyPage(() => import('./pages/Timeline.vue')),
  pending: lazyPage(() => import('./pages/Pending.vue')),
  history: lazyPage(() => import('./pages/History.vue')),
  settings: lazyPage(() => import('./pages/Settings.vue')),
  admin: lazyPage(() => import('./pages/Admin.vue')),
  dev: lazyPage(() => import('./pages/Dev.vue')), // no menu entry: reached by its address only
}

const keepQuery = (path: string) => (to: { query: LocationQuery }) => ({ path, query: to.query })
const page = (id: string, path = `/${id}`): RouteRecordRaw => ({ path, component: PAGES[id]!, meta: { page: id } })
const tabbed = (id: string, tabs: string, first: string): RouteRecordRaw[] => [
  { path: `/${id}/:tab(${tabs})`, component: PAGES[id]!, meta: { page: id }, props: (r) => ({ sub: r.params.tab }) },
  // no tab or an unknown one: the first tab's address
  { path: `/${id}/:rest(.*)*`, redirect: keepQuery(`/${id}/${first}`) },
]

export const routes: RouteRecordRaw[] = [
  page('home', '/'),
  { path: '/home', redirect: keepQuery('/') },
  page('pay'),
  ...tabbed('spend', 'general|inst|subs', 'general'),
  page('events'),
  page('pending'),
  page('history'),
  ...tabbed('settings', 'general|theme|ai|security', 'general'),
  page('admin'),
  page('dev'),
  // an unknown address shows the overview, as an unknown hash did
  { path: '/:rest(.*)*', redirect: keepQuery('/') },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  // Case matters, as it did in the hash addresses: /spend/SUBS is not the 구독 tab (review 1 F-3).
  sensitive: true,
  // Every change of page or tab starts at the top, as every hash change did (back and forward too).
  scrollBehavior: () => ({ top: 0 }),
})

// An old hash address (#settings/ai, #subs?add, /?error=…#account, …) becomes its new address, in
// place of the one in the history (spec 012 S-2). The query before the hash is kept (an auth error).
router.beforeEach((to) => {
  const next = fromOldHash(to.hash)
  if (!next) return true
  return { path: next.path, query: { ...to.query, ...next.query }, hash: '', replace: true }
})
