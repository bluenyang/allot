<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Seg from '../components/Seg.vue'
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

const MODES = computed(() => [{ id: 'light', label: t('settings.general.light') }, { id: 'dark', label: t('settings.general.dark') }])
const RADII = computed(() => (['sharp', 'base', 'soft'] as const).map((id) => ({ id, label: t(`settingsTheme.radius.${id}` as MessageKey) })))
const DENSITIES = computed(() => (['base', 'compact'] as const).map((id) => ({ id, label: t(`settingsTheme.density.${id}` as MessageKey) })))
const AMOUNTS = computed(() => [
  { id: 'won', label: fmtAs(1_234_000, { ...store.preferences, amountUnit: 'won' }) },
  { id: 'man', label: fmtAs(123_400_000, { ...store.preferences, amountUnit: 'man' }) },
])

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
  <div class="cols thm">
    <form class="card colc" :aria-label="t('settingsTheme.form')" novalidate @submit.prevent="save">
      <div class="ch"><h2>{{ t('settingsTheme.cardTheme') }}</h2><span class="hint">{{ t('settingsTheme.previewOnlyShort') }}</span></div>
      <div class="fs">
        <div class="field"><span id="t-p" class="lbl">{{ t('settingsTheme.primary') }}</span>
          <div class="chips" role="radiogroup" aria-labelledby="t-p">
            <button v-for="[h, pid] in PRIMARY_PRESETS" :key="h" type="button" role="radio" class="chip" :class="{ on: primary === h }" :aria-checked="primary === h" @click="pickPrimary(h); custom = ''"><i :style="{ background: h }"></i>{{ presetName(pid) }}</button>
          </div>
          <div class="cust"><label for="t-hex" class="lbl">{{ t('settingsTheme.custom') }}</label>
            <input type="color" :value="isHex(custom) ? custom : primary" :aria-label="t('settingsTheme.pickColor')" @input="onCustom(($event.target as HTMLInputElement).value.toUpperCase())">
            <input id="t-hex" class="in hex" :value="custom || primary" placeholder="#RRGGBB" maxlength="7" :aria-label="t('settingsTheme.primaryHex')" :aria-invalid="custom !== '' && !isHex(custom)" @input="onCustom(($event.target as HTMLInputElement).value.trim())">
          </div>
          <span class="hint">{{ t('settingsTheme.primaryDesc') }}</span></div>
        <div class="field"><span id="t-a" class="lbl">{{ t('settingsTheme.accent') }}</span>
          <div class="chips" role="radiogroup" aria-labelledby="t-a">
            <button v-for="[h, pid] in ACCENT_PRESETS" :key="h" type="button" role="radio" class="chip" :class="{ on: accent === h }" :aria-checked="accent === h" @click="pickAccent(h)"><i :style="{ background: h }"></i>{{ presetName(pid) }}</button>
          </div>
          <span class="hint">{{ t('settingsTheme.accentDesc') }}</span></div>
        <div class="field"><span id="t-m" class="lbl">{{ t('settingsTheme.previewMode') }}</span>
          <Seg :options="MODES" :model-value="mode" labelledby="t-m" @update:model-value="mode = $event" />
          <i18n-t keypath="settingsTheme.previewModeDesc" tag="span" class="hint"><template #link><a href="#settings/general">{{ t('settings.tabs.general') }}</a></template></i18n-t></div>
        <div class="two">
          <div class="field"><span id="t-r" class="lbl">{{ t('settingsTheme.radiusTitle') }}</span>
            <Seg :options="RADII" :model-value="d.radius" labelledby="t-r" @update:model-value="d.radius = $event" />
            <span class="hint">{{ t('settingsTheme.radiusDesc') }}</span></div>
          <div class="field"><span id="t-d" class="lbl">{{ t('settingsTheme.densityTitle') }}</span>
            <Seg :options="DENSITIES" :model-value="d.density" labelledby="t-d" @update:model-value="d.density = $event" />
            <span class="hint">{{ t('settingsTheme.densityDesc') }}</span></div>
        </div>
        <div class="field"><span id="t-f" class="lbl">{{ t('settingsTheme.amountDisplay') }}</span>
          <Seg class="mono-seg" :options="AMOUNTS" :model-value="d.amountUnit" labelledby="t-f" @update:model-value="d.amountUnit = $event" />
          <span class="hint">{{ t('settingsTheme.amountDisplayDesc') }}</span></div>
      </div>
      <div class="cf"><span class="hint grow" role="status">{{ msg || t('settingsTheme.previewOnly') }}</span>
        <button class="btn sm" type="button" @click="reset">{{ t('settingsTheme.reset') }}</button>
        <button class="btn sm pri" type="submit" :disabled="busy || !dirty" :style="{ background: tokens.primary, borderColor: tokens.primary, color: tokens['primary-ink'] }">{{ t('common.save') }}</button></div>
    </form>

    <section class="card colc" :aria-label="t('settingsTheme.preview')">
      <div class="ch"><h2>{{ t('settingsTheme.previewMode2', { mode: modeName }) }}</h2></div>
      <div class="boxw">
      <div class="box" :style="boxStyle" role="img" :aria-label="t('settingsTheme.previewLabel', { mode: modeName })">
        <div class="bx-top"><span class="bx-logo">A</span><b>Allot</b></div>
        <div class="bx-tabs"><span class="on">{{ t('dashboard.tabMonth') }}</span><span>{{ t('dashboard.tabNext') }}</span><span>{{ t('dashboard.checks') }}</span></div>
        <div class="bx-kpi">
          <div><span>{{ t('settingsTheme.leftThisMonth') }}</span><b class="pr">{{ money(remainder) }}</b></div>
          <div><span>{{ t('dashboard.dueIn31') }}</span><b>{{ money(paysSum) }}</b></div>
        </div>
        <div class="bx-rows">
          <div v-for="(p, i) in pays.slice(0, 3)" :key="p.sub.id + p.date.getTime()"><span class="g">{{ p.sub.name }}</span><b>{{ money(p.krw) }}</b>
            <em :class="i === 0 ? 'a' : i === 2 ? 'p' : ''">{{ i === 2 && p.sub.verified ? t('subscriptions.verified') : `D-${p.dday}` }}</em></div>
        </div>
        <div class="bx-btns"><span class="pri">{{ t('common.save') }}</span><span class="sec">{{ t('common.cancel') }}</span><span class="acc">{{ t('settingsTheme.confirmBtn') }}</span></div>
        <p class="note">{{ t('settingsTheme.contrast') }}<template v-if="adjusted"> <i18n-t keypath="settingsTheme.adjusted" tag="span"><template #color><span class="mono">{{ adjusted }}</span></template></i18n-t></template></p>
      </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.thm{grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));align-items:start}
