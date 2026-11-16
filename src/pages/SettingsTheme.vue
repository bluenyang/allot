<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { savePreferences, store } from '../lib/store'
import { ACCENT_PRESETS, DEFAULT_ACCENT, DEFAULT_PRIMARY, PRIMARY_PRESETS, derive, isHex } from '../lib/theme'
import { money as fmtAs } from '../lib/format'
import { distributionAt, upcomingPayments, today, ymOf } from '../lib/calc'
import type { Preferences } from '../data/types'
import { t, type MessageKey } from '../i18n'

// 설정 › 테마 (spec 007 S-7): colours, corners and density. Until 저장 only the preview box shows
// the choice; the preview mode (light/dark) is for the box only — the real mode is in 일반.
type Draft = Pick<Preferences, 'primary' | 'accent' | 'radius' | 'density' | 'amountUnit'>
const fromStore = (): Draft => ({ primary: store.preferences.primary, accent: store.preferences.accent, radius: store.preferences.radius, density: store.preferences.density, amountUnit: store.preferences.amountUnit })
const d = ref<Draft>(fromStore())
/** The saved values the draft started from (review 1 R6): follow saved changes unless the user edited. */
const base = ref<Draft>(fromStore())
const dirty = computed(() => JSON.stringify(d.value) !== JSON.stringify(base.value))
watch(() => JSON.stringify(fromStore()), () => {
  if (!dirty.value) d.value = fromStore()
  base.value = fromStore()
})

const primary = computed(() => d.value.primary ?? DEFAULT_PRIMARY)
const accent = computed(() => d.value.accent ?? DEFAULT_ACCENT)
const custom = ref(isHex(primary.value) && !PRIMARY_PRESETS.some(([h]) => h === primary.value) ? primary.value : '')
const pickPrimary = (h: string) => { d.value.primary = h === DEFAULT_PRIMARY ? null : h.toUpperCase() }
const pickAccent = (h: string) => { d.value.accent = h === DEFAULT_ACCENT ? null : h.toUpperCase() }
function onCustom(v: string) {
  custom.value = v
  if (isHex(v)) pickPrimary(v)
}

