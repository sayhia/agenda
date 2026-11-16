<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime, formatNotePreview } from '../utils/format';
import { parseReminderTags } from '../domain/reminder';
import { getTagColor } from '../utils/tagColors';
import { calculateScheduleDensity } from '../utils/conflict';
import {
  getChineseMonthAlias,
  getApproxSolarTerm,
  getCurrentSeasonMeta,
  getSolarTermOnDate,
  type SolarTermDetail,
} from '../utils/shanshui';

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
  (e: 'open-solar-terms'): void;
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
const portalTargetReady = ref(false);
const portalTarget = ref('#reminder-inspector-portal');

function ensurePortalTarget() {
  if (!portalTargetReady.value) {
    portalTarget.value = document.getElementById('reminder-inspector-portal') ? '#reminder-inspector-portal' : 'body';
    portalTargetReady.value = true;
  }
}

onMounted(() => {
  ensurePortalTarget();
});

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
  if (selectedDayCell.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const target = e.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      e.stopPropagation();
      shiftDetailDay(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
  }
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
    prevMonth();
  } else if (!e.shiftKey && (e.key === ']' || e.key === '】')) {
    nextMonth();
  } else if (!e.shiftKey && e.key === 't') {
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

const activeDayDensity = computed(() =>
  selectedDayCell.value
    ? calculateScheduleDensity(selectedDayCell.value.dateKey, activeDayItems.value)
    : { totalBusyMinutes: 0, densityPct: 0, level: 'low', conflictsCount: 0 }
);

function openDayDetail(c: CalendarCell) {
  ensurePortalTarget();
  dayDetailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  selectedDayCell.value = c;
}

function shiftDetailDay(delta: number) {
  if (!selectedDayCell.value) return;
  const parts = selectedDayCell.value.dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return;
  const nextDate = new Date(parts[0], parts[1] - 1, parts[2] + delta);
  const nextKey = toDateKey(nextDate);
  if (nextDate.getFullYear() !== currentYear.value || nextDate.getMonth() !== currentMonth.value) {
    currentYear.value = nextDate.getFullYear();
    currentMonth.value = nextDate.getMonth();
  }
  const existing = cells.value.find((cell) => cell.dateKey === nextKey);
  if (existing) {
    selectedDayCell.value = existing;
    return;
  }
  const items = remindersByDate.value.get(nextKey) || [];
  const nowMs = Date.now();
  const overdueCount = items.filter((r) => r.status === 'expired' || (r.status === 'active' && new Date(r.scheduled_at).getTime() < nowMs)).length;
  selectedDayCell.value = {
    date: nextDate,
    dateNum: nextDate.getDate(),
    isCurrentMonth: true,
    isToday: nextKey === toDateKey(new Date()),
    isWeekend: nextDate.getDay() === 0 || nextDate.getDay() === 6,
    dateKey: nextKey,
    items,
    conflictsCount: items.length > 1 ? calculateScheduleDensity(nextKey, items).conflictsCount : 0,
    overdueCount,
    solarTerm: getSolarTermOnDate(nextDate),
  };
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

const monthItemSummary = computed(() => {
  let total = 0;
  let overdue = 0;
  const nowMs = Date.now();
  for (const cell of cells.value) {
    if (!cell.isCurrentMonth) continue;
    total += cell.items.length;
    for (const r of cell.items) {
      if (r.status === 'expired' || (r.status === 'active' && new Date(r.scheduled_at).getTime() < nowMs)) overdue++;
    }
  }
  return { total, overdue };
});

interface CalendarCell {
  date: Date;
  dateNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  dateKey: string;
  items: Reminder[];
  conflictsCount: number;
  overdueCount: number;
  solarTerm: SolarTermDetail | null;
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
  const nowMs = now.getTime();
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
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;

    const items = remindersByDate.value.get(dateKey) || [];
    const conflictsCount = items.length > 1 ? calculateScheduleDensity(dateKey, items).conflictsCount : 0;
    const overdueCount = items.filter((r) => r.status === 'expired' || (r.status === 'active' && new Date(r.scheduled_at).getTime() < nowMs)).length;

    result.push({
      date: d,
      dateNum: d.getDate(),
      isCurrentMonth,
      isToday,
      isWeekend,
      dateKey,
      items,
      conflictsCount,
      overdueCount,
      solarTerm: getSolarTermOnDate(d),
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

const monthAlias = computed(() => getChineseMonthAlias(currentMonth.value));
const currentSolarTerm = computed(() => getApproxSolarTerm(new Date()));
const viewedSeason = computed(() => getCurrentSeasonMeta(new Date(currentYear.value, currentMonth.value, 15)));

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
  if (Number.isNaN(original.getTime())) {
    handleTaskDragEnd();
    return;
  }
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
        <span class="month-shanshui-alias" :title="`${viewedSeason.title} · ${viewedSeason.poem}`">
          {{ monthAlias }} · {{ viewedSeason.alias }}
        </span>
        <button class="icon-btn" title="下个月" @click="nextMonth">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div class="month-header-right">
        <span v-if="monthItemSummary.total > 0" class="month-count-pill tabular-nums">
          本月 {{ monthItemSummary.total }} 项
        </span>
        <span v-if="monthItemSummary.overdue > 0" class="month-count-pill overdue tabular-nums">
          逾期 {{ monthItemSummary.overdue }}
        </span>
        <button
          type="button"
          class="month-solar-pill"
          :title="`${currentSolarTerm.season}令 · ${currentSolarTerm.name} · ${currentSolarTerm.verse}（点击查看廿四节气与四季图鉴）`"
          @click="$emit('open-solar-terms')"
        >
          <i class="shanshui-seal">{{ currentSolarTerm.sealChar }}</i>
          <span>{{ currentSolarTerm.season }} · {{ currentSolarTerm.name }}</span>
        </button>
        <button class="icon-btn today-btn" title="回到今天" @click="goToday">
          今天
        </button>
      </div>
    </div>

    <!-- Weekday Headers -->
    <div class="weekday-row">
      <span class="weekend">周日</span>
      <span>周一</span>
      <span>周二</span>
      <span>周三</span>
      <span>周四</span>
      <span>周五</span>
      <span class="weekend">周六</span>
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
          weekend: c.isWeekend,
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
          <div class="cell-day-group">
            <span class="cell-day tabular-nums">{{ c.dateNum }}</span>
            <span v-if="c.isToday" class="today-mini-chip">今</span>
            <span
              v-if="c.solarTerm"
              class="cell-solar-tag"
              :title="`${c.solarTerm.season}季 · ${c.solarTerm.name}（${c.solarTerm.verse}）`"
            >{{ c.solarTerm.name }}</span>
          </div>
          <div class="cell-indicators">
            <span v-if="c.overdueCount > 0" class="overdue-dot" :title="`${c.overdueCount} 项已逾期`"></span>
            <span v-if="c.conflictsCount > 0" class="conflict-dot" :title="`检测到 ${c.conflictsCount} 处时间冲突`"></span>
            <span v-if="c.items.length >= 3" class="heat-dots" :title="`任务密集：${c.items.length} 项`">
              <i class="heat-dot" :class="{ hot: c.items.length >= 5 }"></i>
              <i class="heat-dot" :class="{ hot: c.items.length >= 5 }"></i>
              <i class="heat-dot" :class="{ hot: c.items.length >= 5 }"></i>
            </span>
            <span v-if="c.items.length" class="cell-count">{{ c.items.length }}</span>
          </div>
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
              { 'is-dragging': draggedReminder?.id === item.id, ended: item.status === 'ended', expired: item.status === 'expired', paused: item.status === 'paused' },
            ]"
            :title="`${formatTime(item.scheduled_at)} ${item.title}${item.status === 'ended' ? '（已完成，不可拖动）' : item.status === 'expired' ? '（已过期，拖动可改期）' : '（拖动到其他日期可改期）'}`"
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
          <button
            v-if="c.items.length > 3"
            type="button"
            class="cell-more"
            :title="`查看该日全部 ${c.items.length} 项日程`"
            @click.stop="openDayDetail(c)"
          >
            +{{ c.items.length - 3 }} 项
          </button>
        </div>
        <div
          v-if="c.items.length > 0"
          class="cell-load-bar"
          :class="{ hot: c.items.length >= 5, medium: c.items.length >= 3 && c.items.length < 5 }"
          :style="{ width: `${Math.min(100, c.items.length * 20)}%` }"
          aria-hidden="true"
        ></div>
      </div>
    </div>

    <!-- Day Detail Modal -->
    <Teleport v-if="portalTargetReady" :to="portalTarget">
      <Transition name="modal-fade">
        <div v-if="selectedDayCell" class="modal-overlay" @click.self="closeDayDetail">
        <div class="day-detail-card glass-panel bg-crosshair-grid" role="dialog" aria-modal="true" aria-label="日期详情">
          <div class="detail-head">
            <div class="detail-head-copy">
              <span class="detail-eyebrow">DAY OVERVIEW · 日期详情</span>
              <div class="detail-title-wrap">
                <div class="detail-day-nav">
                  <button type="button" class="detail-nav-btn" title="前一天 (←)" aria-label="前一天" @click="shiftDetailDay(-1)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <h3 class="detail-title tabular-nums">{{ selectedDayCell.dateKey }}</h3>
                  <button type="button" class="detail-nav-btn" title="后一天 (→)" aria-label="后一天" @click="shiftDetailDay(1)">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
                <span class="detail-badge">{{ activeDayItems.length }} 项日程</span>
                <span v-if="activeDayDensity.totalBusyMinutes > 0" class="detail-badge">{{ activeDayDensity.totalBusyMinutes }}m · 负荷 {{ activeDayDensity.densityPct }}%</span>
                <span v-if="activeDayDensity.conflictsCount > 0" class="detail-badge danger">冲突 {{ activeDayDensity.conflictsCount }}</span>
              </div>
            </div>
            <button class="modal-close-btn" title="关闭" aria-label="关闭" @click="closeDayDetail">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="detail-body">
            <div v-if="activeDayItems.length === 0" class="empty-detail">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>该日暂无日程安排</span>
              <span class="empty-detail-hint">可点击下方按钮快速安排事项，或从其他日期拖拽日程卡片至此</span>
            </div>

          <div v-else class="detail-items-list">
            <div
              v-for="r in activeDayItems"
              :key="r.id"
              class="detail-item-row"
              :class="{ paused: r.status === 'paused', ended: r.status === 'ended', expired: r.status === 'expired' }"
              role="button"
              tabindex="0"
              title="点击编辑该日程"
              @click="closeDayDetail(); $emit('select-reminder', r)"
              @keydown.enter.prevent="closeDayDetail(); $emit('select-reminder', r)"
            >
              <button
                class="detail-complete-btn"
                :class="{ completed: r.status === 'ended', paused: r.status === 'paused' }"
                :title="r.status === 'ended' ? '点击重新激活' : '点击标记完成'"
                @click.stop="$emit('toggle-status', r)"
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
                <div class="item-title-meta">
                  <span v-if="r.is_pinned" class="detail-mini-badge pinned">置顶</span>
                  <span v-if="r.priority && r.priority !== 'p2'" class="detail-mini-badge" :class="r.priority">{{ r.priority.toUpperCase() }}</span>
                  <span class="item-title" :class="{ 'title-ended': r.status === 'ended' }">{{ r.title }}</span>
                </div>
                <div class="item-sub-row">
                  <span class="detail-duration tabular-nums">{{ r.duration_minutes || 30 }}m</span>
                  <span
                    v-for="tag in parseReminderTags(r.tags).slice(0, 2)"
                    :key="tag"
                    class="detail-tag-pill"
                    :style="{
                      backgroundColor: getTagColor(tag).bg,
                      color: getTagColor(tag).text,
                      borderColor: getTagColor(tag).border,
                    }"
                  >#{{ tag }}</span>
                  <span v-if="r.notes" class="item-notes">{{ formatNotePreview(r.notes) }}</span>
                </div>
              </div>
              <div class="item-actions-col" @click.stop>
                <button
                  v-if="r.status === 'active' || r.status === 'paused'"
                  class="icon-btn action-sub-btn"
                  :title="r.status === 'paused' ? '恢复提醒' : '暂停提醒'"
                  @click="$emit('toggle-pause', r)"
                >
                  <svg v-if="r.status === 'paused'" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                  <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                </button>
                <button
                  class="icon-btn action-sub-btn"
                  title="编辑"
                  aria-label="编辑"
                  @click="closeDayDetail(); $emit('select-reminder', r)"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  class="icon-btn action-sub-btn danger"
                  title="删除"
                  aria-label="删除"
                  @click="$emit('delete-reminder', r.id)"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-foot">
          <button class="primary-btn add-day-btn st-inline-icon" @click="handleCreateOnThisDay">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>在此日期新建日程</span>
          </button>
        </div>
      </div>
    </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.month-view {
  border-radius: 14px;
  padding: 16px;
  box-shadow: var(--shadow-sm);
}

.month-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 12px;
}

.header-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.month-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 110px;
  text-align: center;
}

.month-shanshui-alias {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--tide-text);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.month-header-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.month-count-pill {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font: 600 10.5px var(--font-mono);
}

.month-count-pill.overdue {
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

.month-solar-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 5px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s ease;
}
.month-solar-pill:hover {
  border-color: var(--accent-border);
  background: var(--fill-hover);
  color: var(--text-primary);
}
.month-solar-pill i {
  font-style: normal;
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

.weekday-row span.weekend {
  color: var(--text-quaternary);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.calendar-cell {
  position: relative;
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

.calendar-cell.weekend:not(.today):not(.outside) {
  background: color-mix(in srgb, var(--surface-raised) 45%, var(--fill-subtle));
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
  gap: 4px;
}

.cell-day-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.cell-solar-tag {
  padding: 1px 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--seal-red, #e05246) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--seal-red, #e05246) 38%, transparent);
  color: var(--seal-red, #e05246);
  font-size: 9px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
}

.cell-indicators {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.heat-dots {
  display: inline-flex;
  align-items: center;
  gap: 2.5px;
}

.heat-dot {
  width: 3.5px;
  height: 3.5px;
  border-radius: 50%;
  background: var(--tide);
  opacity: 0.85;
}

.heat-dot.hot {
  background: var(--lime);
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

.month-task-pill.paused {
  opacity: 0.65;
  border-style: dashed;
}

.cell-more {
  align-self: flex-start;
  padding: 1px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--fill-subtle);
  font-size: 9px;
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;
}

.cell-more:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--accent-text);
}

/* Day Detail Modal Overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-scrim);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-overlay);
}

.day-detail-card {
  width: min(500px, 92vw);
  max-height: min(82vh, 660px);
  border-radius: 18px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(65% 40% at 88% 0%, color-mix(in srgb, var(--tide) 9%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.detail-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail-head-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.detail-eyebrow {
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--tide-text);
}

.detail-title-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}

.detail-title {
  margin: 0;
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

.detail-badge.danger {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-detail {
  padding: 28px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
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
  cursor: pointer;
  transition: all 0.12s ease;
}

.detail-item-row:hover,
.detail-item-row:focus-visible {
  background: var(--fill-hover);
  border-color: var(--accent-border);
  outline: none;
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

.status-dot.expired {
  background: var(--danger);
}

.item-info-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item-title-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.detail-mini-badge {
  flex: none;
  padding: 0 5px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font: 700 9px var(--font-mono);
}

.detail-mini-badge.p0 {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.detail-mini-badge.p1 {
  color: var(--lime-strong);
  border-color: color-mix(in srgb, var(--lime) 36%, transparent);
  background: color-mix(in srgb, var(--lime) 14%, transparent);
}

.detail-mini-badge.pinned {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 35%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.item-sub-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.detail-duration {
  flex: none;
  font: 600 10px var(--font-mono);
  color: var(--text-tertiary);
}

.detail-tag-pill {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid;
  font: 600 9.5px var(--font-mono);
  line-height: 1.4;
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
  display: inline-grid;
  place-items: center;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  font-size: 12.5px;
}
.conflict-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 20%, transparent);
  flex-shrink: 0;
}
.today-mini-chip {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--tide);
  color: var(--ink-on-accent, #04131c);
  font: 800 9px/1.4 var(--font-sans);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}
.overdue-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--warning) 22%, transparent);
  flex-shrink: 0;
}
.detail-day-nav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.detail-nav-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.14s ease;
}
.detail-nav-btn:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--accent-text);
}
.cell-load-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  border-radius: 0 2px 0 0;
  background: color-mix(in srgb, var(--tide) 58%, transparent);
  pointer-events: none;
  transition: width 0.2s ease;
}
.cell-load-bar.medium {
  background: color-mix(in srgb, var(--tide) 82%, transparent);
}
.cell-load-bar.hot {
  background: color-mix(in srgb, var(--lime) 85%, transparent);
}
.empty-detail-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}
.item-info-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
@media (max-width: 980px) {
  .month-view { overflow-x: auto; }
  .month-header { position: sticky; left: 0; }
  .weekday-row,
  .calendar-grid { min-width: 720px; }
  .calendar-cell { min-height: 96px; }
}
@media (max-width: 720px) {
  .day-detail-card {
    width: min(94vw, 520px);
    padding: 14px;
  }
  .detail-item-row {
    gap: 8px;
    padding: 8px 10px;
  }
}
</style>
