<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, type CSSProperties } from 'vue';
import type { Reminder } from '../../bindings/agenda-desktop/models';
import { formatTime } from '../utils/format';
import { parseReminderTags } from '../domain/reminder';

const props = defineProps<{
  reminders: Reminder[];
  currentDate?: Date;
}>();

const emit = defineEmits<{
  (e: 'select-reminder', reminder: Reminder): void;
  (e: 'create-at-time', dateIso: string): void;
  (e: 'reschedule', reminder: Reminder, scheduledAt: string): void;
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
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === '[' || e.key === '【') {
    weekOffset.value--;
  } else if (e.key === ']' || e.key === '】') {
    weekOffset.value++;
  } else if (e.key.toLowerCase() === 't') {
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
  const snapped = snapPointerToTime(event);
  hoverSlotY.value = (snapped.totalMinutes / 60) * HOUR_HEIGHT;
  hoverSlotTime.value = `${String(snapped.hour).padStart(2, '0')}:${String(snapped.minute).padStart(2, '0')}`;
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

  const days: { date: Date; dateStr: string; label: string; isToday: boolean }[] = [];
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

    days.push({ date: d, dateStr, label, isToday });
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

interface EventInterval {
  reminder: Reminder;
  start: number;
  end: number;
  column: number;
}

const eventLayouts = computed<Record<string, Record<string, CSSProperties>>>(() => {
  const layouts: Record<string, Record<string, CSSProperties>> = {};

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
        const height = Math.max(22, ((interval.end - interval.start) / 60) * HOUR_HEIGHT);
        layouts[dateKey][interval.reminder.id] = {
          top: `${top}px`,
          height: `${height}px`,
          left: `calc(${interval.column * width}% + 2px)`,
          width: `calc(${width}% - 4px)`,
        };
      }
    }
  }
  return layouts;
});

function getEventStyle(reminder: Reminder, dateKey: string): CSSProperties {
  return eventLayouts.value[dateKey]?.[reminder.id] || {};
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
</script>

<template>
  <div class="week-timeline-view glass-panel bg-isometric-diamond">
    <!-- Header: Navigation and Current Week Range -->
    <div class="timeline-header">
      <div class="week-nav">
        <button class="nav-btn" @click="weekOffset--">◀ 上一周</button>
        <button class="nav-btn today-btn" @click="weekOffset = 0">本周</button>
        <button class="nav-btn" @click="weekOffset++">下一周 ▶</button>
      </div>

      <div class="week-range-text">
        {{ weekDays[0].label }} - {{ weekDays[6].label }}
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
        <span class="day-title">{{ day.label }}</span>
        <span v-if="day.isToday" class="today-dot">今日</span>
      </div>
    </div>

    <!-- Scrollable Grid Body -->
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
              { 'is-dragging': draggedReminder?.id === r.id },
            ]"
            :style="getEventStyle(r, day.dateStr)"
            role="button"
            tabindex="0"
            :aria-label="`${formatTime(r.scheduled_at)} ${r.title}`"
            draggable="true"
            @dragstart="handleEventDragStart($event, r)"
            @dragend="handleEventDragEnd"
            @click.stop="$emit('select-reminder', r)"
            @keydown.enter.prevent="$emit('select-reminder', r)"
            @keydown.space.prevent="$emit('select-reminder', r)"
          >
            <div class="event-time">{{ formatTime(r.scheduled_at) }} ({{ r.duration_minutes || 30 }}m)</div>
            <div class="event-title">{{ r.title }}</div>
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
  margin-bottom: 12px;
  padding: 0 4px;
}

.week-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav-btn {
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
  font: 700 13px var(--font-mono);
  color: var(--text-primary);
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
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: 650 11px var(--font-mono);
  color: var(--text-secondary);
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

.timeline-grid-body {
  display: flex;
  align-items: flex-start;
  height: 520px;
  overflow-y: auto;
  position: relative;
  margin-top: 6px;
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
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.timeline-event-card:hover,
.timeline-event-card:focus-visible {
  transform: scale(1.02);
  z-index: 20;
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
  background: rgba(0, 0, 0, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.95);
  white-space: nowrap;
}

.timeline-event-card.pri-p0 {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.75), rgba(185, 28, 28, 0.85));
  border: 1px solid rgba(239, 68, 68, 0.8);
  color: #fff;
}

.timeline-event-card.pri-p1 {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.75), rgba(180, 83, 9, 0.85));
  border: 1px solid rgba(245, 158, 11, 0.8);
  color: #fff;
}

.timeline-event-card.pri-p2 {
  background: linear-gradient(135deg, color-mix(in srgb, var(--tide) 72%, #07080a), color-mix(in srgb, var(--tide) 52%, #07080a));
  border: 1px solid color-mix(in srgb, var(--tide) 75%, white);
  color: #fff;
}

.timeline-event-card.pri-p3 {
  background: linear-gradient(135deg, rgba(107, 114, 128, 0.7), rgba(55, 65, 81, 0.8));
  border: 1px solid rgba(107, 114, 128, 0.7);
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
  transition: top 0.06s ease-out;
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
@media (max-width: 1020px) {
  .week-timeline-view { overflow-x: auto; }
  .timeline-header,
  .columns-header-row,
  .timeline-grid-body { min-width: 820px; }
}
</style>
