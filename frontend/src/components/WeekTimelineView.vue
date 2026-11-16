<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type CSSProperties } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime } from '../utils/format';
import { parseReminderTags } from '../domain/reminder';
import { calculateScheduleDensity } from '../utils/conflict';
import {
  getApproxSolarTerm,
  getChineseShichen,
  getCurrentSeasonMeta,
  getSolarTermOnDate,
  type SolarTermDetail,
} from '../utils/shanshui';

const props = defineProps<{
  reminders: Reminder[];
  currentDate?: Date;
}>();

const emit = defineEmits<{
  (e: 'select-reminder', reminder: Reminder): void;
  (e: 'create-at-time', dateIso: string): void;
  (e: 'reschedule', reminder: Reminder, scheduledAt: string): void;
  (e: 'open-solar-terms'): void;
}>();

const weekOffset = ref(0);
const nowTime = ref(new Date());
const hoverSlotY = ref<number | null>(null);
const hoverSlotTime = ref<string>('');
const draggedReminder = ref<Reminder | null>(null);
const dragOverSlot = ref<string | null>(null);
const timelineGridRef = ref<HTMLElement | null>(null);
let timer: any = null;

function handleKeyNav(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  ) return;
  if (document.querySelector('[role="dialog"]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!e.shiftKey && (e.key === '[' || e.key === '【')) {
    weekOffset.value--;
  } else if (!e.shiftKey && (e.key === ']' || e.key === '】')) {
    weekOffset.value++;
  } else if (!e.shiftKey && e.key === 't') {
    weekOffset.value = 0;
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyNav);
  timer = setInterval(() => {
    nowTime.value = new Date();
  }, 30000);
  requestAnimationFrame(() => {
    if (timelineGridRef.value) timelineGridRef.value.scrollTop = Math.max(0, (new Date().getHours() - 1) * HOUR_HEIGHT);
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyNav);
  if (timer) clearInterval(timer);
});

const HOUR_HEIGHT = 48;
const DAY_MINUTES = 24 * 60;

function snapPointerToTime(event: MouseEvent | DragEvent, hour?: number): { hour: number; minute: number; totalMinutes: number } {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return { hour: hour || 0, minute: 0, totalMinutes: (hour || 0) * 60 };
  const rect = target.getBoundingClientRect();
  const baseMinutes = hour === undefined ? 0 : hour * 60;
  const rangeMinutes = hour === undefined ? DAY_MINUTES : 60;
  const ratio = Math.max(0, Math.min((event.clientY - rect.top) / Math.max(rect.height, 1), 0.9999));
  const snapped = Math.min(rangeMinutes - 15, Math.round((ratio * rangeMinutes) / 15) * 15);
  const totalMinutes = baseMinutes + snapped;
  return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60, totalMinutes };
}

function handleGridMouseMove(event: MouseEvent) {
  const targetEl = event.target as HTMLElement | null;
  if (targetEl?.closest('.timeline-event-card, .now-indicator-line')) {
    hoverSlotY.value = null;
    return;
  }
  const snapped = snapPointerToTime(event);
  hoverSlotY.value = (snapped.totalMinutes / 60) * HOUR_HEIGHT;
  const endMinutes = Math.min(DAY_MINUTES - 1, snapped.totalMinutes + 30);
  const pad = (v: number) => String(v).padStart(2, '0');
  hoverSlotTime.value = `${pad(snapped.hour)}:${pad(snapped.minute)} - ${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`;
}

function handleGridMouseLeave() {
  hoverSlotY.value = null;
}

const nowTop = computed(() => (nowTime.value.getHours() + nowTime.value.getMinutes() / 60) * HOUR_HEIGHT);

// Get Monday of current view week
const weekDays = computed(() => {
  const now = props.currentDate ? new Date(props.currentDate) : new Date();
  now.setDate(now.getDate() + weekOffset.value * 7);

  const dayOfWeek = now.getDay(); // 0 is Sun, 1 is Mon...
  const distanceToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - distanceToMonday);
  monday.setHours(0, 0, 0, 0);

  const days: { date: Date; dateStr: string; label: string; isToday: boolean; solarTerm: SolarTermDetail | null }[] = [];
  const today = new Date();
  const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);

    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();

    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = `${dayNames[i]} ${d.getMonth() + 1}/${d.getDate()}`;

    days.push({ date: d, dateStr, label, isToday, solarTerm: getSolarTermOnDate(d) });
  }

  return days;
});

