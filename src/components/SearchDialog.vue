<script setup lang="ts">
// Search (spec 013 S-19, canvas AppHome "검색"): a modal on Reka's Dialog over a dimmed page. It finds rows in the
// state the app already has (src/lib/search.ts: name and memo, any part, case-insensitive) and the menus by name,
// grouped by kind. ↑ ↓ move, Enter or a click opens the row's page, Esc closes; focus goes back to the opener.
// The pages have no "open this row's editor" address yet, so a result opens its page (and tab) only.
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { t, type MessageKey } from '../i18n'
import { fold, foldQuery, markParts, search, SEARCH_KINDS, type SearchKind } from '../lib/search'
import { store } from '../lib/store'

const props = defineProps<{ modelValue: boolean; admin: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [open: boolean] }>()
const router = useRouter()
const q = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null

/** The menus by name (the sidebar's pages), with the page they open. */
const MENU: [string, string][] = [
  ['home', '/'], ['income', '/income'], ['pay', '/pay'], ['living', '/living'], ['spend', '/spend/general'], ['saving', '/saving'], ['invest', '/invest'],
  ['events', '/events'], ['pending', '/pending'], ['history', '/history'], ['settings', '/settings/general'],
]

interface Item { key: string; kind: SearchKind | 'menu'; name: string; note: string; field: 'name' | 'note'; path: string }
const items = computed<Item[]>(() => {
  const hits: Item[] = search(store, q.value).map((h) => ({ key: `${h.kind}:${h.id}`, kind: h.kind, name: h.name, note: h.note, field: h.field, path: h.path }))
  const fq = foldQuery(q.value)
  if (fq) {
    for (const [id, path] of [...MENU, ...(props.admin ? [['admin', '/admin'] as [string, string]] : [])]) {
      const name = t(`shell.pages.${id}` as MessageKey)
      if (fold(name).includes(fq)) hits.push({ key: `menu:${id}`, kind: 'menu', name, note: '', field: 'name', path })
    }
  }
  return hits
})
const groups = computed(() => [...SEARCH_KINDS, 'menu' as const]
  .map((kind) => ({ kind, rows: items.value.map((it, i) => ({ it, i })).filter((x) => x.it.kind === kind) }))
  .filter((g) => g.rows.length))
watch(q, () => { active.value = 0 })

const close = () => emit('update:modelValue', false)
function go(it: Item | undefined) {
  if (!it) return
  close()
  void router.push(it.path)
}
async function move(by: number) {
  const n = items.value.length
  if (!n) return
  active.value = (active.value + by + n) % n
  await nextTick()
  list.value?.querySelector<HTMLElement>(`#sr-${active.value}`)?.scrollIntoView({ block: 'nearest' })
}
function onKey(e: KeyboardEvent) {
  if (e.isComposing) return // a Korean syllable still being typed: Enter and the arrows belong to the input method
  if (e.key === 'ArrowDown') { e.preventDefault(); void move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); void move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); go(items.value[active.value]) }
}

// Reka calls this before it moves the focus: the active element is still the opener.
function opened() {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  q.value = ''
  active.value = 0
  void nextTick(() => input.value?.focus())
}
function closed() {
  if (opener?.isConnected) opener.focus()
}
const optId = (i: number) => `sr-${i}`
</script>

