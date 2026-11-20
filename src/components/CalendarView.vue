<script setup lang="ts">
// Month calendar (spec 007 S-11): FullCalendar draws, our code decides the dates (calendar-events.ts).
// Loaded only where a calendar is open (defineAsyncComponent), so other pages never fetch it.
// On a phone the same events show as a list.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FullCalendar from '@fullcalendar/vue3'
import type { CalendarOptions, EventInput } from '@fullcalendar/vue3'
import classicTheme from '@fullcalendar/vue3/themes/classic'
import dayGridPlugin from '@fullcalendar/vue3/daygrid'
import listPlugin from '@fullcalendar/vue3/list'
import koLocale from '@fullcalendar/vue3/locales/ko'
import '@fullcalendar/vue3/skeleton.css'
import '@fullcalendar/vue3/themes/classic/theme.css'
import { calendarEvents, holidayEvents, kindLabel } from '../lib/calendar-events'
import { lang, t } from '../i18n'
import type { HolidaySet } from '../data/types'
import { store } from '../lib/store'

// source 'schedule': everything the schedule page shows, as a month grid whose header strip and month
// (`month`, YYYY-MM) belong to the page (ScheduleCalendar); 'holidays': only the holidays of `sets` (settings preview,
// with FullCalendar's own toolbar and, on a phone, its list).
const props = defineProps<{ source: 'schedule' | 'holidays'; sets?: HolidaySet[]; initialDate?: string; label?: string; month?: string }>()
const own = computed(() => props.source === 'schedule')
const build = (from: string, to: string) => (props.source === 'holidays' ? holidayEvents(props.sets ?? [], from, to) : calendarEvents(from, to))

const narrow = ref(false)
let mq: MediaQueryList | null = null
const onMq = () => { narrow.value = !!mq?.matches }
onMounted(() => { mq = window.matchMedia('(max-width: 760px)'); onMq(); mq.addEventListener('change', onMq) })
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))

// The pages stay alive (KeepAlive), so a change saved elsewhere — a holiday set turned off, a pay
// day moved, a subscription added — must redraw the events of the calendar that is already open.
const cal = ref<InstanceType<typeof FullCalendar> | null>(null)
watch(
  () => [store.settings, store.holidaySets, store.subscriptions, store.planChanges, store.preferences],
  () => cal.value?.getApi().refetchEvents(),
  { deep: true },
)

const dowClass = (dow: number) => (dow === 6 ? 'is-sat' : dow === 0 ? 'is-sun' : '')
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// The page moves the month; the grid follows.
watch(() => props.month, (m) => { if (m) cal.value?.getApi().gotoDate(`${m}-01`) })

const list = computed(() => narrow.value && !own.value)
const options = computed<CalendarOptions>(() => ({
  plugins: [classicTheme, dayGridPlugin, listPlugin],
  locale: lang.value === 'ko' ? koLocale : undefined, // FullCalendar's own default is English
  initialView: list.value ? 'listMonth' : 'dayGridMonth',
  initialDate: own.value && props.month ? `${props.month}-01` : props.initialDate,
  headerToolbar: own.value ? false : { start: 'title', center: '', end: 'prev,today,next' },
  // The day number alone (the Korean format would add 일); the canvas draws a bare number.
  dayCellFormat: (a: { date: { marker: Date } }) => String(a.date.marker.getUTCDate()),
  allDayText: '',
  displayEventTime: false,
  height: 'auto',
  fixedWeekCount: false,
  dayMaxEvents: 4,
  // Saturday blue, Sunday red (the user, 2026-11-15): day headers, day cells, the list view's day rows.
  dayHeaderClass: (i) => `cal-dh ${dowClass(i.dow)}`,
  dayCellClass: (i) => `cal-cell ${dowClass(i.dow)} ${i.isOther ? 'cal-other-cell' : ''}`,
  dayCellTopClass: () => 'cal-top',
  dayCellTopInnerClass: (i) => `cal-num ${i.isToday ? 'cal-today' : ''} ${i.isOther ? 'cal-other' : ''}`,
  listDayHeaderClass: (i) => dowClass(i.dow),
  // Our order (holiday, pay, transfer, billing, change, subscriptions), not FullCalendar's by title.
  eventOrder: 'order',
  // The events of the visible range, computed by us each time the range changes.
  events: (info, ok) => {
    ok(build(ymd(info.start), ymd(info.end)).map((e, order) => ({
      title: e.title, start: e.date, allDay: true,
      // Grid: the chip takes the kind's colour. List (phone): the row stays plain, the badge says the kind.
      className: list.value ? '' : `ev-${e.kind}`,
      extendedProps: { kind: e.kind, order },
    }) satisfies EventInput))
  },
}))
</script>

<template>
  <div class="cal" :class="{ own }" :aria-label="label ?? t('calendar.region')" role="region">
    <FullCalendar ref="cal" :key="(list ? 'list' : 'grid') + lang + JSON.stringify(sets ?? '')" :options="options">
      <template #eventContent="arg">
        <span class="evc"><b v-if="list || arg.event.extendedProps.kind === 'holiday' || arg.event.extendedProps.kind === 'sub' || arg.event.extendedProps.kind === 'change'" class="evk" :class="list ? 'ev-' + arg.event.extendedProps.kind : ''">{{ kindLabel(arg.event.extendedProps.kind) }}</b><span class="evt">{{ arg.event.title }}</span></span>
      </template>
    </FullCalendar>
  </div>