const presetName = (id: string) => t(`settingsTheme.preset.${id}` as MessageKey)
const mode = ref<'light' | 'dark'>(document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
const modeName = computed(() => t(mode.value === 'dark' ? 'settings.general.dark' : 'settings.general.light'))
const GROUND = {
  light: { bg: '#F5F6F5', surface: '#FFFFFF', 'surface-2': '#F9FAF9', fill: '#EEF0EF', border: '#E2E5E3', 'border-strong': '#CBD0CD', text: '#16201B', muted: '#47534D', subtle: '#5F6B65', divider: '#EEF0EF' },
  dark: { bg: '#111315', surface: '#1A1C1F', 'surface-2': '#1F2124', fill: '#26292D', border: '#2F3337', 'border-strong': '#43484E', text: '#E6E8EA', muted: '#A2A8AE', subtle: '#8E959C', divider: '#26292D' },
}
const RADIUS = { sharp: ['2px', '3px'], base: ['4px', '6px'], soft: ['8px', '10px'] }
const tokens = computed(() => derive(primary.value, accent.value, mode.value))
const boxStyle = computed(() => {
  const all: Record<string, string> = { ...GROUND[mode.value], ...tokens.value }
  const v = Object.fromEntries(Object.entries(all).map(([k, x]) => [`--${k}`, x]))
  const [ctl, card] = RADIUS[d.value.radius]
  return { ...v, '--r-ctl': ctl, '--r-card': card, '--row-pad': d.value.density === 'compact' ? '7px' : '11px', colorScheme: mode.value }
})
/** The text colour actually used when the chosen colour was too light or too dark for text. */
const adjusted = computed(() => {
  const t = tokens.value['primary-text']!
  const expected = mode.value === 'light' ? primary.value.toUpperCase() : null
  return expected && t !== expected ? t : null
})

// The preview box shows the user's own numbers.
const now = today()
const pays = computed(() => upcomingPayments(store.subscriptions, store.planChanges, store.settings, now, 31))
const remainder = computed(() => distributionAt(ymOf(now), store.settings.netPay, store.phases, store.targets, store.living, store.subscriptions, store.planChanges, store.settings).remainder)
const paysSum = computed(() => pays.value.reduce((a, p) => a + p.krw, 0))
/** Amounts in the preview follow the draft's 금액 표시. */
const money = (n: number) => fmtAs(n, { ...store.preferences, amountUnit: d.value.amountUnit })

const msg = ref('')
const busy = ref(false)
async function save() {
  busy.value = true
  msg.value = ''
  try {
    await savePreferences({ ...store.preferences, ...d.value })
    d.value = fromStore()
    base.value = fromStore()
    msg.value = t('settings.general.saved')
  } catch (e) {
    msg.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
function reset() {
  d.value = { primary: null, accent: null, radius: 'base', density: 'base', amountUnit: 'won' }
  custom.value = ''
  msg.value = ''
}
</script>

<template>
  <div class="thm">
    <form class="card form-card" :aria-label="t('settingsTheme.form')" novalidate @submit.prevent="save">
      <div class="srow">
        <div class="lt"><h2 id="t-p">{{ t('settingsTheme.primary') }}</h2><p>{{ t('settingsTheme.primaryDesc') }}</p></div>
        <div class="rt col">
          <div class="sw" role="group" aria-labelledby="t-p">
            <button v-for="[h, pid] in PRIMARY_PRESETS" :key="h" type="button" :aria-pressed="primary === h" :aria-label="presetName(pid)" @click="pickPrimary(h); custom = ''">
              <i :style="{ background: h }"><svg v-if="primary === h" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg></i><span>{{ presetName(pid) }}</span></button>
          </div>
          <label class="cust">{{ t('settingsTheme.custom') }}
            <input type="color" :value="isHex(custom) ? custom : primary" :aria-label="t('settingsTheme.pickColor')" @input="onCustom(($event.target as HTMLInputElement).value.toUpperCase())">
            <input id="t-hex" class="hex" :value="custom || primary" placeholder="#RRGGBB" maxlength="7" :aria-label="t('settingsTheme.primaryHex')" :aria-invalid="custom !== '' && !isHex(custom)" @input="onCustom(($event.target as HTMLInputElement).value.trim())">
          </label>
        </div>
      </div>
      <div class="srow">
        <div class="lt"><h2 id="t-a">{{ t('settingsTheme.accent') }}</h2><p>{{ t('settingsTheme.accentDesc') }}</p></div>
        <div class="rt">
          <div class="sw" role="group" aria-labelledby="t-a">
            <button v-for="[h, pid] in ACCENT_PRESETS" :key="h" type="button" :aria-pressed="accent === h" :aria-label="presetName(pid)" @click="pickAccent(h)">
              <i :style="{ background: h }"><svg v-if="accent === h" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg></i><span>{{ presetName(pid) }}</span></button>
          </div>
        </div>
      </div>
      <div class="srow">
        <div class="lt"><h2 id="t-m">{{ t('settingsTheme.previewMode') }}</h2><i18n-t keypath="settingsTheme.previewModeDesc" tag="p"><template #link><a href="#settings/general">{{ t('settings.tabs.general') }}</a></template></i18n-t></div>
        <div class="rt"><div class="seg wide" role="group" aria-labelledby="t-m">
          <button type="button" :aria-pressed="mode === 'light'" @click="mode = 'light'">{{ t('settings.general.light') }}</button>
          <button type="button" :aria-pressed="mode === 'dark'" @click="mode = 'dark'">{{ t('settings.general.dark') }}</button>
        </div></div>
      </div>
      <div class="srow">
        <div class="lt"><h2 id="t-r">{{ t('settingsTheme.radiusTitle') }}</h2><p>{{ t('settingsTheme.radiusDesc') }}</p></div>
        <div class="rt"><div class="seg wide" role="group" aria-labelledby="t-r">
          <button v-for="id in ['sharp', 'base', 'soft'] as const" :key="id" type="button" :aria-pressed="d.radius === id" @click="d.radius = id">{{ t(`settingsTheme.radius.${id}`) }}</button>
        </div></div>
      </div>
      <div class="srow">
        <div class="lt"><h2 id="t-d">{{ t('settingsTheme.densityTitle') }}</h2><p>{{ t('settingsTheme.densityDesc') }}</p></div>
        <div class="rt"><div class="seg wide" role="group" aria-labelledby="t-d">
          <button v-for="id in ['base', 'compact'] as const" :key="id" type="button" :aria-pressed="d.density === id" @click="d.density = id">{{ t(`settingsTheme.density.${id}`) }}</button>
        </div></div>
      </div>
      <div class="srow last">
        <div class="lt"><h2 id="t-f">{{ t('settingsTheme.amountDisplay') }}</h2><p>{{ t('settingsTheme.amountDisplayDesc') }}</p></div>
        <div class="rt"><div class="seg wide" role="group" aria-labelledby="t-f">
          <button type="button" :aria-pressed="d.amountUnit === 'won'" @click="d.amountUnit = 'won'">{{ fmtAs(1_234_000, { ...store.preferences, amountUnit: 'won' }) }}</button>
          <button type="button" :aria-pressed="d.amountUnit === 'man'" @click="d.amountUnit = 'man'">{{ fmtAs(123_400_000, { ...store.preferences, amountUnit: 'man' }) }}</button>
        </div></div>
      </div>
      <div class="savebar">
        <span class="grow small subtle" role="status">{{ msg || t('settingsTheme.previewOnly') }}</span>
        <button class="btn" type="button" @click="reset">{{ t('settingsTheme.reset') }}</button>
        <button class="btn pri" type="submit" :disabled="busy || !dirty">{{ t('common.save') }}</button>
      </div>
    </form>

    <section class="pv" :aria-label="t('settingsTheme.preview')">
      <span class="pvl">{{ t('settingsTheme.previewMode2', { mode: modeName }) }}</span>
      <div class="box" :style="boxStyle" role="img" :aria-label="t('settingsTheme.previewLabel', { mode: modeName })">
        <div class="bx-top"><span class="bx-logo">A</span><b>Allot</b></div>
        <div class="bx-tabs"><span class="on">{{ t('dashboard.tabMonth') }}</span><span>{{ t('dashboard.tabNext') }}</span><span>{{ t('dashboard.checks') }}</span></div>
        <div class="bx-kpi">
          <div class="hl"><span>{{ t('settingsTheme.leftThisMonth') }}</span><b>{{ money(remainder) }}</b></div>
          <div><span>{{ t('dashboard.dueIn31') }}</span><b>{{ money(paysSum) }}</b></div>
        </div>
        <div class="bx-rows">
          <div v-for="(p, i) in pays.slice(0, 3)" :key="p.sub.id + p.date.getTime()"><span class="g">{{ p.sub.name }}</span><b>{{ money(p.krw) }}</b>
            <em :class="i === 0 ? 'a' : i === 2 ? 'p' : ''">{{ i === 2 && p.sub.verified ? t('subscriptions.verified') : `D-${p.dday}` }}</em></div>
        </div>
        <div class="bx-btns"><span class="pri">{{ t('common.save') }}</span><span class="sec">{{ t('common.cancel') }}</span><span class="acc">{{ t('settingsTheme.confirmBtn') }}</span></div>
      </div>
      <p class="small subtle">{{ t('settingsTheme.contrast') }}<template v-if="adjusted"> <i18n-t keypath="settingsTheme.adjusted" tag="span"><template #color><span class="mono">{{ adjusted }}</span></template></i18n-t></template></p>
    </section>
  </div>
</template>

<style scoped>
.thm{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.form-card{flex:3 1 520px}
.srow{display:flex;flex-wrap:wrap;gap:12px 32px;padding:20px;border-bottom:1px solid var(--divider)}
.srow.last{border-bottom:0}
.lt{flex:1 1 180px;display:flex;flex-direction:column;gap:2px}
.lt h2{margin:0;font-size:14px;font-weight:600}
.lt p{margin:0;font-size:12px;color:var(--subtle)}
.rt{flex:2 1 320px;display:flex;flex-wrap:wrap;gap:10px;min-width:0;align-items:flex-start}
.rt.col{flex-direction:column}
.sw{display:flex;flex-wrap:wrap;gap:10px}
.sw button{display:flex;flex-direction:column;align-items:center;gap:6px;width:64px;padding:6px 0;border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--surface);cursor:pointer}
.sw button[aria-pressed="true"]{border-color:var(--text)}
.sw i{width:36px;height:28px;border-radius:var(--r-badge);display:flex;align-items:center;justify-content:center;color:#fff}
.sw i svg{width:16px;height:16px}
.sw span{font-size:11px;color:var(--muted)}
.cust{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.cust input[type=color]{width:30px;height:30px;padding:2px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface)}
.hex{width:96px;height:30px;padding:0 8px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);font:12px var(--f-mono);color:var(--text);background:var(--surface)}
.hex[aria-invalid="true"]{border-color:var(--neg)}
.seg.wide button{min-width:76px;padding:0 14px;height:36px;font-weight:600;font-size:13px}
.savebar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 20px;border-top:1px solid var(--border);background:var(--surface-2);border-radius:0 0 var(--r-card) var(--r-card)}
.grow{flex-grow:1}
.pv{flex:2 1 360px;min-width:0;display:flex;flex-direction:column;gap:8px}
.pvl{font-size:12px;font-weight:600;color:var(--muted)}
.pv p{margin:0}
.box{background:var(--bg);border:1px solid var(--border);border-radius:var(--r-card);padding:16px;display:flex;flex-direction:column;gap:12px;color:var(--text)}
.bx-top{display:flex;align-items:center;gap:8px}
.bx-logo{width:22px;height:22px;border-radius:var(--r-ctl);background:var(--primary);color:var(--primary-ink);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
.bx-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border)}
.bx-tabs span{padding:8px 12px;font-size:13px;font-weight:600;color:var(--muted)}
.bx-tabs span.on{color:var(--primary-text);background:var(--primary-soft);box-shadow:inset 0 -2px 0 var(--primary-text);border-radius:var(--r-ctl) var(--r-ctl) 0 0}
.bx-kpi{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.bx-kpi > div{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);padding:12px;display:flex;flex-direction:column}
.bx-kpi > div.hl{background:var(--primary);color:var(--primary-ink);border-color:var(--primary)}
.bx-kpi span{font-size:11px;opacity:.85}
.bx-kpi > div:not(.hl) span{color:var(--muted);opacity:1}
.bx-kpi b{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.bx-rows{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card)}
.bx-rows > div{display:flex;align-items:center;gap:10px;padding:var(--row-pad) 12px;border-bottom:1px solid var(--border);font-size:13px}
.bx-rows > div:last-child{border-bottom:0}
.bx-rows .g{flex-grow:1}
.bx-rows b{font-weight:600;font-variant-numeric:tabular-nums}
.bx-rows em{font-style:normal;font-size:11px;font-weight:600;padding:1px 6px;border-radius:var(--r-badge);color:var(--muted)}
.bx-rows em.a{background:var(--accent-soft);color:var(--accent-text)}
.bx-rows em.p{background:var(--primary-soft);color:var(--primary-text)}
.bx-btns{display:flex;gap:8px}
.bx-btns span{height:34px;padding:0 14px;border-radius:var(--r-ctl);font-size:13px;font-weight:600;display:flex;align-items:center}
.bx-btns .pri{background:var(--primary);color:var(--primary-ink)}
.bx-btns .sec{border:1px solid var(--border);background:var(--surface);font-weight:400}
.bx-btns .acc{background:var(--accent);color:var(--accent-ink)}
</style>
