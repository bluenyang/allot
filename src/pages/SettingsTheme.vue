<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { savePreferences, store } from '../lib/store'
import { ACCENT_PRESETS, DEFAULT_ACCENT, DEFAULT_PRIMARY, PRIMARY_PRESETS, derive, isHex } from '../lib/theme'
import { fmtMoney } from '../lib/display'
import { upcomingPayments, today, transferAt, ymOf } from '../lib/calc'
import type { Preferences } from '../data/types'

// 설정 › 테마 (spec 007 S-7): colours, corners and density. Until 저장 only the preview box shows
// the choice; the preview mode (light/dark) is for the box only — the real mode is in 일반.
type Draft = Pick<Preferences, 'primary' | 'accent' | 'radius' | 'density'>
const fromStore = (): Draft => ({ primary: store.preferences.primary, accent: store.preferences.accent, radius: store.preferences.radius, density: store.preferences.density })
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

const mode = ref<'light' | 'dark'>(document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
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
const xfer = computed(() => transferAt(store.subscriptions, store.planChanges, store.settings, ymOf(now)))

const msg = ref('')
const busy = ref(false)
async function save() {
  busy.value = true
  msg.value = ''
  try {
    await savePreferences({ ...store.preferences, ...d.value })
    d.value = fromStore()
    base.value = fromStore()
    msg.value = '저장했어요.'
  } catch (e) {
    msg.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
function reset() {
  d.value = { primary: null, accent: null, radius: 'base', density: 'base' }
  custom.value = ''
  msg.value = ''
}
</script>

<template>
  <div class="thm">
    <form class="panel" aria-label="테마 설정" novalidate @submit.prevent="save">
      <div class="blk">
        <b id="t-p">주 색상</b><span class="hint">버튼, 선택된 메뉴와 탭, 강조 숫자</span>
        <div class="sw" role="radiogroup" aria-labelledby="t-p">
          <button v-for="[h, label] in PRIMARY_PRESETS" :key="h" type="button" role="radio" :aria-checked="primary === h" :aria-label="label" @click="pickPrimary(h); custom = ''">
            <i :style="{ background: h }"></i><span>{{ label }}</span></button>
        </div>
        <div class="cust">
          <label for="t-hex">직접 입력</label>
          <input id="t-color" type="color" :value="isHex(custom) ? custom : primary" aria-label="색 고르기" @input="onCustom(($event.target as HTMLInputElement).value.toUpperCase())">
          <input id="t-hex" class="in mono" :value="custom" placeholder="#RRGGBB" maxlength="7" :aria-invalid="custom !== '' && !isHex(custom)" @input="onCustom(($event.target as HTMLInputElement).value.trim())">
        </div>
      </div>
      <div class="blk">
        <b id="t-a">포인트 색상</b><span class="hint">곧 다가오는 결제, 확인 필요</span>
        <div class="sw" role="radiogroup" aria-labelledby="t-a">
          <button v-for="[h, label] in ACCENT_PRESETS" :key="h" type="button" role="radio" :aria-checked="accent === h" :aria-label="label" @click="pickAccent(h)">
            <i :style="{ background: h }"></i><span>{{ label }}</span></button>
        </div>
      </div>
      <div class="blk">
        <b id="t-m">미리보기 모드</b><span class="hint">색을 라이트·다크에서 비교해요. 실제 테마는 일반 탭에서 정해요</span>
        <div class="seg" role="group" aria-labelledby="t-m">
          <button type="button" :aria-pressed="mode === 'light'" @click="mode = 'light'">라이트</button>
          <button type="button" :aria-pressed="mode === 'dark'" @click="mode = 'dark'">다크</button>
        </div>
      </div>
      <div class="blk">
        <b id="t-r">모서리</b><span class="hint">카드, 버튼, 입력칸의 둥근 정도</span>
        <div class="seg" role="group" aria-labelledby="t-r">
          <button v-for="[id, label] in ([['sharp', '각지게'], ['base', '기본'], ['soft', '부드럽게']] as const)" :key="id" type="button" :aria-pressed="d.radius === id" @click="d.radius = id">{{ label }}</button>
        </div>
      </div>
      <div class="blk">
        <b id="t-d">밀도</b><span class="hint">표와 목록의 줄 간격</span>
        <div class="seg" role="group" aria-labelledby="t-d">
          <button v-for="[id, label] in ([['base', '기본'], ['compact', '촘촘하게']] as const)" :key="id" type="button" :aria-pressed="d.density === id" @click="d.density = id">{{ label }}</button>
        </div>
      </div>
      <p class="small muted">글자 대비가 4.5:1보다 낮아지는 색은 자동으로 진하게(다크에서는 밝게) 바꿔 써요.<template v-if="adjusted"> 이 색은 글자에 <span class="mono">{{ adjusted }}</span>을 써요.</template></p>
      <div class="btns">
        <button class="btn" type="button" @click="reset">기본값으로</button>
        <span class="sp"></span>
        <span class="small muted" role="status">{{ msg || (dirty ? '저장 전까지는 미리보기에만 적용돼요.' : '') }}</span>
        <button class="btn pri" type="submit" :disabled="busy || !dirty">저장</button>
      </div>
    </form>

    <div class="box" :style="boxStyle" role="img" :aria-label="`테마 미리보기, ${mode === 'dark' ? '다크' : '라이트'}`">
      <div class="bx-side"><span class="logo">A</span><b>Allot</b>
        <span class="bx-nav on">현황</span><span class="bx-nav">구독</span><span class="bx-nav">월급 분배</span></div>
      <div class="bx-main">
        <div class="subtabs"><button type="button" tabindex="-1" aria-selected="true">이번 달</button><button type="button" tabindex="-1">예정</button><button type="button" tabindex="-1">확인할 것 <span class="cnt acc">2</span></button></div>
        <div class="strip">
          <div class="hl"><span class="l">구독 이체</span><span class="v">{{ fmtMoney(xfer.transfer) }}</span></div>
          <div><span class="l">31일 내 결제</span><span class="v">{{ fmtMoney(pays.reduce((a, p) => a + p.krw, 0)) }}</span></div>
        </div>
        <div class="tbl"><table><tbody>
          <tr v-for="p in pays.slice(0, 3)" :key="p.sub.id + p.date.getTime()"><td>{{ p.sub.name }}</td><td class="n">{{ fmtMoney(p.krw) }}</td>
            <td><span class="pill" :class="p.dday <= 3 ? 'warn' : 'ok'">D-{{ p.dday }}</span></td></tr>
        </tbody></table></div>
        <div class="btns"><button class="btn pri" type="button" tabindex="-1">저장</button><button class="btn" type="button" tabindex="-1">취소</button><button class="btn acc" type="button" tabindex="-1">확인</button></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thm{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
@media (min-width:1180px){.thm{grid-template-columns:minmax(0,1fr) 520px}.box{position:sticky;top:20px}}
.blk{display:grid;gap:4px;padding:14px 0;border-top:1px solid var(--divider)}
.blk:first-child{border-top:0;padding-top:0}
.blk b{font-weight:600}
.hint{font-size:12px;color:var(--subtle)}
.blk .seg{justify-self:start;margin-top:6px}
.sw{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.sw button{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;min-width:64px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-ctl);cursor:pointer;color:var(--muted);font-size:12px}
.sw button[aria-checked="true"]{border-color:var(--text);color:var(--text);font-weight:600;box-shadow:0 0 0 1px var(--text)}
.sw i{width:40px;height:28px;border-radius:var(--r-badge)}
.cust{display:flex;align-items:center;gap:8px;margin-top:10px}
.cust label{font-size:12px;font-weight:600;color:var(--text-2)}
.cust input[type=color]{width:40px;height:36px;padding:2px;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface)}
.cust .in{width:120px}
.sp{flex:1}
.box{border:1px solid var(--border);border-radius:var(--r-card);overflow:hidden;display:grid;grid-template-columns:130px minmax(0,1fr);background:var(--bg);color:var(--text);font-size:13px;min-height:360px}
.bx-side{background:var(--surface);border-right:1px solid var(--border);padding:12px 8px;display:flex;flex-direction:column;gap:4px}
.bx-side .logo{width:24px;height:24px;font-size:12px;margin-bottom:2px}
.bx-side b{font-size:13px;margin-bottom:8px}
.bx-nav{padding:6px 8px;border-radius:var(--r-ctl);color:var(--muted);font-weight:500}
.bx-nav.on{background:var(--primary-soft);color:var(--primary-text);font-weight:600}
.bx-main{padding:12px;min-width:0}
.bx-main .subtabs{margin-bottom:12px}
.bx-main .subtabs button{height:34px;padding:0 10px;pointer-events:none}
.bx-main .strip{grid-template-columns:1fr 1fr;margin-bottom:12px}
.bx-main .strip > div{padding:10px 12px}
.bx-main .strip .v{font-size:18px}
.bx-main .btns .btn{pointer-events:none}
@media (max-width:520px){.box{grid-template-columns:minmax(0,1fr)}.bx-side{display:none}}
</style>