const hours = Array.from({ length: 24 }, (_, hour) => hour);

// Group reminders by date string (YYYY-MM-DD)
const dayRemindersMap = computed(() => {
  const map: Record<string, Reminder[]> = {};
  for (const r of props.reminders) {
    if (r.status === 'ended') continue;
    const d = new Date(r.scheduled_at);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map[key]) map[key] = [];
    map[key].push(r);
  }
  return map;
});

const dayPeriodSummary = computed(() => {
  const summary: Record<string, { morning: number; afternoon: number; evening: number; total: number; minutes: number }> = {};
  for (const day of weekDays.value) {
    const list = dayRemindersMap.value[day.dateStr] || [];
    let m = 0, a = 0, e = 0, mins = 0;
    for (const r of list) {
      const d = new Date(r.scheduled_at);
      const hr = d.getHours();
      if (hr < 12) m++;
      else if (hr < 18) a++;
      else e++;
      mins += r.duration_minutes > 0 ? r.duration_minutes : 30;
    }
    summary[day.dateStr] = { morning: m, afternoon: a, evening: e, total: list.length, minutes: mins };
  }
  return summary;
});

function scrollToCurrentTime() {
  weekOffset.value = 0;
  requestAnimationFrame(() => {
    if (timelineGridRef.value) {
      timelineGridRef.value.scrollTo({
        top: Math.max(0, nowTop.value - 120),
        behavior: 'smooth',
      });
    }
  });
}

