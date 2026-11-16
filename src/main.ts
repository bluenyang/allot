import { createApp } from 'vue'
import Root from './Root.vue'
import './style.css'
import { applyTheme, cachedTheme } from './lib/theme'
import { i18n } from './i18n'

// First paint in the colours this browser used last (the server's settings follow, Root.vue).
const cached = cachedTheme()
if (cached) applyTheme(cached)

void import('./fonts')
createApp(Root).use(i18n).mount('#app')
