import { createApp } from 'vue'
import Root from './Root.vue'
import './style.css'
import { applyTheme, cachedTheme } from './lib/theme'
import { i18n } from './i18n'
import { router } from './router'

// First paint in the colours this browser used last (the server's settings follow, Root.vue).
const cached = cachedTheme()
if (cached) applyTheme(cached)

void import('./fonts')
// The router is installed before sign-in, so the app opens on the address it was opened with (spec 012).
createApp(Root).use(i18n).use(router).mount('#app')