const weeklyLoad = computed(() => {
  let count = 0;
  let minutes = 0;
  let overdueCount = 0;
  let conflictsCount = 0;
  const nowMs = nowTime.value.getTime();
  for (const day of weekDays.value) {
    const summary = dayPeriodSummary.value[day.dateStr];
    const items = dayRemindersMap.value[day.dateStr] || [];
    if (summary) {
      count += summary.total;
      minutes += summary.minutes;
    }
    for (const r of items) {
      if (r.status === 'expired' || (r.status === 'active' && new Date(r.scheduled_at).getTime() < nowMs)) overdueCount++;
    }
    if (items.length > 1) {
      conflictsCount += calculateScheduleDensity(day.dateStr, items).conflictsCount;
    }
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const durationText = h > 0 && m > 0 ? `${h}h ${m}m` : (h > 0 ? `${h}h` : `${m}m`);
  return { count, durationText, overdueCount, conflictsCount };
});

interface EventInterval {
  reminder: Reminder;
  start: number;
  end: number;
  column: number;
}

interface EventLayoutMeta {
  style: CSSProperties;
  cols: number;
}

const eventLayouts = computed<Record<string, Record<string, EventLayoutMeta>>>(() => {
  const layouts: Record<string, Record<string, EventLayoutMeta>> = {};

  for (const [dateKey, reminders] of Object.entries(dayRemindersMap.value)) {
    const intervals: EventInterval[] = reminders.map((reminder) => {
      const date = new Date(reminder.scheduled_at);
      const start = date.getHours() * 60 + date.getMinutes();
      return { reminder, start, end: Math.min(DAY_MINUTES, start + Math.max(15, reminder.duration_minutes || 30)), column: 0 };
    }).sort((a, b) => a.start - b.start || a.end - b.end);

    const groups: EventInterval[][] = [];
    let current: EventInterval[] = [];
    let groupEnd = -1;
    for (const interval of intervals) {
      if (current.length && interval.start >= groupEnd) {
        groups.push(current);
        current = [];
        groupEnd = -1;
      }
      current.push(interval);
      groupEnd = Math.max(groupEnd, interval.end);
    }
    if (current.length) groups.push(current);

    layouts[dateKey] = {};
    for (const group of groups) {
      const columnEnds: number[] = [];
      for (const interval of group) {
        let column = columnEnds.findIndex((end) => end <= interval.start);
        if (column < 0) column = columnEnds.length;
        interval.column = column;
        columnEnds[column] = interval.end;
      }
      const columnCount = Math.max(1, columnEnds.length);
      const width = 100 / columnCount;
      for (const interval of group) {
        const top = (interval.start / 60) * HOUR_HEIGHT;
        const height = Math.max(24, ((interval.end - interval.start) / 60) * HOUR_HEIGHT);
        layouts[dateKey][interval.reminder.id] = {
          cols: columnCount,
          style: {
            top: `${top}px`,
            height: `${height}px`,
            left: `calc(${interval.column * width}% + 2px)`,
            width: `calc(${width}% - 4px)`,
          },
        };
      }
    }
  }
  return layouts;
});

function getEventStyle(reminder: Reminder, dateKey: string): CSSProperties {
  return eventLayouts.value[dateKey]?.[reminder.id]?.style || {};
}

function getEventOverlapCols(reminder: Reminder, dateKey: string): number {
  return eventLayouts.value[dateKey]?.[reminder.id]?.cols || 1;
}

function isShortEvent(reminder: Reminder): boolean {
  const duration = Math.max(15, reminder.duration_minutes || 30);
  return (duration / 60) * HOUR_HEIGHT < 38;
}

function isCompactEvent(reminder: Reminder, dateKey: string): boolean {
  return getEventOverlapCols(reminder, dateKey) >= 2 || isShortEvent(reminder);
}

function isOverdueEvent(reminder: Reminder): boolean {
  return (
    reminder.status === 'expired' ||
    (reminder.status === 'active' && new Date(reminder.scheduled_at).getTime() < nowTime.value.getTime())
  );
}

function isOngoingEvent(reminder: Reminder): boolean {
  if (reminder.status !== 'active') return false;
  const start = new Date(reminder.scheduled_at).getTime();
  if (Number.isNaN(start)) return false;
  const end = start + Math.max(15, reminder.duration_minutes || 30) * 60000;
  const nowMs = nowTime.value.getTime();
  return nowMs >= start && nowMs < end;
}

function createAtNextRoundedHour() {
  const todayDay = weekDays.value.find((d) => d.isToday);
  const pad = (v: number) => String(v).padStart(2, '0');
  if (todayDay) {
    const nextHour = Math.min(23, nowTime.value.getHours() + 1);
    emit('create-at-time', `${todayDay.dateStr}T${pad(nextHour)}:00`);
    return;
  }
  const firstDay = weekDays.value[0];
  if (firstDay) {
    emit('create-at-time', `${firstDay.dateStr}T09:00`);
  }
}

function handleSlotClick(event: MouseEvent, dateStr: string, hour: number) {
  const snapped = snapPointerToTime(event, hour);
  const pad = (value: number) => String(value).padStart(2, '0');
  emit('create-at-time', `${dateStr}T${pad(snapped.hour)}:${pad(snapped.minute)}`);
}

function getSlotKey(dateStr: string, hour: number): string {
  return `${dateStr}-${hour}`;
}

function handleEventDragStart(event: DragEvent, reminder: Reminder) {
  draggedReminder.value = reminder;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', reminder.id);
  }
}

function handleEventDragEnd() {
  draggedReminder.value = null;
  dragOverSlot.value = null;
}

function handleSlotDragOver(event: DragEvent, dateStr: string, hour: number) {
  if (!draggedReminder.value) return;
  event.preventDefault();
  dragOverSlot.value = getSlotKey(dateStr, hour);
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function handleSlotDragLeave(dateStr: string, hour: number) {
  if (dragOverSlot.value === getSlotKey(dateStr, hour)) dragOverSlot.value = null;
}

function handleSlotDrop(event: DragEvent, dateStr: string, hour: number) {
  event.preventDefault();
  event.stopPropagation();
  if (!draggedReminder.value) return;
  const snapped = snapPointerToTime(event, hour);
  const pad = (value: number) => String(value).padStart(2, '0');
  emit('reschedule', draggedReminder.value, `${dateStr}T${pad(snapped.hour)}:${pad(snapped.minute)}`);
  handleEventDragEnd();
}

function delayReminder(reminder: Reminder, hours: number) {
  const current = new Date(reminder.scheduled_at);
  if (Number.isNaN(current.getTime())) return;
  current.setHours(current.getHours() + hours);
  const pad = (v: number) => String(v).padStart(2, '0');
  const nextIso = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}`;
  emit('reschedule', reminder, nextIso);
}

function delayToTomorrow(reminder: Reminder) {
  const current = new Date(reminder.scheduled_at);
  if (Number.isNaN(current.getTime())) return;
  current.setDate(current.getDate() + 1);
  const pad = (v: number) => String(v).padStart(2, '0');
  const nextIso = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}T${pad(current.getHours())}:${pad(current.getMinutes())}`;
  emit('reschedule', reminder, nextIso);
}
</script>