</template>

<style>
/* FullCalendar's classic theme, coloured with Allot tokens (light and dark follow the page). */
.cal{
  --fc-classic-button: var(--surface); --fc-classic-button-border: var(--border-strong);
  --fc-classic-button-strong: var(--primary-soft); --fc-classic-button-strong-border: var(--primary-text);
  --fc-classic-button-outline: var(--primary-soft); --fc-classic-button-foreground: var(--text);
  --fc-classic-primary: var(--primary); --fc-classic-primary-foreground: var(--primary-ink);
  --fc-classic-event: var(--fill); --fc-classic-event-contrast: var(--text);
  --fc-classic-highlight: var(--primary-soft); --fc-classic-today: var(--primary-soft); --fc-classic-now: var(--neg);
  --fc-classic-background: var(--surface); --fc-classic-faint: var(--surface-2); --fc-classic-muted: var(--fill); --fc-classic-strong: var(--border);
  --fc-classic-foreground: var(--text); --fc-classic-faint-foreground: var(--subtle); --fc-classic-muted-foreground: var(--muted);
  --fc-classic-border: var(--border); --fc-classic-strong-border: var(--border-strong); --fc-classic-ring-color: var(--primary-text);
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; font-size: 13px;
}
.cal .fc-toolbar-title, .cal h2{font-size:17px;font-weight:700}
.cal button{border-radius:var(--r-ctl);font-weight:500}
.cal .is-sat{color:var(--sat)}
.cal .is-sun{color:var(--sun)}
/* Dates of the months before and after: FullCalendar 7.1.5 greys them with its own class (fc-classic-taq, set on the
   number, not inherited), so weekends there take the weekend colour too, a little faded (review 14, D-2). E2E checks the real colour. */
.cal .is-sat .fc-classic-taq{color:var(--sat);opacity:.7}
.cal .is-sun .fc-classic-taq{color:var(--sun);opacity:.7}
/* The month grid of the schedule page lives in a card of its own (ScheduleCalendar): no frame here, the canvas's
   header row, lines and day numbers (spec 010 EV-8..13). */
.cal.own{border:0;border-radius:0;padding:0;background:none;
  --fc-classic-border:var(--divider);--fc-classic-strong-border:var(--divider);--fc-classic-today:transparent}
.cal.own .cal-dh{background:var(--surface-2);border-bottom:1px solid var(--border);padding:8px 10px;font-size:12px;font-weight:600;text-align:left;justify-content:flex-start}
.cal.own .cal-dh{color:var(--subtle)}
.cal.own .cal-dh.is-sat{color:var(--sat)}
.cal.own .cal-dh.is-sun{color:var(--sun)}
.cal.own .cal-cell{min-height:112px;padding:6px 6px 8px}
.cal.own .cal-other-cell{background:var(--surface-2)}
.cal.own .cal-other-cell .fc-event{opacity:.5}
.cal.own .cal-top{justify-content:flex-start}
.cal.own .cal-num{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 6px;border-radius:12px;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}
/* Neighbouring months: every number is lighter; a Saturday and a Sunday keep their blue and red, only faded (D-2). */
.cal.own .cal-num.cal-other{color:var(--subtle);opacity:.7}
.cal.own .is-sat .cal-num{color:var(--sat)}
.cal.own .is-sun .cal-num{color:var(--sun)}
.cal.own .cal-cell .cal-num.cal-today{background:var(--primary);color:var(--primary-ink);font-weight:700;opacity:1}
.cal .fc-event{border-radius:var(--r-badge);font-size:12px;font-weight:600;border:0;padding:0 4px}
.cal .ev-holiday{background:var(--neg-soft) !important;color:var(--neg-text) !important}
.cal .ev-pay{background:var(--primary-soft) !important;color:var(--primary-text) !important}
.cal .ev-transfer{background:var(--info-soft) !important;color:var(--info-text) !important}
.cal .ev-billing{background:var(--accent-soft) !important;color:var(--accent-text) !important}
.cal .ev-change{background:var(--surface) !important;color:var(--accent-text) !important;box-shadow:inset 0 0 0 1px var(--accent-line)}
.cal .ev-sub{background:var(--fill) !important;color:var(--text-2) !important;font-weight:500}
.cal .fc-event *{color:inherit !important}
.cal .evc{display:flex;gap:4px;align-items:baseline;min-width:0;overflow:hidden}
.cal .evk{flex:none;font-weight:600}
.cal .evk:not([class*="ev-"])::after{content:" ·"}
.cal .evt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:760px){
  .cal .evc{white-space:normal}
  .cal .evt{white-space:normal}
  .cal .evk{font-size:11px;padding:1px 6px;border-radius:var(--r-badge)}
}
@media (max-width:760px){.cal{padding:10px}}
</style>
