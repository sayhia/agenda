<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime } from '../utils/format';

const props = defineProps<{
  reminders: Reminder[];
}>();

const emit = defineEmits<{
  (e: 'select-reminder', reminder: Reminder): void;
  (e: 'toggle-status', reminder: Reminder): void;
  (e: 'toggle-pause', reminder: Reminder): void;
  (e: 'delete-reminder', id: string): void;
  (e: 'create-on-date', dateKey: string): void;
  (e: 'reschedule', reminder: Reminder, scheduledAt: string): void;
}>();

const storedMonth = localStorage.getItem('agenda_calendar_month');
const storedMonthMatch = storedMonth?.match(/^(\d{4})-(\d{1,2})$/);
const initialYear = storedMonthMatch ? Number(storedMonthMatch[1]) : new Date().getFullYear();
const initialMonth = storedMonthMatch ? Number(storedMonthMatch[2]) - 1 : new Date().getMonth();
const currentYear = ref(initialYear >= 1970 && initialYear <= 2200 ? initialYear : new Date().getFullYear());
const currentMonth = ref(initialMonth >= 0 && initialMonth <= 11 ? initialMonth : new Date().getMonth());
watch([currentYear, currentMonth], ([year, month]) => {
  localStorage.setItem('agenda_calendar_month', `${year}-${month + 1}`);
});
const selectedDayCell = ref<CalendarCell | null>(null);
const draggedReminder = ref<Reminder | null>(null);
const dragOverDate = ref<string | null>(null);
const selectedCellIndex = ref(0);
const calendarGridRef = ref<HTMLElement | null>(null);

function toDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const remindersByDate = computed(() => {
  const index = new Map<string, Reminder[]>();
  for (const reminder of props.reminders) {
    const key = toDateKey(reminder.scheduled_at);
    if (!key) continue;
    const items = index.get(key) || [];
    items.push(reminder);
    index.set(key, items);
  }
  for (const items of index.values()) {
    items.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  }
  return index;
});

let dayDetailTrigger: HTMLElement | null = null;

function handleKeyNav(e: KeyboardEvent) {
  if (selectedDayCell.value && e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    closeDayDetail();
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === '[' || e.key === '【') {
    prevMonth();
  } else if (e.key === ']' || e.key === '】') {
    nextMonth();
  } else if (e.key.toLowerCase() === 't') {
    goToday();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyNav, true);
  nextTick(() => {
    const todayIndex = cells.value.findIndex((cell) => cell.isToday);
    if (todayIndex >= 0) selectedCellIndex.value = todayIndex;
  });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyNav, true);
});

const activeDayItems = computed<Reminder[]>(() =>
  selectedDayCell.value ? remindersByDate.value.get(selectedDayCell.value.dateKey) || [] : []
);

function openDayDetail(c: CalendarCell) {
  dayDetailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  selectedDayCell.value = c;
}

function closeDayDetail() {
  selectedDayCell.value = null;
  const trigger = dayDetailTrigger;
  dayDetailTrigger = null;
  void nextTick(() => trigger?.focus());
}

function handleCreateOnThisDay() {
  if (!selectedDayCell.value) return;
  const key = selectedDayCell.value.dateKey;
  closeDayDetail();
  emit('create-on-date', key);
}

const monthTitle = computed(() => {
  return `${currentYear.value} 年 ${currentMonth.value + 1} 月`;
});

interface CalendarCell {
  date: Date;
  dateNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  dateKey: string;
  items: Reminder[];
}

const cells = computed<CalendarCell[]>(() => {
  const result: CalendarCell[] = [];
  const year = currentYear.value;
  const month = currentMonth.value;

  const firstDay = new Date(year, month, 1);
  const firstDayOfWeek = firstDay.getDay(); // 0: Sun, 1: Mon...

  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDayOfWeek);

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);

    const dYear = d.getFullYear();
    const dMonth = String(d.getMonth() + 1).padStart(2, '0');
    const dDate = String(d.getDate()).padStart(2, '0');
    const dateKey = `${dYear}-${dMonth}-${dDate}`;

    const isCurrentMonth = d.getMonth() === month;
    const isToday = dateKey === todayKey;

    const items = remindersByDate.value.get(dateKey) || [];

    result.push({
      date: d,
      dateNum: d.getDate(),
      isCurrentMonth,
      isToday,
      dateKey,
      items,
    });
  }

  return result;
});