<template>
  <div class="week-timeline-view glass-panel bg-isometric-diamond">
    <!-- Header: Navigation and Current Week Range -->
    <div class="timeline-header">
      <div class="week-nav">
        <button class="nav-btn icon-nav-btn" @click="weekOffset--">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>上一周</span>
        </button>
        <button class="nav-btn today-btn" @click="weekOffset = 0">本周</button>
        <button class="nav-btn icon-nav-btn" @click="weekOffset++">
          <span>下一周</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <button class="nav-btn icon-nav-btn" title="滚动定位至当前时刻红线" @click="scrollToCurrentTime">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
          <span>当前时刻</span>
        </button>
      </div>

      <div class="week-range-text">
        <span>{{ weekDays[0].label }} - {{ weekDays[6].label }}</span>
        <span v-if="weeklyLoad.count > 0" class="week-load-pill tabular-nums">
          {{ weeklyLoad.count }} 项 · {{ weeklyLoad.durationText }}
        </span>
        <span v-if="weeklyLoad.overdueCount > 0" class="week-load-pill danger tabular-nums" title="本周未完结的已逾期日程数">
          逾期 {{ weeklyLoad.overdueCount }}
        </span>
        <span v-if="weeklyLoad.conflictsCount > 0" class="week-load-pill danger tabular-nums" title="本周存在时段重叠冲突">
          冲突 {{ weeklyLoad.conflictsCount }}
        </span>
        <button
          type="button"
          class="week-solar-btn"
          :title="`${getCurrentSeasonMeta(nowTime).title} · ${getApproxSolarTerm(nowTime).verse}（点击查看廿四节气）`"
          @click="$emit('open-solar-terms')"
        >
          {{ getCurrentSeasonMeta(nowTime).season }} · {{ getApproxSolarTerm(nowTime).name }}
        </button>
        <span class="week-shichen-pill" :title="getChineseShichen(nowTime).poeticHint">
          {{ getChineseShichen(nowTime).branch }}时 · {{ getChineseShichen(nowTime).alias }}
        </span>
      </div>
    </div>

    <!-- Day Columns Header -->
    <div class="columns-header-row">
      <div class="time-axis-corner">时间</div>
      <div
        v-for="day in weekDays"
        :key="day.dateStr"
        class="day-col-head"
        :class="{ 'is-today': day.isToday }"
      >
        <div class="day-head-main">
          <span class="day-title">{{ day.label }}</span>
          <span v-if="day.solarTerm" class="day-solar-badge" :title="day.solarTerm.verse">{{ day.solarTerm.name }}</span>
          <span v-if="day.isToday" class="today-dot">今日</span>
        </div>
        <!-- Period Distribution Heat Strip -->
        <div
          class="period-heat-strip"
          :class="{ empty: !(dayPeriodSummary[day.dateStr]?.total > 0) }"
          :title="dayPeriodSummary[day.dateStr]?.total > 0 ? `晨(上午):${dayPeriodSummary[day.dateStr].morning} 昼(下午):${dayPeriodSummary[day.dateStr].afternoon} 暮(晚间):${dayPeriodSummary[day.dateStr].evening} · 共 ${dayPeriodSummary[day.dateStr].minutes}m` : '当日暂无排期'"
        >
          <span class="heat-bar morning" :class="{ filled: (dayPeriodSummary[day.dateStr]?.morning || 0) > 0 }"></span>
          <span class="heat-bar afternoon" :class="{ filled: (dayPeriodSummary[day.dateStr]?.afternoon || 0) > 0 }"></span>
          <span class="heat-bar evening" :class="{ filled: (dayPeriodSummary[day.dateStr]?.evening || 0) > 0 }"></span>
        </div>
      </div>
    </div>

    <!-- Scrollable Grid Body -->
    <div v-if="weeklyLoad.count === 0" class="empty-week-floating">
      <span class="empty-week-text">本周暂无安排，点击任意时段网格或直接快速创建</span>
      <button type="button" class="empty-week-cta" @click="createAtNextRoundedHour">+ 新建本周日程</button>
    </div>
    <div ref="timelineGridRef" class="timeline-grid-body">
      <!-- Left Time Axis -->
      <div class="time-axis-col">
        <div v-for="h in hours" :key="h" class="hour-cell">
          <span class="hour-label">{{ String(h).padStart(2, '0') }}:00</span>
        </div>
      </div>

      <!-- 7 Day Columns -->
      <div
        class="days-columns-container"
        @mousemove="handleGridMouseMove"
        @mouseleave="handleGridMouseLeave"
      >
        <!-- Interactive Hover Guide Line -->
        <div
          v-if="hoverSlotY !== null"
          class="timeline-hover-guide"
          :style="{ top: `${hoverSlotY}px` }"
        >
          <span class="hover-guide-tag">＋ {{ hoverSlotTime }} 新建</span>
        </div>

        <div
          v-for="day in weekDays"
          :key="day.dateStr"
          class="day-timeline-col"
          :class="{ 'is-today-col': day.isToday }"
        >
          <!-- Background Hour Rows (Click to add) -->
          <div
            v-for="h in hours"
            :key="h"
            class="grid-hour-slot"
            :class="{ 'drag-over-slot': dragOverSlot === getSlotKey(day.dateStr, h) }"
            :title="`点击在 ${day.label} ${h}:00 新建日程，或将日程拖到此处`"
            @dragover="handleSlotDragOver($event, day.dateStr, h)"
            @dragleave="handleSlotDragLeave(day.dateStr, h)"
            @drop="handleSlotDrop($event, day.dateStr, h)"
            @click="handleSlotClick($event, day.dateStr, h)"
          ></div>

          <!-- Elapsed Day Subtle Veil -->
          <div
            v-if="day.isToday"
            class="elapsed-day-veil"
            :style="{ height: `${nowTop}px` }"
          ></div>

          <!-- Real-time "Now" Indicator Line -->
          <div
            v-if="day.isToday"
            class="now-indicator-line"
            :style="{ top: `${nowTop}px` }"
          >
            <span class="now-pulse-dot"></span>
            <span class="now-time-tag">{{ formatTime(nowTime.toISOString()) }}</span>
          </div>

          <!-- Positioned Event Cards -->
          <div
            v-for="r in dayRemindersMap[day.dateStr] || []"
            :key="r.id"
            class="timeline-event-card"
            :class="[
              'pri-' + (r.priority || 'p2'),
              {
                'is-dragging': draggedReminder?.id === r.id,
                'is-short': isShortEvent(r),
                'is-compact': isCompactEvent(r, day.dateStr),
                'is-overlapping': getEventOverlapCols(r, day.dateStr) >= 2,
                'is-paused': r.status === 'paused',
                'is-overdue': isOverdueEvent(r),
                'is-ongoing': isOngoingEvent(r),
              },
            ]"
            :style="getEventStyle(r, day.dateStr)"
            role="button"
            tabindex="0"
            :title="`${formatTime(r.scheduled_at)} (${r.duration_minutes || 30}m) · ${r.title}${r.status === 'paused' ? ' [已暂停]' : r.status === 'expired' ? ' [已过期]' : ''}`"
            :aria-label="`${formatTime(r.scheduled_at)} ${r.title}`"
            draggable="true"
            @dragstart="handleEventDragStart($event, r)"
            @dragend="handleEventDragEnd"
            @click.stop="$emit('select-reminder', r)"
            @keydown.enter.prevent="$emit('select-reminder', r)"
            @keydown.space.prevent="$emit('select-reminder', r)"
          >
            <template v-if="isShortEvent(r)">
              <span v-if="getEventOverlapCols(r, day.dateStr) === 1" class="event-time-inline tabular-nums">{{ formatTime(r.scheduled_at) }}</span>
              <span class="event-title">{{ r.title }}</span>
              <span v-if="r.priority === 'p0' || r.priority === 'p1'" class="event-pri-chip">{{ r.priority.toUpperCase() }}</span>
            </template>
            <template v-else>
              <div class="event-time">
                <span>{{ isCompactEvent(r, day.dateStr) ? formatTime(r.scheduled_at) : `${formatTime(r.scheduled_at)} (${r.duration_minutes || 30}m)` }}</span>
                <span class="event-badges-right">
                  <span v-if="r.repeat_rule && !isCompactEvent(r, day.dateStr)" class="event-repeat-chip" title="重复日程" aria-label="重复日程">↻</span>
                  <span v-if="r.priority === 'p0' || r.priority === 'p1'" class="event-pri-chip">{{ r.priority.toUpperCase() }}</span>
                </span>
              </div>
              <div class="event-title">{{ r.title }}</div>
            </template>
            <div class="event-quick-reschedule" @click.stop>
              <button type="button" title="推迟 1 小时" @click.stop="delayReminder(r, 1)">+1h</button>
              <button type="button" title="延后至明天同一时间" @click.stop="delayToTomorrow(r)">+1d</button>
            </div>
            <div v-if="r.tags" class="event-tags-row">
              <span
                v-for="t in parseReminderTags(r.tags).slice(0, 2)"
                :key="t"
                class="timeline-tag-pill"
              >#{{ t }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.week-timeline-view {
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 12px;
  padding: 0 4px;
}

