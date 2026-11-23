<script setup lang="ts">
// The bell (spec 013 S-20, canvas AppHome "알림 팝오버"): a button with the unread count and a 400px popover on
// Reka's Popover with the computed notifications (src/lib/notices.ts), a kind filter and "모두 읽음". Opening a
// notification marks it read and goes to its page; read marks stay in this browser (src/lib/notice-store.ts).
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '../i18n'
import { ymLabel } from '../lib/calc'
import { fmtDate, fmtMoney } from '../lib/display'
import { isRead, markAllRead, markRead, notices, unread } from '../lib/notice-store'
import type { Notice, NoticeGroup } from '../lib/notices'
import Icon from './Icon.vue'

const open = ref(false)
const router = useRouter()
const GROUPS = ['all', 'pending', 'pay', 'budget'] as const
const filter = ref<(typeof GROUPS)[number]>('all')
const shown = computed(() => notices.value.filter((n) => filter.value === 'all' || n.group === filter.value))
const ICON: Record<NoticeGroup, string> = { pending: 'pending', pay: 'money', budget: 'pay' }

const dday = (n: number) => (n <= 0 ? t('shell.noticeToday') : t('shell.noticeDday', { n }))
function text(n: Notice): { title: string; body: string } {
  switch (n.kind) {
    case 'proposals': return { title: t('shell.notice.proposalsTitle', { n: n.count }), body: t('shell.notice.proposalsBody') }
    case 'goals': return { title: t('shell.notice.goalsTitle', { n: n.count }), body: t('shell.notice.goalsBody') }
    case 'maturities': return { title: t('shell.notice.maturitiesTitle', { n: n.count }), body: t('shell.notice.maturitiesBody') }
    case 'charge': return { title: t('shell.notice.chargeTitle', { name: n.name, dday: dday(n.dday) }), body: t('shell.notice.chargeBody', { date: fmtDate(n.date), amount: fmtMoney(n.amount) }) }
    case 'round': return { title: t('shell.notice.roundTitle', { name: n.name, round: n.round, of: n.of, dday: dday(n.dday) }), body: t('shell.notice.roundBody', { date: fmtDate(n.date), amount: fmtMoney(n.amount) }) }
    case 'remainderShort': return { title: t('shell.notice.remainderTitle', { month: ymLabel(n.month) }), body: t('shell.notice.remainderBody', { amount: fmtMoney(-n.remainder) }) }
    case 'yearLimit': return {
      title: n.over ? t('shell.notice.limitOverTitle', { name: n.name }) : t('shell.notice.limitNearTitle', { name: n.name, pct: Math.floor((n.contribution / n.limit) * 100) }),
      body: t('shell.notice.limitBody', { year: n.year, contribution: fmtMoney(n.contribution), limit: fmtMoney(n.limit) }),
    }
    case 'bufferShort': return { title: t('shell.notice.bufferTitle', { name: n.name }), body: t('shell.notice.bufferBody', { buffer: fmtMoney(n.buffer), used: fmtMoney(n.used), left: fmtMoney(-n.left) }) }
  }
}
function pick(n: Notice) {
  markRead(n.id)
  open.value = false
  void router.push(n.path)
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger class="tb bell" type="button" :aria-label="t('shell.noticeBell', { n: unread })" :title="t('shell.notifications')">
      <Icon name="bell" /><span v-if="unread" class="bn" aria-hidden="true">{{ unread > 99 ? '99+' : unread }}</span>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="npop" role="dialog" :aria-label="t('shell.notifications')" side="bottom" align="end" :side-offset="8" :collision-padding="8">
        <div class="nh">
          <b>{{ t('shell.notifications') }}</b>
          <button class="btn sm ghost" type="button" :disabled="!unread" @click="markAllRead">{{ t('shell.noticeReadAll') }}</button>
        </div>
        <div class="seg nseg" role="group" :aria-label="t('shell.noticeFilter')">
          <button v-for="g in GROUPS" :key="g" type="button" :aria-pressed="filter === g" @click="filter = g">{{ t(`shell.noticeGroups.${g}`) }}</button>
        </div>
        <p v-if="!shown.length" class="hint nempty">{{ t('shell.noticeEmpty') }}</p>
        <ul v-else class="nlist">
          <li v-for="n in shown" :key="n.id">
            <button type="button" class="nrow" :class="{ unread: !isRead(n.id) }" @click="pick(n)">
              <span class="ni" :class="n.group" aria-hidden="true"><Icon :name="ICON[n.group]" /></span>
              <span class="nx"><b>{{ text(n).title }}</b><small>{{ text(n).body }}</small></span>
              <span v-if="!isRead(n.id)" class="dot" role="img" :aria-label="t('shell.noticeUnread')"></span>
            </button>
          </li>
        </ul>
        <p class="nfoot hint">{{ t('shell.noticeFoot') }}</p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
/* the shell's 36px tool button (App.vue's .tb, which is scoped there) */
.tb.bell{position:relative;display:grid;place-items:center;width:36px;height:36px;padding:0;border:1px solid var(--border-strong);border-radius:var(--r-ctl);background:var(--surface);color:var(--text-2);flex:none;cursor:pointer}
.tb.bell:hover,.tb.bell[data-state="open"]{background:var(--surface-2);color:var(--text)}
.tb.bell svg{width:18px;height:18px}
.tb.bell .bn{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:700;line-height:18px;text-align:center;border:2px solid var(--surface);box-sizing:content-box}
.npop{z-index:55;width:400px;max-width:calc(100vw - 16px);max-height:min(560px,calc(100dvh - 80px));display:flex;flex-direction:column;border:1px solid var(--border-strong);border-radius:var(--r-pop);background:var(--surface);color:var(--text);box-shadow:var(--shadow-pop);overflow:hidden;outline:none}
.npop .nh{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)}
.npop .nh b{flex:1;font-size:15px}
.npop .nh .btn{color:var(--primary-text)}
.npop .nseg{margin:10px 14px 4px;align-self:flex-start;flex:none}
.npop .nseg button{height:28px;font-size:12px;padding:0 10px}
.npop .nempty{margin:0;padding:16px 14px}
.npop .nlist{list-style:none;margin:0;padding:4px 0;overflow-y:auto}
.npop .nrow{display:flex;gap:12px;width:100%;padding:10px 14px;border:0;background:none;color:var(--text);text-align:left;cursor:pointer;font:inherit}
.npop .nrow:hover{background:var(--surface-2)}
.npop .nrow.unread{background:var(--surface-2)}
.npop .ni{width:30px;height:30px;flex:none;border-radius:var(--r-ctl);display:grid;place-items:center;background:var(--fill);color:var(--text-2)}
.npop .ni svg{width:16px;height:16px}
.npop .ni.pending{background:var(--accent-soft);color:var(--accent-text)}
.npop .ni.pay{background:var(--primary-soft);color:var(--primary-text)}
.npop .ni.budget{background:var(--info-soft);color:var(--info-text)}
.npop .nx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.npop .nx b{font-size:13px}
.npop .nx small{font-size:12px;color:var(--text-2)}
.npop .dot{width:8px;height:8px;margin-top:6px;border-radius:50%;background:var(--accent);flex:none}
.npop .nfoot{margin:0;padding:10px 14px;border-top:1px solid var(--border);font-size:12px;flex:none}
</style>