async function handleCellKeydown(event: KeyboardEvent, index: number) {
  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    event.stopImmediatePropagation();
    openDayDetail(cells.value[index]);
    return;
  }
  const offset = offsets[event.key];
  if (!offset) return;
  event.preventDefault();
  event.stopPropagation();
  selectedCellIndex.value = Math.max(0, Math.min(cells.value.length - 1, index + offset));
  await nextTick();
  calendarGridRef.value?.querySelectorAll<HTMLElement>('[role="gridcell"]')[selectedCellIndex.value]?.focus();
}

function prevMonth() {
  selectedCellIndex.value = 0;
  if (currentMonth.value === 0) {
    currentMonth.value = 11;
    currentYear.value--;
  } else {
    currentMonth.value--;
  }
}

function nextMonth() {
  selectedCellIndex.value = 0;
  if (currentMonth.value === 11) {
    currentMonth.value = 0;
    currentYear.value++;
  } else {
    currentMonth.value++;
  }
}

function goToday() {
  const now = new Date();
  currentYear.value = now.getFullYear();
  currentMonth.value = now.getMonth();
  nextTick(() => {
    selectedCellIndex.value = Math.max(0, cells.value.findIndex((cell) => cell.isToday));
  });
}

function handleTaskDragStart(event: DragEvent, reminder: Reminder) {
  if (reminder.status === 'ended') {
    event.preventDefault();
    return;
  }
  draggedReminder.value = reminder;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', reminder.id);
  }
}

function handleTaskDragEnd() {
  draggedReminder.value = null;
  dragOverDate.value = null;
}