<template>
  <DialogRoot :open="props.modelValue" @update:open="(o: boolean) => !o && close()">
    <DialogPortal>
      <div v-if="props.modelValue" class="dlg-layer srch-layer">
        <DialogOverlay class="dlg-ov" />
        <DialogContent class="srch dlg" :aria-describedby="undefined" @open-auto-focus.prevent="opened" @close-auto-focus.prevent="closed">
          <DialogTitle class="sr-only">{{ t('shell.search') }}</DialogTitle>
          <label class="sq">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input ref="input" v-model="q" type="search" role="combobox" aria-autocomplete="list" aria-controls="sr-list" :aria-expanded="items.length > 0"
              :aria-activedescendant="items.length ? optId(active) : undefined" :aria-label="t('shell.searchInput')" :placeholder="t('shell.searchDialogPh')" autocomplete="off" spellcheck="false" @keydown="onKey">
            <kbd class="kbd ph-hide">Esc</kbd>
          </label>
          <div id="sr-list" ref="list" class="sres" role="listbox" :aria-label="t('shell.search')">
            <p v-if="!foldQuery(q)" class="hint sempty">{{ t('shell.searchStart') }}</p>
            <p v-else-if="!items.length" class="hint sempty" role="status">{{ t('shell.searchEmpty', { q: q.trim() }) }}</p>
            <div v-for="g in groups" :key="g.kind" role="group" :aria-labelledby="`sg-${g.kind}`">
              <div :id="`sg-${g.kind}`" class="sg">{{ t(`shell.searchKinds.${g.kind}` as MessageKey) }}</div>
              <div v-for="{ it, i } in g.rows" :id="optId(i)" :key="it.key" class="sopt" role="option" :aria-selected="i === active" @click="go(it)" @mousemove="active = i">
                <span class="si" aria-hidden="true">{{ t(`shell.searchKinds.${it.kind}` as MessageKey).slice(0, 1) }}</span>
                <span class="sx">
                  <b><template v-for="(p, k) in it.field === 'name' ? markParts(it.name, q) : [{ text: it.name, hit: false }]" :key="k"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></b>
                  <small v-if="it.field === 'note'" class="hint">{{ t('shell.searchMemo') }} · <template v-for="(p, k) in markParts(it.note, q)" :key="k"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></small>
                </span>
                <kbd v-if="i === active" class="kbd ph-hide" aria-hidden="true">Enter</kbd>
              </div>
            </div>
          </div>
          <div class="sfoot ph-hide" aria-hidden="true">
            <span><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> {{ t('shell.searchMove') }}</span>
            <span><kbd class="kbd">Enter</kbd> {{ t('shell.searchGo') }}</span>
            <span><kbd class="kbd">Esc</kbd> {{ t('shell.searchClose') }}</span>
            <span class="sany"><kbd class="kbd">Ctrl</kbd><kbd class="kbd">K</kbd> {{ t('shell.searchAnywhere') }} <kbd class="kbd">⌘</kbd><kbd class="kbd">K</kbd></span>
          </div>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.srch-layer{display:flex;justify-content:center;align-items:flex-start;padding:96px 16px}
.srch{position:relative;z-index:1;width:640px;max-width:100%;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden;outline:none}
.srch .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.srch .sq{display:flex;align-items:center;gap:10px;padding:0 16px;height:56px;border-bottom:1px solid var(--border);color:var(--text-2)}
.srch .sq svg{width:18px;height:18px;flex:none}
.srch .sq input{flex:1;min-width:0;border:0;outline:0;background:transparent;font-size:16px;color:var(--text)}
.srch .sres{padding:8px;max-height:420px;overflow:auto}
.srch .sempty{margin:0;padding:12px 10px}
.srch .sg{padding:12px 10px 4px;font-size:11px;font-weight:600;color:var(--subtle);letter-spacing:.04em}
.srch .sres > div:first-of-type .sg{padding-top:8px}
.srch .sopt{display:flex;align-items:center;gap:12px;min-height:44px;padding:8px 10px;border-radius:var(--r-card);cursor:pointer}
.srch .sopt[aria-selected="true"]{background:var(--primary-soft)}
.srch .si{width:28px;height:28px;flex:none;border-radius:var(--r-ctl);background:var(--fill);color:var(--text-2);display:grid;place-items:center;font-size:12px;font-weight:700}
.srch .sopt[aria-selected="true"] .si{background:var(--surface);color:var(--primary-text)}
.srch .sx{flex:1;min-width:0;display:flex;flex-direction:column}
.srch .sx b,.srch .sx small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srch .sx small{font-size:12px}
.srch mark{background:var(--accent-soft);color:inherit;border-radius:2px}
.srch .sfoot{display:flex;flex-wrap:wrap;gap:14px;padding:10px 16px;border-top:1px solid var(--border);font-size:12px;color:var(--text-2)}
.srch .sfoot span{display:inline-flex;align-items:center;gap:4px}
.srch .sfoot .sany{margin-left:auto}
@media (max-width:760px){
  .srch-layer{padding:12px 8px}
  .srch .sq{height:48px}
  .srch .ph-hide{display:none}
}
</style>