.colc{display:flex;flex-direction:column;gap:0}
.ch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)}
.ch h2{margin:0;font-size:15px;font-weight:600}
.fs .field{display:block}
.fs .lbl{display:block;font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px}
.fs .hint{display:block;margin-top:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip i{width:14px;height:14px;border-radius:50%;flex:none}
.cust{display:flex;align-items:center;gap:8px;margin-top:10px}
.cust .lbl{margin:0}
.cust input[type=color]{width:40px;height:40px;padding:2px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface)}
.hex{width:140px;height:40px;font:13px var(--f-mono)}
.hex[aria-invalid="true"]{border-color:var(--neg)}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.mono-seg :deep(button){font:500 12px var(--f-mono)}
.grow{flex-grow:1}
.boxw{display:flex;flex-direction:column;flex-grow:1}
.box{background:var(--bg);padding:18px;display:flex;flex-direction:column;gap:12px;color:var(--text);border-radius:0 0 var(--r-card) var(--r-card);flex-grow:1}
.bx-top{display:flex;align-items:center;gap:8px}
.bx-logo{width:26px;height:26px;border-radius:var(--r-ctl);background:var(--primary);color:var(--primary-ink);font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
.bx-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border)}
.bx-tabs span{padding:8px 12px;font-size:13px;font-weight:600;color:var(--muted)}
.bx-tabs span.on{color:var(--primary-text);box-shadow:inset 0 -2px 0 var(--primary-text)}
.bx-kpi{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.bx-kpi > div{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card);padding:12px 14px;display:flex;flex-direction:column}
.bx-kpi span{font-size:11px;color:var(--muted);font-weight:600}
.bx-kpi b{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.bx-kpi b.pr{color:var(--primary-text)}
.bx-rows{background:var(--surface);border:1px solid var(--border);border-radius:var(--r-card)}
.bx-rows > div{display:flex;align-items:center;gap:10px;padding:var(--row-pad) 14px;border-bottom:1px solid var(--border);font-size:13px}
.bx-rows > div:last-child{border-bottom:0}
.bx-rows .g{flex-grow:1}
.bx-rows b{font-weight:600;font-variant-numeric:tabular-nums}
.bx-rows em{font-style:normal;font-size:11px;font-weight:600;padding:1px 6px;border-radius:var(--r-badge);color:var(--muted)}
.bx-rows em.a{background:var(--accent);color:var(--accent-ink)}
.bx-rows em.p{background:var(--primary-soft);color:var(--primary-text)}
.bx-btns{display:flex;gap:8px}
.bx-btns span{height:34px;padding:0 14px;border-radius:var(--r-ctl);font-size:13px;font-weight:600;display:flex;align-items:center}
.bx-btns .pri{background:var(--primary);color:var(--primary-ink)}
.bx-btns .sec{border:1px solid var(--border);background:var(--surface);font-weight:500}
.bx-btns .acc{background:var(--accent);color:var(--accent-ink)}
.note{margin:0;font-size:12px;color:var(--muted)}
</style>