function handleCellDragOver(event: DragEvent, dateKey: string) {
  if (!draggedReminder.value) return;
  event.preventDefault();
  dragOverDate.value = dateKey;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

function handleCellDragLeave(dateKey: string) {
  if (dragOverDate.value === dateKey) dragOverDate.value = null;
}

function handleCellDrop(event: DragEvent, dateKey: string) {
  event.preventDefault();
  event.stopPropagation();
  if (!draggedReminder.value) return;

  const original = new Date(draggedReminder.value.scheduled_at);
  const pad = (value: number) => String(value).padStart(2, '0');
  emit('reschedule', draggedReminder.value, `${dateKey}T${pad(original.getHours())}:${pad(original.getMinutes())}`);
  handleTaskDragEnd();
}
</script>

<template>
  <div class="month-view glass-panel">
    <!-- Month Header -->
    <div class="month-header">
      <div class="header-nav">
        <button class="icon-btn" title="上个月" @click="prevMonth">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span class="month-label">{{ monthTitle }}</span>
        <button class="icon-btn" title="下个月" @click="nextMonth">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <button class="icon-btn today-btn" title="回到今天" @click="goToday">
        今天
      </button>
    </div>

    <!-- Weekday Headers -->
    <div class="weekday-row">
      <span>周日</span>
      <span>周一</span>
      <span>周二</span>
      <span>周三</span>
      <span>周四</span>
      <span>周五</span>
      <span>周六</span>
    </div>

    <!-- 7-Column Grid -->
    <div ref="calendarGridRef" class="calendar-grid" role="grid" aria-label="月历">
      <div
        v-for="(c, index) in cells"
        :key="c.dateKey"
        class="calendar-cell"
        role="gridcell"
        :tabindex="selectedCellIndex === index ? 0 : -1"
        :aria-label="`${c.dateKey}，${c.items.length} 项日程`"
        :class="{
          outside: !c.isCurrentMonth,
          today: c.isToday,
          selected: selectedDayCell?.dateKey === c.dateKey,
          'density-heavy': c.items.length >= 5,
          'density-medium': c.items.length >= 3 && c.items.length < 5,
          'density-light': c.items.length >= 1 && c.items.length < 3,
          'drag-over-date': dragOverDate === c.dateKey,
        }"
        @dragover="handleCellDragOver($event, c.dateKey)"
        @dragleave="handleCellDragLeave(c.dateKey)"
        @drop="handleCellDrop($event, c.dateKey)"
        @click="openDayDetail(c)"
        @focus="selectedCellIndex = index"
        @keydown="handleCellKeydown($event, index)"
      >
        <div class="cell-head">
          <span class="cell-day tabular-nums">{{ c.dateNum }}</span>
          <span v-if="c.items.length" class="cell-count">{{ c.items.length }}</span>
        </div>

        <div class="cell-tasks">
          <div
            v-for="item in c.items.slice(0, 3)"
            :key="item.id"
            class="month-task-pill"
            role="button"
            tabindex="0"
            :class="[
              'pri-' + (item.priority || 'p2'),
              { 'is-dragging': draggedReminder?.id === item.id, ended: item.status === 'ended' },
            ]"
            :title="`${formatTime(item.scheduled_at)} ${item.title}${item.status === 'ended' ? '（已完成，不可拖动）' : '（拖动到其他日期可改期）'}`"
            :draggable="item.status !== 'ended'"
            @dragstart="handleTaskDragStart($event, item)"
            @dragend="handleTaskDragEnd"
            @click.stop="$emit('select-reminder', item)"
            @keydown.enter.stop.prevent="$emit('select-reminder', item)"
            @keydown.space.stop.prevent="$emit('select-reminder', item)"
          >
            <span class="task-time tabular-nums">{{ formatTime(item.scheduled_at) }}</span>
            <span class="task-name">{{ item.title }}</span>
          </div>
          <span v-if="c.items.length > 3" class="cell-more">
            +{{ c.items.length - 3 }} 项
          </span>
        </div>
      </div>
    </div>

    <!-- Day Detail Modal -->
    <div v-if="selectedDayCell" class="modal-overlay" @click.self="closeDayDetail">
      <div class="day-detail-card glass-panel bg-crosshair-grid" role="dialog" aria-modal="true" aria-label="日期详情">
        <div class="detail-head">
          <div class="detail-title-wrap">
            <h3 class="detail-title">{{ selectedDayCell.dateKey }}</h3>
            <span class="detail-badge">{{ activeDayItems.length }} 项日程</span>
          </div>
          <button class="icon-btn" title="关闭" @click="closeDayDetail">✕</button>
        </div>

        <div class="detail-body">
          <div v-if="activeDayItems.length === 0" class="empty-detail">
            <span>该日暂无日程安排</span>
          </div>

          <div v-else class="detail-items-list">
            <div
              v-for="r in activeDayItems"
              :key="r.id"
              class="detail-item-row"
              :class="{ paused: r.status === 'paused', ended: r.status === 'ended' }"
            >
              <button
                class="detail-complete-btn"
                :class="{ completed: r.status === 'ended', paused: r.status === 'paused' }"
                :title="r.status === 'ended' ? '点击重新激活' : '点击标记完成'"
                @click="$emit('toggle-status', r)"
              >
                <svg v-if="r.status === 'ended'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="9" height="9">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>

              <div class="item-time-col">
                <span class="detail-time tabular-nums">{{ formatTime(r.scheduled_at) }}</span>
                <span class="status-dot" :class="r.status"></span>
              </div>
              <div class="item-info-col">
                <span class="item-title" :class="{ 'title-ended': r.status === 'ended' }">{{ r.title }}</span>
                <span v-if="r.notes" class="item-notes">{{ r.notes }}</span>
              </div>
              <div class="item-actions-col">
                <button
                  v-if="r.status !== 'ended'"
                  class="icon-btn action-sub-btn"
                  :title="r.status === 'paused' ? '恢复提醒' : '暂停提醒'"
                  @click="$emit('toggle-pause', r)"
                >
                  {{ r.status === 'paused' ? '▶' : 'Ⅱ' }}
                </button>
                <button
                  class="icon-btn action-sub-btn"
                  title="编辑"
                  @click="closeDayDetail(); $emit('select-reminder', r)"
                >
                  ✎
                </button>
                <button
                  class="icon-btn action-sub-btn danger"
                  title="删除"
                  @click="$emit('delete-reminder', r.id)"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-foot">
          <button class="primary-btn add-day-btn" @click="handleCreateOnThisDay">
            <span>➕ 在此日期新建日程</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.month-view {
  border-radius: 14px;
  padding: 16px;
  box-shadow: 0 8px 30px -4px rgba(0, 0, 0, 0.25);
}

.month-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: 10px;
}

.month-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 110px;
  text-align: center;
}

.today-btn {
  font-size: 11.5px;
  font-weight: 600;
  width: auto;
  padding: 0 10px;
}

