import { createApp } from 'vue'
import Root from './Root.vue'
import './style.css'
import { applyTheme, cachedTheme } from './lib/theme'

// First paint in the colours this browser used last (the server's settings follow, Root.vue).
const cached = cachedTheme()
if (cached) applyTheme(cached)

void import('./fonts')
createApp(Root).mount('#app')
