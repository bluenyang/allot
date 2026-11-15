/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const c: DefineComponent<{}, {}, any>
  export default c
}

/** package.json version, set by Vite at build time (spec 007 S-2, footer). */
declare const __APP_VERSION__: string