.weekday-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 6px;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.calendar-cell {
  min-height: 84px;
  padding: 6px 7px;
  border-radius: 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.calendar-cell:hover {
  background: var(--fill-hover);
  border-color: var(--border-l2);
}

.calendar-cell.outside {
  opacity: 0.35;
}

.calendar-cell.density-light {
  background: color-mix(in srgb, var(--tide) 4.5%, transparent);
}

.calendar-cell.density-medium {
  background: color-mix(in srgb, var(--tide) 9%, transparent);
  border-color: color-mix(in srgb, var(--tide) 26%, transparent);
}

.calendar-cell.density-heavy {
  background: color-mix(in srgb, var(--lime) 9%, transparent);
  border-color: color-mix(in srgb, var(--lime) 32%, transparent);
}

.calendar-cell.today {
  border-color: var(--tide);
  background: radial-gradient(ellipse at 85% 15%, color-mix(in srgb, var(--tide) 16%, transparent) 0%, transparent 70%), var(--fill-subtle);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

.cell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cell-day {
  font: 650 11.5px var(--font-mono);
  color: var(--text-secondary);
}

.calendar-cell.today .cell-day {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 21px;
  height: 21px;
  border-radius: 50%;
  background: var(--tide);
  color: var(--ink-on-accent);
  font-weight: 800;
  box-shadow: 0 0 10px color-mix(in srgb, var(--tide) 45%, transparent);
}

.cell-count {
  font: 700 9px var(--font-mono);
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.cell-tasks {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}

.month-task-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--fill-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: 10px;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  transition: all 0.12s ease;
}

.month-task-pill:hover {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  transform: translateX(1px);
}

.month-task-pill.pri-p0 {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  border-color: color-mix(in srgb, var(--danger) 36%, transparent);
  color: var(--danger);
}

.month-task-pill.pri-p1 {
  background: color-mix(in srgb, var(--lime) 14%, transparent);
  border-color: color-mix(in srgb, var(--lime) 36%, transparent);
  color: var(--lime-strong);
}

.month-task-pill.pri-p3 {
  background: var(--fill-subtle);
  border-color: var(--border-subtle);
  color: var(--text-tertiary);
}

.task-time {
  font: 700 9.5px var(--font-mono);
  color: var(--accent-text);
  flex: none;
}

.month-task-pill.pri-p0 .task-time,
.month-task-pill.pri-p1 .task-time {
  color: inherit;
}

.task-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.cell-more {
  font-size: 9px;
  color: var(--text-muted);
  font-weight: 600;
}

/* Day Detail Modal Overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
}

.day-detail-card {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  border-radius: 16px;
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-title {
  font-size: 15px;
  font-weight: 750;
  color: var(--text-primary);
}

.detail-badge {
  font: 700 10px var(--font-mono);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
}

.detail-body {
  overflow-y: auto;
  max-height: 50vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-detail {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

.detail-items-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-item-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 9px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  transition: all 0.12s ease;
}

.detail-item-row:hover {
  background: var(--fill-hover);
  border-color: var(--border-l2);
}

.detail-item-row.paused {
  opacity: 0.6;
}

.detail-item-row.ended {
  opacity: 0.55;
}

.detail-complete-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-on-success);
  flex-shrink: 0;
  transition: all 0.16s ease;
  padding: 0;
}

.detail-complete-btn:hover {
  border-color: var(--success);
  background: color-mix(in srgb, var(--success) 15%, transparent);
}

.detail-complete-btn.completed {
  border-color: var(--success);
  background: var(--success);
}

.title-ended {
  text-decoration: line-through;
  color: var(--text-muted);
}

.item-time-col {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 60px;
}

.detail-time {
  font: 700 11.5px var(--font-mono);
  color: var(--accent-text);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--success);
}

.status-dot.paused {
  background: var(--warning);
}

.item-info-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-notes {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-actions-col {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-sub-btn {
  width: 24px;
  height: 24px;
  font-size: 11px;
}

.detail-foot {
  display: flex;
  justify-content: flex-end;
  padding-top: 6px;
  border-top: 1px solid var(--border-l1);
}

.add-day-btn {
  width: 100%;
  justify-content: center;
  height: 32px;
  font-size: 12.5px;
}
@media (max-width: 980px) {
  .month-view { overflow-x: auto; }
  .weekday-row,
  .calendar-grid { min-width: 720px; }
  .calendar-cell { min-height: 96px; }
}
</style>