.week-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s ease;
}

.nav-btn:hover {
  background: var(--fill-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.today-btn {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.week-range-text {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  font: 700 13px var(--font-mono);
  color: var(--text-primary);
}
.week-shichen-pill {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--tide-text);
  font: 650 10px var(--font-mono);
  letter-spacing: 0.04em;
}

.columns-header-row {
  display: flex;
  border-bottom: 1px solid var(--border-l1);
  padding-bottom: 8px;
}

.time-axis-corner {
  width: 54px;
  flex: none;
  font: 700 10px var(--font-mono);
  color: var(--text-muted);
  text-align: center;
}

.day-col-head {
  flex: 1;
  min-width: 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font: 650 11px var(--font-mono);
  color: var(--text-secondary);
}

.day-head-main {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  max-width: 100%;
  white-space: nowrap;
}

.day-col-head.is-today {
  color: var(--tide-text);
}

.today-dot {
  font: 700 9px var(--font-mono);
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--tide);
  color: var(--ink-on-accent);
}

.day-solar-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--seal-red, #e05246) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--seal-red, #e05246) 38%, transparent);
  color: var(--seal-red, #e05246);
}

.week-solar-btn {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--tide-text);
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}
.week-solar-btn:hover {
  border-color: var(--accent-border);
  background: var(--fill-hover);
}

.period-heat-strip {
  display: flex;
  gap: 3px;
  justify-content: center;
  min-height: 3px;
}

.period-heat-strip.empty {
  opacity: 0.22;
}

.heat-bar {
  width: 10px;
  height: 2.5px;
  border-radius: 999px;
  background: var(--border-subtle);
  opacity: 0.35;
  transition: all 0.2s ease;
}

.heat-bar.filled {
  opacity: 1;
}

.heat-bar.morning.filled { background: var(--tide); }
.heat-bar.afternoon.filled { background: var(--warning); }
.heat-bar.evening.filled { background: var(--accent); }

.timeline-grid-body {
  display: flex;
  align-items: flex-start;
  height: 520px;
  overflow-y: auto;
  position: relative;
  margin-top: 6px;
  padding-top: 8px;
}

.time-axis-col {
  width: 54px;
  flex: none;
  height: 1152px;
  display: flex;
  flex-direction: column;
}

.hour-cell {
  height: 48px;
  flex: 0 0 48px;
  box-sizing: border-box;
  border-bottom: 1px dashed var(--border-subtle);
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.hour-label {
  font: 600 10px var(--font-mono);
  color: var(--text-quaternary);
  transform: translateY(-7px);
}

.days-columns-container {
  flex: 1;
  min-width: 0;
  height: 1152px;
  display: flex;
  position: relative;
}

.day-timeline-col {
  flex: 1;
  min-width: 0;
  height: 1152px;
  position: relative;
  border-left: 1px solid var(--border-l1);
  box-sizing: border-box;
}

.day-timeline-col.is-today-col {
  background: color-mix(in srgb, var(--tide) 4.5%, transparent);
}

.grid-hour-slot {
  height: 48px;
  box-sizing: border-box;
  border-bottom: 1px dashed var(--border-subtle);
  cursor: pointer;
  transition: background 0.14s ease;
}

.grid-hour-slot:hover {
  background: var(--fill-hover);
}

.timeline-event-card {
  position: absolute;
  left: 3px;
  right: 3px;
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 11px;
  box-sizing: border-box;
  overflow: hidden;
  cursor: pointer;
  z-index: 10;
  transition: all 0.16s ease;
  box-shadow: var(--shadow-xs);
}

.timeline-event-card:hover,
.timeline-event-card:focus-visible {
  transform: scale(1.02);
  z-index: 32;
  box-shadow: var(--shadow-sm);
  outline: none;
}

.timeline-event-card.is-short {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  border-radius: 6px;
}

.timeline-event-card.is-short .event-time-inline {
  flex: none;
  font: 650 9.5px/1 var(--font-mono);
  opacity: 0.9;
}

.timeline-event-card.is-short .event-title {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  line-height: 1.25;
}

.timeline-event-card.is-compact:not(.is-short) {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 1px;
  padding: 2px 5px;
}

.timeline-event-card.is-compact .event-time {
  flex: none;
  white-space: nowrap;
  font-size: 8.5px;
  line-height: 1.15;
}

.timeline-event-card.is-compact .event-title {
  flex: none;
  min-width: 0;
  font-size: 10px;
  line-height: 1.2;
}

.timeline-event-card.is-short .event-title {
  flex: 1;
  line-height: 1.25;
}

.timeline-event-card.is-compact .event-tags-row,
.timeline-event-card.is-short .event-tags-row {
  display: none;
}

.event-quick-reschedule {
  position: absolute;
  top: 3px;
  right: 4px;
  display: flex;
  gap: 2px;
  padding: 1px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);
  opacity: 0;
  transition: opacity var(--motion-fast);
  z-index: 25;
}
.timeline-event-card.is-short .event-quick-reschedule {
  top: 50%;
  transform: translateY(-50%);
}
.timeline-event-card.is-overlapping .event-quick-reschedule {
  display: none;
}
.timeline-event-card:hover .event-quick-reschedule {
  opacity: 1;
}
.event-quick-reschedule button {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  background: var(--surface-overlay);
  color: var(--text-primary);
  font: 700 8.5px var(--font-mono);
  cursor: pointer;
  line-height: 1.2;
  transition: all var(--motion-fast);
  box-shadow: var(--shadow-xs);
}
.event-quick-reschedule button:hover {
  background: var(--accent);
  color: var(--ink-on-accent, #07080a);
  border-color: var(--accent);
}

.week-load-pill {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font: 600 10px var(--font-mono);
}

.week-load-pill.danger {
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.timeline-event-card.is-paused {
  opacity: 0.65;
  border-style: dashed;
}

.timeline-event-card.is-overdue {
  box-shadow: inset 3px 0 0 var(--vermilion), var(--shadow-xs);
}

.timeline-event-card.is-ongoing {
  box-shadow:
    inset 3px 0 0 var(--lime-strong, var(--accent)),
    0 0 0 1px color-mix(in srgb, var(--lime-strong, var(--accent)) 45%, transparent),
    0 4px 14px color-mix(in srgb, var(--lime, var(--accent)) 22%, transparent);
}

.timeline-event-card.is-overlapping {
  box-shadow: 0 0 0 1px var(--highlight-edge), var(--shadow-xs);
}

.event-tags-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}

.timeline-tag-pill {
  font-size: 9px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(10, 14, 22, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: rgba(255, 255, 255, 0.96);
  white-space: nowrap;
}

.timeline-event-card.pri-p0 {
  background: linear-gradient(135deg, color-mix(in srgb, var(--danger) 82%, #0f172a), color-mix(in srgb, var(--danger) 64%, #0f172a));
  border: 1px solid color-mix(in srgb, var(--danger) 78%, white);
  color: #fff;
}

.timeline-event-card.pri-p1 {
  background: linear-gradient(135deg, color-mix(in srgb, var(--warning) 80%, #0f172a), color-mix(in srgb, var(--warning) 62%, #0f172a));
  border: 1px solid color-mix(in srgb, var(--warning) 78%, white);
  color: #fff;
}

.timeline-event-card.pri-p2 {
  background: linear-gradient(135deg, color-mix(in srgb, var(--tide) 76%, #0f172a), color-mix(in srgb, var(--tide) 58%, #0f172a));
  border: 1px solid color-mix(in srgb, var(--tide) 75%, white);
  color: #fff;
}

.timeline-event-card.pri-p3 {
  background: linear-gradient(135deg, color-mix(in srgb, var(--text-tertiary) 64%, #0f172a), color-mix(in srgb, var(--text-quaternary) 72%, #0f172a));
  border: 1px solid color-mix(in srgb, var(--text-tertiary) 65%, transparent);
  color: #fff;
}

/* Real-time Now Indicator Beam (Scrolltide Vermilion Lumen) */
.now-indicator-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--vermilion), color-mix(in srgb, var(--vermilion) 25%, transparent));
  box-shadow: 0 0 12px color-mix(in srgb, var(--vermilion) 70%, transparent);
  z-index: 30;
  pointer-events: none;
  display: flex;
  align-items: center;
}

.now-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vermilion);
  box-shadow: 0 0 10px var(--vermilion);
  margin-left: -4px;
  animation: pulse-glow 1.5s infinite;
}

.now-time-tag {
  font: 700 8.5px var(--font-mono);
  background: var(--vermilion);
  color: #fff;
  padding: 1px 5px;
  border-radius: 999px;
  margin-left: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.28);
  letter-spacing: 0.04em;
}

@keyframes pulse-glow {
  0% { transform: scale(0.9); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.8; }
}

.event-time {
  font-size: 9.5px;
  opacity: 0.9;
  font-weight: 600;
}

.event-title {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Dynamic Hover Guide Line */
.timeline-hover-guide {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.5px;
  background: var(--tide);
  box-shadow: 0 0 8px color-mix(in srgb, var(--tide) 70%, transparent);
  z-index: 25;
  pointer-events: none;
  display: flex;
  align-items: center;
}

.hover-guide-tag {
  font: 700 9px var(--font-mono);
  background: var(--cta-bg);
  color: var(--cta-ink);
  padding: 1px 7px;
  border-radius: 999px;
  margin-left: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  letter-spacing: 0.03em;
}
.event-time {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.event-badges-right {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.event-repeat-chip {
  font: 700 9.5px var(--font-mono);
  opacity: 0.85;
}
.event-pri-chip {
  font: 700 9px var(--font-mono);
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
}
.elapsed-day-veil {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 28%, transparent), color-mix(in srgb, var(--surface) 8%, transparent));
  pointer-events: none;
  z-index: 2;
}
.empty-week-floating {
  position: absolute;
  top: 112px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  white-space: nowrap;
  pointer-events: none;
}
.empty-week-floating > * {
  pointer-events: auto;
}
.empty-week-text {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-l1);
  background: color-mix(in srgb, var(--surface-overlay) 92%, transparent);
  backdrop-filter: blur(8px);
  font-size: 11.5px;
  color: var(--text-secondary);
  box-shadow: var(--shadow-xs);
}
.empty-week-cta {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--cta-bg);
  color: var(--cta-ink);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-xs);
}
.empty-week-cta:hover {
  filter: brightness(1.06);
}
:global([data-color-scheme="light"]) .timeline-event-card {
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.1);
}
:global([data-color-scheme="light"]) .timeline-event-card:hover,
:global([data-color-scheme="light"]) .timeline-event-card:focus-visible {
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.16);
}
:global([data-color-scheme="light"]) .event-pri-chip {
  background: rgba(15, 23, 42, 0.1);
}
@media (max-width: 1020px) {
  .week-timeline-view { overflow-x: auto; }
  .timeline-header {
    position: sticky;
    left: 0;
  }
  .columns-header-row,
  .timeline-grid-body { min-width: 780px; }
}
</style>
