<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import {
  formatTime,
  formatDateLabel,
  formatRelativeTime,
  formatRepeatLabel,
  isNearDue,
  extractUrls,
  extractLocalPaths,
  getCountdownBadge,
  highlightMatch,
} from '../utils/format';
import { getTagColor } from '../utils/tagColors';
import { RevealInFinder } from '../../bindings/agenda/internal/agenda/agendaservice';
import { parseReminderSubtasks, parseReminderTags } from '../domain/reminder';
import ScrolltideSelect from './ScrolltideSelect.vue';

export interface SubtaskItem {
  id: string;
  title: string;
  done: boolean;
}

const props = withDefaults(defineProps<{
  reminders: Reminder[];
  selectedIds: string[];
  searchQuery?: string;
  activeId?: string | null;
  loading?: boolean;
  nowTick?: number;
}>(), {
  loading: false,
});

const emit = defineEmits<{
  (e: 'toggle-select', id: string): void;
  (e: 'select-all', ids: string[]): void;
  (e: 'edit', reminder: Reminder): void;
  (e: 'delete', id: string): void;
  (e: 'toggle-status', reminder: Reminder): void;
  (e: 'toggle-pause', reminder: Reminder): void;
  (e: 'toggle-pin', id: string): void;
  (e: 'snooze', reminder: Reminder, minutes: number): void;
  (e: 'view-history', reminder: Reminder): void;
  (e: 'update-subtasks', id: string, subtasks: string): void;
  (e: 'filter-tag', tag: string): void;
  (e: 'duplicate', reminder: Reminder): void;
  (e: 'start-focus', reminder: Reminder): void;
  (e: 'update-title', reminder: Reminder, newTitle: string): void;
  (e: 'update-priority', reminder: Reminder, priority: string): void;
  (e: 'open-create'): void;
  (e: 'open-ai'): void;
  (e: 'clear-filters'): void;
  (e: 'activate', id: string): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
}>();

type GroupMode = 'date' | 'priority' | 'status' | 'none';
type SortMode = 'time' | 'priority' | 'near' | 'title';
const validGroups: GroupMode[] = ['date', 'priority', 'status', 'none'];
const validSorts: SortMode[] = ['time', 'priority', 'near', 'title'];
const storedGroup = localStorage.getItem('agenda_group_by') as GroupMode | null;
const storedSort = localStorage.getItem('agenda_sort_by') as SortMode | null;
const sortBy = ref<SortMode>(storedSort && validSorts.includes(storedSort) ? storedSort : 'time');
const groupBy = ref<GroupMode>(storedGroup && validGroups.includes(storedGroup) ? storedGroup : 'date');
watch(groupBy, (value) => localStorage.setItem('agenda_group_by', value));
watch(sortBy, (value) => localStorage.setItem('agenda_sort_by', value));

const groupOptions: { value: GroupMode; label: string }[] = [
  { value: 'date', label: '按排期日期' },
  { value: 'priority', label: '按优先级' },
  { value: 'status', label: '按处理状态' },
  { value: 'none', label: '不分组平铺' },
];
const sortOptions: { value: SortMode; label: string }[] = [
  { value: 'time', label: '按时间先后' },
  { value: 'priority', label: '按优先级 (P0-P3)' },
  { value: 'near', label: '即将到期优先' },
  { value: 'title', label: '按标题拼音' },
];

const collapsedGroups = ref<Record<string, boolean>>({});

function toggleGroupCollapse(groupName: string) {
  collapsedGroups.value[groupName] = !collapsedGroups.value[groupName];
}

const listRootRef = ref<HTMLElement | null>(null);
const activeInspectorReminder = ref<Reminder | null>(null);
const inspectorSubtaskInput = ref('');
const lastSelectedId = ref<string | null>(null);

watch(() => props.activeId, async (id) => {
  if (!id) return;
  await nextTick();
  const row = Array.from(listRootRef.value?.querySelectorAll<HTMLElement>('[data-reminder-id]') || [])
    .find((element) => element.dataset.reminderId === id);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

watch(() => props.reminders, (newReminders) => {
  if (activeInspectorReminder.value) {
    const updated = newReminders.find((r) => r.id === activeInspectorReminder.value?.id);
    activeInspectorReminder.value = updated || null;
  }
});

function toggleInspector(r: Reminder) {
  if (activeInspectorReminder.value?.id === r.id) {
    activeInspectorReminder.value = null;
  } else {
    activeInspectorReminder.value = r;
  }
}

function cycleInspectorPriority(r: Reminder) {
  const map: Record<string, string> = { p0: 'p1', p1: 'p2', p2: 'p3', p3: 'p0' };
  const next = map[r.priority || 'p2'] || 'p2';
  emit('update-priority', r, next);
}

function handleInspectorTitleChange(r: Reminder, newTitle: string) {
  const t = newTitle.trim();
  if (t && t !== r.title) {
    emit('update-title', r, t);
  }
}

function handleInspectorAddSubtask(r: Reminder) {
  const text = inspectorSubtaskInput.value.trim();
  if (!text) return;
  const list = getSubtasks(r);
  list.push({
    id: 'st-' + Date.now(),
    title: text,
    done: false,
  });
  emit('update-subtasks', r.id, JSON.stringify(list));
  inspectorSubtaskInput.value = '';
}

function handleInspectorDeleteSubtask(r: Reminder, idx: number) {
  const list = getSubtasks(r);
  list.splice(idx, 1);
  emit('update-subtasks', r.id, JSON.stringify(list));
}

function handleRowSelectClick(e: MouseEvent, r: Reminder, currentList: Reminder[]) {
  if (e.shiftKey && lastSelectedId.value && lastSelectedId.value !== r.id) {
    const idx1 = currentList.findIndex((item) => item.id === lastSelectedId.value);
    const idx2 = currentList.findIndex((item) => item.id === r.id);
    if (idx1 !== -1 && idx2 !== -1) {
      const start = Math.min(idx1, idx2);
      const end = Math.max(idx1, idx2);
      const rangeIds = currentList.slice(start, end + 1).map((item) => item.id);
      const newSelection = Array.from(new Set([...props.selectedIds, ...rangeIds]));
      emit('select-all', newSelection);
      lastSelectedId.value = r.id;
      return;
    }
  }

  lastSelectedId.value = r.id;
  emit('toggle-select', r.id);
}

const filterPriority = ref<'all' | 'high' | 'p0' | 'p1'>('all');
const filterHasSubtasks = ref<boolean>(false);
const filterRepeating = ref<boolean>(false);

const expandedSubtasks = ref<Record<string, boolean>>({});
const activeSnoozeMenuId = ref<string | null>(null);

interface ReminderViewModel {
  tags: string[];
  subtasks: SubtaskItem[];
  progress: { total: number; done: number; pct: number } | null;
  time: string;
  dateLabel: ReturnType<typeof formatDateLabel>;
  relativeTime: string;
  repeatLabel: string;
  near: boolean;
  countdown: ReturnType<typeof getCountdownBadge>;
  urls: ReturnType<typeof extractUrls>;
  paths: ReturnType<typeof extractLocalPaths>;
}

const reminderViewModels = computed(() => {
  props.nowTick;
  const map = new Map<string, ReminderViewModel>();
  for (const reminder of props.reminders) {
    const subtasks = parseReminderSubtasks(reminder.subtasks);
    const done = subtasks.filter((item) => item.done).length;
    map.set(reminder.id, {
      tags: parseReminderTags(reminder.tags),
      subtasks,
      progress: subtasks.length ? { total: subtasks.length, done, pct: Math.round(done / subtasks.length * 100) } : null,
      time: formatTime(reminder.scheduled_at),
      dateLabel: formatDateLabel(reminder.scheduled_at),
      relativeTime: formatRelativeTime(reminder.scheduled_at),
      repeatLabel: formatRepeatLabel(reminder.repeat_rule),
      near: isNearDue(reminder.scheduled_at),
      countdown: getCountdownBadge(reminder.scheduled_at),
      urls: extractUrls(reminder.notes),
      paths: extractLocalPaths(`${reminder.notes} ${reminder.title}`),
    });
  }
  return map;
});

function viewModel(reminder: Reminder): ReminderViewModel {
  return reminderViewModels.value.get(reminder.id)!;
}

function applySecondaryFilters(items: Reminder[]): Reminder[] {
  let filtered = [...items];
  if (filterPriority.value === 'high') filtered = filtered.filter((r) => r.priority === 'p0' || r.priority === 'p1');
  else if (filterPriority.value === 'p0') filtered = filtered.filter((r) => r.priority === 'p0');
  else if (filterPriority.value === 'p1') filtered = filtered.filter((r) => r.priority === 'p1');
  if (filterHasSubtasks.value) filtered = filtered.filter((r) => viewModel(r).subtasks.length > 0);
  if (filterRepeating.value) filtered = filtered.filter((r) => Boolean(r.repeat_rule));
  return filtered;
}

function sortItems(items: Reminder[]): Reminder[] {
  const arr = [...items];

  return arr.sort((a, b) => {
    // Pinned items always take priority at the top
    if (a.is_pinned !== b.is_pinned) {
      return a.is_pinned ? -1 : 1;
    }

    if (sortBy.value === 'priority') {
      const priMap: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };
      const pa = priMap[a.priority || 'p2'] ?? 2;
      const pb = priMap[b.priority || 'p2'] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    }
    if (sortBy.value === 'title') {
      return a.title.localeCompare(b.title, 'zh');
    }
    if (sortBy.value === 'near') {
      const nearA = viewModel(a).near ? 1 : 0;
      const nearB = viewModel(b).near ? 1 : 0;
      if (nearA !== nearB) return nearB - nearA;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    }
    return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
  });
}

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  reminder: Reminder | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  reminder: null,
});

const contextMenuRef = ref<HTMLElement | null>(null);
let contextMenuTrigger: HTMLElement | null = null;

function showContextMenu(r: Reminder, trigger: HTMLElement | null, x: number, y: number) {
  contextMenuTrigger = trigger;
  contextMenu.value = {
    visible: true,
    x: Math.min(Math.max(8, x), window.innerWidth - 190),
    y: Math.min(Math.max(8, y), window.innerHeight - 280),
    reminder: r,
  };
  nextTick(() => contextMenuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
}

function openContextMenu(e: MouseEvent, r: Reminder) {
  e.preventDefault();
  showContextMenu(r, e.currentTarget as HTMLElement, e.clientX, e.clientY);
}

function openActionMenu(e: MouseEvent, r: Reminder) {
  e.stopPropagation();
  const trigger = e.currentTarget as HTMLElement;
  const rect = trigger.getBoundingClientRect();
  showContextMenu(r, trigger, rect.right - 180, rect.bottom + 6);
}

function openKeyboardMenu(event: KeyboardEvent, reminder: Reminder) {
  const trigger = event.currentTarget as HTMLElement;
  const rect = trigger.getBoundingClientRect();
  showContextMenu(reminder, trigger, rect.left + 24, rect.top + 24);
}

function closeContextMenu(restoreFocus = false) {
  contextMenu.value.visible = false;
  if (restoreFocus) contextMenuTrigger?.focus();
}

function handleContextMenuKeydown(event: KeyboardEvent) {
  const items = Array.from(contextMenuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || []);
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + direction + items.length) % items.length].focus();
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    items[event.key === 'Home' ? 0 : items.length - 1].focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeContextMenu(true);
  }
}

function handleWindowClick() {
  closeContextMenu();
}

function handleListKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
  if (contextMenu.value.visible) {
    closeContextMenu(true);
    event.stopImmediatePropagation();
  } else if (activeInspectorReminder.value) {
    activeInspectorReminder.value = null;
    event.stopImmediatePropagation();
  }
}

onMounted(() => {
  window.addEventListener('click', handleWindowClick);
  window.addEventListener('keydown', handleListKeydown);
});
onUnmounted(() => {
  window.removeEventListener('click', handleWindowClick);
  window.removeEventListener('keydown', handleListKeydown);
});

const revealingPath = ref<string | null>(null);

async function handleReveal(path: string) {
  if (revealingPath.value) return;
  revealingPath.value = path;
  try {
    await RevealInFinder(path);
  } catch (err: any) {
    emit('toast', `无法在访达中显示：${err.message || err}`, 'error');
  } finally {
    revealingPath.value = null;
  }
}

interface ReminderGroup {
  name: string;
  count: number;
  items: Reminder[];
}

const groups = computed<ReminderGroup[]>(() => {
  props.nowTick;
  const source = applySecondaryFilters(props.reminders);
  if (source.length === 0) return [];

  if (groupBy.value === 'priority') {
    const p0: Reminder[] = [];
    const p1: Reminder[] = [];
    const p2: Reminder[] = [];
    const p3: Reminder[] = [];

    for (const r of source) {
      const pri = (r.priority || 'p2').toLowerCase();
      if (pri === 'p0') p0.push(r);
      else if (pri === 'p1') p1.push(r);
      else if (pri === 'p3') p3.push(r);
      else p2.push(r);
    }

    const res: ReminderGroup[] = [];
    if (p0.length) res.push({ name: 'P0 · 紧急重要', count: p0.length, items: sortItems(p0) });
    if (p1.length) res.push({ name: 'P1 · 重要规划', count: p1.length, items: sortItems(p1) });
    if (p2.length) res.push({ name: 'P2 · 常规安排', count: p2.length, items: sortItems(p2) });
    if (p3.length) res.push({ name: 'P3 · 低优先级', count: p3.length, items: sortItems(p3) });
    return res;
  }

  if (groupBy.value === 'status') {
    const active: Reminder[] = [];
    const paused: Reminder[] = [];
    const ended: Reminder[] = [];

    for (const r of source) {
      if (r.status === 'paused') paused.push(r);
      else if (r.status === 'ended') ended.push(r);
      else active.push(r);
    }

    const res: ReminderGroup[] = [];
    if (active.length) res.push({ name: '进行中', count: active.length, items: sortItems(active) });
    if (paused.length) res.push({ name: '已暂停', count: paused.length, items: sortItems(paused) });
    if (ended.length) res.push({ name: '已完成', count: ended.length, items: sortItems(ended) });
    return res;
  }

  if (groupBy.value === 'none') {
    return [{
      name: '全部事项',
      count: source.length,
      items: sortItems(source),
    }];
  }

  // Default: groupBy === 'date'
  const today: Reminder[] = [];
  const tomorrow: Reminder[] = [];
  const upcoming: Reminder[] = [];
  const recurring: Reminder[] = [];
  const paused: Reminder[] = [];
  const ended: Reminder[] = [];

  for (const r of source) {
    if (r.status === 'paused') {
      paused.push(r);
      continue;
    }
    if (r.status === 'ended') {
      ended.push(r);
      continue;
    }

    if (r.repeat_rule) {
      recurring.push(r);
      continue;
    }

    const { isToday, isTomorrow } = viewModel(r).dateLabel;
    if (isToday) {
      today.push(r);
    } else if (isTomorrow) {
      tomorrow.push(r);
    } else {
      upcoming.push(r);
    }
  }

  const res: ReminderGroup[] = [];
  if (today.length) res.push({ name: '今天', count: today.length, items: sortItems(today) });
  if (tomorrow.length) res.push({ name: '明天', count: tomorrow.length, items: sortItems(tomorrow) });
  if (upcoming.length) res.push({ name: '即将到来', count: upcoming.length, items: sortItems(upcoming) });
  if (recurring.length) res.push({ name: '重复日程', count: recurring.length, items: sortItems(recurring) });
  if (paused.length) res.push({ name: '已暂停', count: paused.length, items: sortItems(paused) });
  if (ended.length) res.push({ name: '已完成', count: ended.length, items: sortItems(ended) });

  return res;
});

const visibleReminderIds = computed(() => groups.value.flatMap((group) => group.items.map((item) => item.id)));
const allVisibleSelected = computed(() => {
  const ids = visibleReminderIds.value;
  return ids.length > 0 && ids.every((id) => props.selectedIds.includes(id));
});

function toggleSelectAllVisible() {
  const visibleIds = visibleReminderIds.value;
  if (visibleIds.length === 0) return;

  if (allVisibleSelected.value) {
    emit('select-all', props.selectedIds.filter((id) => !visibleIds.includes(id)));
  } else {
    emit('select-all', Array.from(new Set([...props.selectedIds, ...visibleIds])));
  }
}

function isSelected(id: string): boolean {
  return props.selectedIds.includes(id);
}

function parseTags(tags: string | undefined, reminder?: Reminder): string[] {
  return reminder ? viewModel(reminder).tags : parseReminderTags(tags);
}

function getSubtasks(r: Reminder): SubtaskItem[] {
  return viewModel(r).subtasks.map((item) => ({ ...item }));
}

function getSubtaskProgress(r: Reminder): { total: number; done: number; pct: number } | null {
  return viewModel(r).progress;
}

function toggleSubtaskExpand(id: string) {
  expandedSubtasks.value[id] = !expandedSubtasks.value[id];
}

function handleToggleSubtaskItem(r: Reminder, itemIdx: number) {
  const list = getSubtasks(r);
  if (list[itemIdx]) {
    list[itemIdx].done = !list[itemIdx].done;
    emit('update-subtasks', r.id, JSON.stringify(list));
  }
}

function toggleSnoozeMenu(id: string) {
  activeSnoozeMenuId.value = activeSnoozeMenuId.value === id ? null : id;
}

function handleQuickSnooze(r: Reminder, minutes: number) {
  activeSnoozeMenuId.value = null;
  emit('snooze', r, minutes);
}

const inlineEditingId = ref<string | null>(null);
const inlineTitle = ref('');
const newSubtaskMap = ref<Record<string, string>>({});

function startInlineEdit(r: Reminder) {
  inlineEditingId.value = r.id;
  inlineTitle.value = r.title;
}

function saveInlineEdit(r: Reminder) {
  if (!inlineEditingId.value) return;
  const t = inlineTitle.value.trim();
  if (t && t !== r.title) {
    emit('update-title', r, t);
  }
  inlineEditingId.value = null;
}

function cancelInlineEdit() {
  inlineEditingId.value = null;
}

function handleInlineAddSubtask(r: Reminder) {
  const text = (newSubtaskMap.value[r.id] || '').trim();
  if (!text) return;
  const list = getSubtasks(r);
  list.push({
    id: 'st-' + Date.now(),
    title: text,
    done: false,
  });
  emit('update-subtasks', r.id, JSON.stringify(list));
  newSubtaskMap.value[r.id] = '';
}
</script>

<template>
  <div ref="listRootRef" class="reminder-list">
    <!-- Controls Bar -->
    <div class="list-controls-bar">
      <div class="controls-left">
        <button
          class="select-all-toggle"
          :class="{ checked: allVisibleSelected }"
          :disabled="loading || visibleReminderIds.length === 0"
          :title="allVisibleSelected ? '取消选择当前筛选结果' : '选择当前筛选结果'"
          :aria-pressed="allVisibleSelected"
          @click="toggleSelectAllVisible"
        >
          <span class="select-all-box">
            <svg v-if="allVisibleSelected" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="11" height="11">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <span>{{ allVisibleSelected ? '取消全选' : '全选当前' }}</span>
        </button>
        <span class="total-count">共 {{ reminders.length }} 项日程</span>

        <!-- Quick filter pills (Round 29) -->
        <div class="sub-filters">
          <button
            class="sub-filter-pill"
            :class="{ active: filterPriority === 'all' }"
            @click="filterPriority = 'all'"
          >全部</button>
          <button
            class="sub-filter-pill"
            :class="{ active: filterPriority === 'high' }"
            @click="filterPriority = filterPriority === 'high' ? 'all' : 'high'"
          >高优先级</button>
          <button
            class="sub-filter-pill"
            :class="{ active: filterHasSubtasks }"
            @click="filterHasSubtasks = !filterHasSubtasks"
          >含子任务</button>
          <button
            class="sub-filter-pill"
            :class="{ active: filterRepeating }"
            @click="filterRepeating = !filterRepeating"
          >重复日程</button>
        </div>
      </div>

      <div class="controls-right">
        <div class="control-dropdown-wrap">
          <span class="sort-label">分组</span>
          <ScrolltideSelect
            v-model="groupBy"
            :options="groupOptions"
            compact
            pill
            align="right"
            aria-label="分组方式"
          />
        </div>

        <div class="control-dropdown-wrap">
          <span class="sort-label">排序</span>
          <ScrolltideSelect
            v-model="sortBy"
            :options="sortOptions"
            compact
            pill
            align="right"
            aria-label="排序方式"
          />
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="list-loading-state" aria-live="polite">
      <div class="loading-state-head">
        <span class="loading-spinner"></span>
        <span>正在同步日程...</span>
      </div>
      <div v-for="index in 4" :key="index" class="loading-row">
        <span class="loading-skeleton loading-dot"></span>
        <span class="loading-skeleton loading-time"></span>
        <span class="loading-skeleton loading-title"></span>
        <span class="loading-skeleton loading-chip"></span>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="reminders.length === 0 || groups.length === 0" class="empty-state st-reticle">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="20" cy="20" r="16" stroke-dasharray="3 3" opacity="0.55" />
          <circle cx="20" cy="20" r="9" />
          <path d="M20 15v5l3.5 2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <h3 class="empty-title">{{ reminders.length === 0 ? '当前暂无匹配日程' : '当前筛选没有结果' }}</h3>
      <p class="empty-subtitle">{{ reminders.length === 0 ? '可在上方指令栏快速录入，或使用 AI Skein 批量规划' : '尝试调整优先级、子任务或循环提醒筛选条件' }}</p>
      <div class="empty-actions">
        <button class="primary-btn" @click="$emit('open-create')">
          <span>＋ 新建日程</span>
        </button>
        <button class="empty-sec-btn" @click="$emit('open-ai')">
          <span>AI 规划</span>
        </button>
        <button class="empty-sec-btn" @click="$emit('clear-filters')">
          <span>清除筛选</span>
        </button>
      </div>
    </div>

    <!-- Groups List -->
    <div v-else class="reminder-list-layout" :class="{ 'with-inspector': Boolean(activeInspectorReminder) }">
      <div class="groups-wrap">
        <div v-for="g in groups" :key="g.name" class="group-section">
          <button
            class="group-header"
            type="button"
            :aria-expanded="!collapsedGroups[g.name]"
            :aria-controls="`agenda-group-${g.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}`"
            @click="toggleGroupCollapse(g.name)"
          >
            <span class="group-collapse-arrow">{{ collapsedGroups[g.name] ? '▶' : '▼' }}</span>
            <span class="group-title">{{ g.name }}</span>
            <span class="group-badge">{{ g.count }}</span>
          </button>

          <div v-if="!collapsedGroups[g.name]" :id="`agenda-group-${g.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}`" class="group-cards" role="listbox" aria-multiselectable="true">
            <div
              v-for="r in g.items"
              :key="r.id"
              class="task-row"
              role="option"
              :data-reminder-id="r.id"
              :tabindex="activeId === r.id || (!activeId && visibleReminderIds[0] === r.id) ? 0 : -1"
              :aria-selected="isSelected(r.id)"
              :class="{
                selected: isSelected(r.id),
                'active-focus': activeId === r.id || activeInspectorReminder?.id === r.id,
                'is-pinned': r.is_pinned,
                near: viewModel(r).near && r.status === 'active',
                paused: r.status === 'paused',
                ended: r.status === 'ended',
              }"
              @focus="$emit('activate', r.id)"
              @click="$emit('activate', r.id); toggleInspector(r)"
              @keydown.enter.prevent="toggleInspector(r)"
              @contextmenu="openContextMenu($event, r)"
              @keydown.shift.f10.prevent="openKeyboardMenu($event, r)"
            >
              <!-- Direct Finish / Status Circle -->
              <button
                class="task-complete-btn"
                :class="{ completed: r.status === 'ended', paused: r.status === 'paused' }"
                :title="r.status === 'ended' ? '点击重新恢复未完成' : '点击标记完成'"
                :aria-label="r.status === 'ended' ? `重新开启 ${r.title}` : `完成 ${r.title}`"
                :aria-pressed="r.status === 'ended'"
                @click.stop="$emit('toggle-status', r)"
              >
                <svg v-if="r.status === 'ended'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="10" height="10">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>

              <!-- Multi-select Checkbox (Shift + Click Range) -->
              <button
                class="task-check"
                :class="{ checked: isSelected(r.id) }"
                title="多选操作 (按住 Shift 连续多选)"
                :aria-label="isSelected(r.id) ? `取消选择 ${r.title}` : `选择 ${r.title}`"
                :aria-pressed="isSelected(r.id)"
                @click.stop="handleRowSelectClick($event, r, g.items)"
              >
                <svg v-if="isSelected(r.id)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>

            <!-- Star Pin Button -->
            <button
              class="pin-star-btn"
              :class="{ active: r.is_pinned }"
              :title="r.is_pinned ? '取消置顶' : '置顶日程'"
              @click.stop="$emit('toggle-pin', r.id)"
            >
              ★
            </button>

            <!-- Time Column -->
            <div class="time-col">
              <span class="time-text tabular-nums">{{ viewModel(r).time }}</span>
              <span class="date-badge">{{ viewModel(r).dateLabel.label }}</span>
            </div>

            <!-- Main Content -->
            <div class="main-col">
              <div class="title-line">
                <!-- Pinned Tag -->
                <span v-if="r.is_pinned" class="badge-pinned">置顶</span>

                <!-- Priority Badge (Round 5) -->
                <span
                  v-if="r.priority && r.priority !== 'p2'"
                  class="badge-priority"
                  :class="r.priority"
                >
                  {{ r.priority === 'p0' ? 'P0 紧急' : (r.priority === 'p1' ? 'P1 重要' : 'P3 低') }}
                </span>

                <!-- Inline Title Input or Title Span -->
                <input
                  v-if="inlineEditingId === r.id"
                  v-model="inlineTitle"
                  type="text"
                  class="inline-title-input"
                  @click.stop
                  @keydown.enter.stop="saveInlineEdit(r)"
                  @keydown.esc.stop="cancelInlineEdit"
                  @blur="saveInlineEdit(r)"
                />
                <span
                  v-else
                  class="task-title"
                  :class="{ 'title-ended': r.status === 'ended' }"
                  title="双击编辑，单击打开详情"
                  @dblclick.stop="startInlineEdit(r)"
                  v-html="highlightMatch(r.title, searchQuery)"
                ></span>

                <!-- Colored Tag Badges (Round 26) -->
                <span
                  v-for="tag in parseTags(r.tags, r)"
                  :key="tag"
                  class="tag-badge"
                  :style="{
                    backgroundColor: getTagColor(tag).bg,
                    color: getTagColor(tag).text,
                    borderColor: getTagColor(tag).border,
                  }"
                  title="点击按此标签筛选"
                  @click.stop="$emit('filter-tag', tag)"
                >
                  #{{ tag }}
                </span>
              </div>

              <!-- Semantic Chips -->
              <div class="chips-row">
                <span v-if="r.repeat_rule" class="chip chip-repeat">
                  {{ viewModel(r).repeatLabel }}
                </span>

                <span v-if="viewModel(r).near && r.status === 'active'" class="chip chip-near">
                  即将到期
                </span>

                <span v-if="r.status === 'active'" class="chip chip-countdown">
                  {{ viewModel(r).relativeTime }}
                </span>

                <!-- Dynamic countdown badge (Round 44) -->
                <span
                  v-if="viewModel(r).countdown.showBadge"
                  class="chip chip-countdown"
                  :class="{ 'chip-urgent': viewModel(r).countdown.isUrgent }"
                >
                  ⏳ {{ viewModel(r).countdown.text }}
                </span>

                <!-- Local File Path Revealer (Round 53) -->
                <button
                  v-for="p in viewModel(r).paths"
                  :key="p.path"
                  class="chip chip-finder"
                  :disabled="Boolean(revealingPath)"
                  :aria-busy="revealingPath === p.path"
                  :title="'在访达中显示: ' + p.path"
                  @click.stop="handleReveal(p.path)"
                >
                  📁 访达: {{ p.label }}
                </button>

                <span v-if="r.lead_minutes > 0" class="chip chip-lead">
                  提前 {{ r.lead_minutes }} 分
                </span>

                <span v-if="r.duration_minutes > 0" class="chip chip-range">
                  {{ r.duration_minutes }} 分钟
                </span>

                <!-- Subtasks Progress Pill with progress bar (Round 33) -->
                <button
                  v-if="viewModel(r).subtasks.length > 0"
                  type="button"
                  class="chip chip-subtask"
                  :class="{ expanded: expandedSubtasks[r.id] }"
                  @click="toggleSubtaskExpand(r.id)"
                >
                  <span class="st-bar-fill" :style="{ width: `${viewModel(r).progress?.pct || 0}%` }"></span>
                  <span class="st-bar-text">☑️ {{ viewModel(r).progress?.done }}/{{ viewModel(r).progress?.total }} ({{ viewModel(r).progress?.pct }}%)</span>
                </button>

                <!-- URL link pills (Round 35) -->
                <a
                  v-for="link in viewModel(r).urls"
                  :key="link.url"
                  :href="link.url"
                  target="_blank"
                  class="chip chip-link"
                  :title="link.url"
                  @click.stop
                >
                  🔗 {{ link.label }}
                </a>

                <span v-if="r.notes" class="chip chip-notes" :title="r.notes" v-html="highlightMatch(r.notes, searchQuery)">
                </span>

                <span v-if="r.status === 'paused'" class="chip chip-paused">
                  已暂停
                </span>

                <span v-if="r.status === 'ended'" class="chip chip-ended">
                  已完成
                </span>
              </div>

              <!-- Inline Expanded Subtasks Checklist (Round 7) -->
              <div v-if="expandedSubtasks[r.id]" class="inline-subtasks-panel">
                <div
                  v-for="(st, idx) in viewModel(r).subtasks"
                  :key="st.id"
                  class="inline-subtask-item"
                  @click="handleToggleSubtaskItem(r, idx)"
                >
                  <input type="checkbox" :checked="st.done" class="st-check" @click.stop="handleToggleSubtaskItem(r, idx)" />
                  <span class="st-text" :class="{ done: st.done }">{{ st.title }}</span>
                </div>

                <!-- Quick Inline Add Subtask Input -->
                <div class="inline-add-subtask-row" @click.stop>
                  <input
                    v-model="newSubtaskMap[r.id]"
                    type="text"
                    class="inline-add-subtask-input"
                    placeholder="+ 输入待办子项按回车..."
                    @keydown.enter.stop="handleInlineAddSubtask(r)"
                  />
                </div>
              </div>
            </div>

            <!-- Floating Action Capsule (Round 8: Quick Snooze Presets) -->
            <div class="task-actions-capsule">
              <!-- Focus Pomodoro Button (Round 23) -->
              <button
                v-if="r.status === 'active'"
                class="icon-btn focus-action-btn"
                title="开启 25 分钟番茄专注模式"
                @click="$emit('start-focus', r)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15 15" />
                </svg>
              </button>

              <!-- Duplicate / Clone Button (Round 32) -->
              <button
                class="icon-btn"
                title="复刻此日程 (Duplicate)"
                @click="$emit('duplicate', r)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>

              <!-- Quick Snooze Trigger -->
              <div class="snooze-action-wrap">
                <button
                  v-if="r.status === 'active'"
                  class="icon-btn"
                  title="快捷顺延/推迟日程"
                  @click="toggleSnoozeMenu(r.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="12 6 12 12 16 14" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                </button>

                <!-- Snooze Presets Popover Menu (Round 8) -->
                <div v-if="activeSnoozeMenuId === r.id" class="snooze-dropdown glass-panel">
                  <div class="snooze-menu-head">推迟/顺延提醒:</div>
                  <button class="snooze-opt-btn" @click="handleQuickSnooze(r, 15)">+15 分钟</button>
                  <button class="snooze-opt-btn" @click="handleQuickSnooze(r, 30)">+30 分钟</button>
                  <button class="snooze-opt-btn" @click="handleQuickSnooze(r, 60)">+1 小时</button>
                  <button class="snooze-opt-btn" @click="handleQuickSnooze(r, 24 * 60)">推迟至明天</button>
                  <button class="snooze-opt-btn" @click="handleQuickSnooze(r, 7 * 24 * 60)">推迟至下周</button>
                </div>
              </div>

              <!-- Pause / Resume -->
              <button
                v-if="r.status !== 'ended'"
                class="icon-btn"
                :title="r.status === 'paused' ? '恢复提醒' : '暂停提醒（不会完成日程）'"
                @click.stop="$emit('toggle-pause', r)"
              >
                <svg v-if="r.status === 'active'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>

              <!-- Edit -->
              <button class="icon-btn" title="编辑日程" @click="$emit('edit', r)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>

              <!-- Delivery History -->
              <button class="icon-btn" title="查看触发历史" @click="$emit('view-history', r)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </button>

              <!-- Inspector Button -->
              <button
                class="icon-btn inspector-btn"
                :class="{ active: activeInspectorReminder?.id === r.id }"
                title="查看属性详情面板 (I)"
                @click.stop="toggleInspector(r)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="15" y1="3" x2="15" y2="21" />
                </svg>
              </button>

              <button class="icon-btn" title="更多操作" aria-label="更多操作" @click="openActionMenu($event, r)">•••</button>

              <!-- Delete -->
              <button class="icon-btn delete-btn" title="删除日程" @click="$emit('delete', r.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Side Inspector Panel (Midwater / Linear Caliber) -->
    <aside v-if="activeInspectorReminder" class="task-inspector-panel st-reticle">
      <!-- Inspector Header -->
      <div class="inspector-header">
        <div class="inspector-header-left">
          <button
            class="inspector-badge-pri"
            :class="activeInspectorReminder.priority || 'p2'"
            title="点击切换优先级 (P0 → P1 → P2 → P3)"
            @click="cycleInspectorPriority(activeInspectorReminder)"
          >
            {{ (activeInspectorReminder.priority || 'p2').toUpperCase() }}
          </button>

          <button
            class="inspector-badge-status"
            :class="activeInspectorReminder.status"
            title="点击切换完成状态"
            @click="$emit('toggle-status', activeInspectorReminder)"
          >
            {{ activeInspectorReminder.status === 'ended' ? '已完成' : (activeInspectorReminder.status === 'paused' ? '已暂停' : '进行中') }}
          </button>

          <button
            class="pin-star-btn"
            :class="{ active: activeInspectorReminder.is_pinned }"
            :title="activeInspectorReminder.is_pinned ? '取消置顶' : '置顶日程'"
            @click="$emit('toggle-pin', activeInspectorReminder.id)"
          >
            ★
          </button>
        </div>

        <button class="icon-btn inspector-close-btn" title="关闭检查器 (Esc)" @click="activeInspectorReminder = null">
          ✕
        </button>
      </div>

      <!-- Inspector Scrollable Body -->
      <div class="inspector-body custom-scroll">
        <!-- Title Section -->
        <div class="inspector-section">
          <label class="inspector-field-label">日程标题</label>
          <input
            type="text"
            class="inspector-title-input"
            :value="activeInspectorReminder.title"
            @change="handleInspectorTitleChange(activeInspectorReminder, ($event.target as HTMLInputElement).value)"
          />
        </div>

        <!-- Scheduled Time & Fast Reschedule -->
        <div class="inspector-section">
          <label class="inspector-field-label">排期与顺延</label>
          <div class="inspector-time-box">
            <span class="inspector-time-str">
              🕒 {{ viewModel(activeInspectorReminder).dateLabel.label }} {{ viewModel(activeInspectorReminder).time }}
            </span>
            <span
              v-if="viewModel(activeInspectorReminder).countdown.showBadge"
              class="countdown-badge"
              :class="{ urgent: viewModel(activeInspectorReminder).countdown.isUrgent }"
            >
              {{ viewModel(activeInspectorReminder).countdown.text }}
            </span>
          </div>

          <div class="inspector-snooze-chips">
            <button class="snooze-chip" @click="$emit('snooze', activeInspectorReminder, 15)">+15分</button>
            <button class="snooze-chip" @click="$emit('snooze', activeInspectorReminder, 60)">+1小时</button>
            <button class="snooze-chip" @click="$emit('snooze', activeInspectorReminder, 24 * 60)">+1天</button>
            <button class="snooze-chip" @click="$emit('snooze', activeInspectorReminder, 7 * 24 * 60)">+1周</button>
          </div>
        </div>

        <!-- Subtasks Checklist Section -->
        <div class="inspector-section">
          <div class="inspector-subtasks-head">
            <label class="inspector-field-label">
              检查清单
              <span v-if="viewModel(activeInspectorReminder).progress">
                ({{ viewModel(activeInspectorReminder).progress?.done }}/{{ viewModel(activeInspectorReminder).progress?.total }})
              </span>
            </label>
            <span v-if="viewModel(activeInspectorReminder).progress" class="inspector-subtask-pct">
              {{ viewModel(activeInspectorReminder).progress?.pct }}%
            </span>
          </div>

          <div class="inspector-checklist">
            <div
              v-for="(st, idx) in viewModel(activeInspectorReminder).subtasks"
              :key="st.id"
              class="inspector-check-row"
              @click="handleToggleSubtaskItem(activeInspectorReminder, idx)"
            >
              <input
                type="checkbox"
                :checked="st.done"
                class="st-check"
                @click.stop="handleToggleSubtaskItem(activeInspectorReminder, idx)"
              />
              <span class="inspector-st-text" :class="{ done: st.done }">{{ st.title }}</span>
              <button
                class="inspector-st-del"
                title="删除子项"
                @click.stop="handleInspectorDeleteSubtask(activeInspectorReminder, idx)"
              >
                ✕
              </button>
            </div>

            <div class="inspector-add-subtask-row">
              <input
                v-model="inspectorSubtaskInput"
                type="text"
                class="inspector-add-subtask-input"
                placeholder="+ 添加检查项按回车..."
                @keydown.enter.stop="handleInspectorAddSubtask(activeInspectorReminder)"
              />
            </div>
          </div>
        </div>

        <!-- Tags Section -->
        <div v-if="activeInspectorReminder.tags" class="inspector-section">
          <label class="inspector-field-label">标签</label>
          <div class="inspector-tags-cloud">
            <span
              v-for="tag in parseTags(activeInspectorReminder.tags, activeInspectorReminder)"
              :key="tag"
              class="tag-badge"
              :style="{
                backgroundColor: getTagColor(tag).bg,
                color: getTagColor(tag).text,
                borderColor: getTagColor(tag).border,
              }"
              @click="$emit('filter-tag', tag)"
            >
              #{{ tag }}
            </span>
          </div>
        </div>

        <!-- Notes Section -->
        <div v-if="activeInspectorReminder.notes" class="inspector-section">
          <label class="inspector-field-label">详细备注</label>
          <div class="inspector-notes-box">
            {{ activeInspectorReminder.notes }}
          </div>
        </div>

        <!-- Metadata Row -->
        <div class="inspector-section inspector-meta-row">
          <span v-if="activeInspectorReminder.lead_minutes > 0" class="chip chip-lead">
            提前 {{ activeInspectorReminder.lead_minutes }} 分钟
          </span>
          <span class="chip chip-range">
            时长 {{ activeInspectorReminder.duration_minutes || 30 }} 分钟
          </span>
          <span v-if="activeInspectorReminder.repeat_rule" class="chip chip-repeat">
            {{ viewModel(activeInspectorReminder).repeatLabel }}
          </span>
        </div>
      </div>

      <!-- Inspector Footer Dock -->
      <div class="inspector-footer-dock">
        <button
          v-if="activeInspectorReminder.status === 'active'"
          class="inspector-action-btn focus"
          title="开启 25 分钟番茄专注"
          @click="$emit('start-focus', activeInspectorReminder)"
        >
          <span>⚡ 专注</span>
        </button>
        <button
          v-if="activeInspectorReminder.status !== 'ended'"
          class="inspector-action-btn"
          :title="activeInspectorReminder.status === 'paused' ? '恢复提醒' : '暂停提醒'"
          @click="$emit('toggle-pause', activeInspectorReminder)"
        >
          <span>{{ activeInspectorReminder.status === 'paused' ? '恢复' : '暂停' }}</span>
        </button>
        <button
          class="inspector-action-btn primary"
          title="完整编辑弹窗"
          @click="$emit('edit', activeInspectorReminder)"
        >
          <span>✏️ 编辑</span>
        </button>
        <button
          class="inspector-action-btn danger"
          title="移至废纸篓"
          @click="$emit('delete', activeInspectorReminder.id); activeInspectorReminder = null"
        >
          <span>🗑️ 删除</span>
        </button>
      </div>
    </aside>
  </div>

    <!-- Right-click Context Menu (Round 58) -->
    <div
      v-if="contextMenu.visible && contextMenu.reminder"
      ref="contextMenuRef"
      class="context-menu glass-panel"
      role="menu"
      aria-label="日程操作"
      tabindex="-1"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
      @keydown="handleContextMenuKeydown"
    >
      <div class="context-menu-title">{{ contextMenu.reminder.title }}</div>
      <button class="ctx-item" role="menuitem" @click="emit('toggle-pin', contextMenu.reminder!.id); closeContextMenu(true)">
        <span>{{ contextMenu.reminder!.is_pinned ? '★ 取消置顶' : '☆ 置顶日程' }}</span>
      </button>
      <button class="ctx-item" role="menuitem" @click="emit('edit', contextMenu.reminder!); closeContextMenu(true)">
        <span>✎ 编辑日程</span>
      </button>
      <div class="ctx-divider" role="separator"></div>
      <button class="ctx-item" role="menuitem" @click="handleQuickSnooze(contextMenu.reminder!, 15); closeContextMenu(true)">
        <span>⏰ 延后 15 分钟</span>
      </button>
      <button class="ctx-item" role="menuitem" @click="handleQuickSnooze(contextMenu.reminder!, 60); closeContextMenu(true)">
        <span>⏰ 延后 1 小时</span>
      </button>
      <button class="ctx-item" role="menuitem" @click="handleQuickSnooze(contextMenu.reminder!, 24 * 60); closeContextMenu(true)">
        <span>📅 延后至明天此时</span>
      </button>
      <div class="ctx-divider" role="separator"></div>
      <button v-if="contextMenu.reminder!.status !== 'ended'" class="ctx-item" role="menuitem" @click="emit('toggle-pause', contextMenu.reminder!); closeContextMenu(true)">
        <span>{{ contextMenu.reminder!.status === 'paused' ? '恢复提醒' : '暂停提醒' }}</span>
      </button>
      <button class="ctx-item" role="menuitem" @click="emit('duplicate', contextMenu.reminder!); closeContextMenu(true)">
        <span>⧉ 复刻此日程</span>
      </button>
      <div class="ctx-divider" role="separator"></div>
      <button class="ctx-item danger" role="menuitem" @click="emit('delete', contextMenu.reminder!.id); closeContextMenu(true)">
        <span>🗑 移入废纸篓</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.reminder-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.list-controls-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.total-count {
  font-weight: 600;
  color: var(--text-muted);
}

.controls-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sub-filters {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sub-filter-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.16s ease;
}

.sub-filter-pill:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

.sub-filter-pill.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.chip-subtask {
  position: relative;
  overflow: hidden;
}

.st-bar-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--success) 24%, transparent);
  pointer-events: none;
  border-radius: 4px;
}

.st-bar-text {
  position: relative;
  z-index: 1;
}

.chip-link {
  color: var(--tide-text) !important;
  background: color-mix(in srgb, var(--tide) 12%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--tide) 28%, transparent) !important;
  text-decoration: none;
  cursor: pointer;
}

.chip-link:hover {
  background: color-mix(in srgb, var(--tide) 22%, transparent) !important;
  text-decoration: underline;
}

.focus-action-btn:hover {
  color: var(--warning);
}

:deep(mark.search-highlight) {
  background: color-mix(in srgb, var(--lime) 30%, transparent);
  color: inherit;
  padding: 0 2px;
  border-radius: 3px;
}

.sort-select-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sort-label {
  font-size: 12px;
  color: var(--text-muted);
}

.control-dropdown-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.empty-state {
  padding: 48px 24px;
  border-radius: 16px;
  text-align: center;
  margin: 24px 0;
}

.empty-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.empty-title {
  margin: 0 0 6px 0;
  font-size: 16px;
  color: var(--text-primary);
}

.empty-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
}

.empty-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 16px;
}

.empty-sec-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border-l1);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s ease;
}

.empty-sec-btn:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
  border-color: var(--border-l2);
}

.reminder-list-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  width: 100%;
}

.groups-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.group-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  cursor: pointer;
  user-select: none;
}

.group-collapse-arrow {
  font-size: 10px;
  color: var(--text-muted);
  width: 12px;
  text-align: center;
  transition: transform 0.16s ease;
}

.group-header:hover .group-collapse-arrow {
  color: var(--brand-light);
}

.group-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--brand-light);
  text-transform: uppercase;
}

.group-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--brand-light);
  font-weight: 600;
}

/* Side Inspector Panel (Things 3 / Linear caliber) */
.task-inspector-panel {
  width: 330px;
  flex: none;
  position: sticky;
  top: 0;
  max-height: calc(100vh - 140px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-sm);
  animation: slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  background: var(--surface-raised);
}

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: translateX(0); }
}

.inspector-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-l1);
  background: transparent;
}

.inspector-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inspector-badge-pri {
  font-size: 10.5px;
  font-weight: 800;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.14s ease;
}

.inspector-badge-pri.p0 {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 36%, transparent);
}
.inspector-badge-pri.p1 {
  background: color-mix(in srgb, var(--lime) 14%, transparent);
  color: var(--lime-strong);
  border-color: color-mix(in srgb, var(--lime) 38%, transparent);
}
.inspector-badge-pri.p2 {
  background: color-mix(in srgb, var(--tide) 14%, transparent);
  color: var(--tide-text);
  border-color: color-mix(in srgb, var(--tide) 36%, transparent);
}
.inspector-badge-pri.p3 {
  background: var(--fill-hover);
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

.inspector-badge-status {
  font-size: 10.5px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  cursor: pointer;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  color: var(--text-secondary);
}

.inspector-badge-status.ended {
  background: color-mix(in srgb, var(--success) 13%, transparent);
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 34%, transparent);
}

.inspector-badge-status.paused {
  background: color-mix(in srgb, var(--warning) 13%, transparent);
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 34%, transparent);
}

.inspector-close-btn {
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
}

.inspector-body {
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.inspector-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inspector-field-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.inspector-title-input {
  background: var(--input-bg);
  border: 1px solid var(--border-l1);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  outline: none;
  transition: all 0.14s ease;
}

.inspector-title-input:focus {
  border-color: var(--brand-primary);
  background: var(--fill-hover);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.inspector-time-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--fill-subtle);
  border-radius: 8px;
  border: 1px solid var(--border-l1);
}

.inspector-time-str {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.inspector-snooze-chips {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.snooze-chip {
  flex: 1;
  padding: 4px 0;
  border-radius: 999px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;
}

.snooze-chip:hover {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: var(--accent-border);
}

.inspector-checklist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  border-radius: 8px;
  padding: 6px 8px;
}

.inspector-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.inspector-check-row:hover {
  background: var(--fill-hover);
}

.inspector-st-text {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector-st-text.done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.inspector-st-del {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.14s ease;
}

.inspector-check-row:hover .inspector-st-del {
  opacity: 0.8;
}

.inspector-st-del:hover {
  color: var(--danger);
}

.inspector-add-subtask-input {
  width: 100%;
  background: transparent;
  border: 0;
  border-top: 1px dashed var(--border-subtle);
  padding: 6px 4px 2px 4px;
  font-size: 11.5px;
  color: var(--text-primary);
  outline: none;
}

.inspector-notes-box {
  padding: 8px 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

.inspector-footer-dock {
  padding: 10px 14px;
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--border-l1);
  background: transparent;
}

.inspector-action-btn {
  flex: 1;
  height: 32px;
  border-radius: 999px;
  border: 1px solid var(--border-l1);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.14s ease;
}

.inspector-action-btn.focus {
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-color: color-mix(in srgb, var(--warning) 35%, transparent);
  color: var(--warning);
}

.inspector-action-btn.primary {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.inspector-action-btn.danger {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  color: var(--danger);
}

.inspector-action-btn:hover {
  background: var(--fill-hover);
  transform: translateY(-1px);
}

.group-cards {
  border-radius: 14px;
  overflow: visible;
  padding: 4px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  transition: all 0.16s ease;
  position: relative;
}

.task-row:hover {
  background: var(--fill-hover);
}

.task-row.active-focus {
  border-color: var(--accent-border);
  background: var(--fill-active);
}

.task-row.selected {
  background: var(--fill-active);
}

.task-row.near {
  border-left: 3px solid var(--state-warning);
}

.task-row.paused {
  opacity: 0.65;
}

.task-row.ended {
  opacity: 0.55;
}

.task-row.ended .task-title {
  text-decoration: line-through;
  color: var(--text-muted);
}

.task-complete-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--border-l2);
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-on-success);
  flex: none;
  transition: all 0.16s ease;
}

.task-complete-btn:hover {
  border-color: var(--state-success);
  background: color-mix(in srgb, var(--state-success) 15%, transparent);
}

.task-complete-btn.completed {
  background: var(--state-success);
  border-color: var(--state-success);
  box-shadow: 0 0 8px color-mix(in srgb, var(--state-success) 40%, transparent);
}

.inline-title-input {
  background: var(--input-bg);
  border: 1px solid var(--brand-primary);
  border-radius: 6px;
  padding: 3px 8px;
  color: var(--text-primary);
  font-size: 13.5px;
  font-weight: 600;
  width: 80%;
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.inline-add-subtask-row {
  margin-top: 6px;
  padding: 0 2px;
}

.inline-add-subtask-input {
  width: 100%;
  background: var(--fill-subtle);
  border: 1px dashed var(--border-l1);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 11.5px;
  color: var(--text-primary);
  outline: none;
  box-sizing: border-box;
  transition: all 0.14s ease;
}

.inline-add-subtask-input:focus {
  border-color: var(--brand-primary);
  background: var(--fill-hover);
}

.task-check {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid var(--border-l2);
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-on-accent);
  flex: none;
  transition: all 0.14s ease;
}

.task-check:hover {
  border-color: var(--brand-primary);
}

.task-check.checked {
  background: var(--brand-primary);
  border-color: var(--brand-primary);
}

.time-col {
  width: 64px;
  display: flex;
  flex-direction: column;
  flex: none;
}

.time-text {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.date-badge {
  font-size: 10.5px;
  color: var(--text-muted);
}

.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  transition: color 0.14s ease;
}

.task-title:hover {
  color: var(--brand-light);
}

/* Priority Badges (Round 5) */
.badge-priority {
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  flex: none;
}

.badge-priority.p0 {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 36%, transparent);
}

.badge-priority.p1 {
  background: color-mix(in srgb, var(--lime) 14%, transparent);
  color: var(--lime-strong);
  border: 1px solid color-mix(in srgb, var(--lime) 36%, transparent);
}

.badge-priority.p3 {
  background: var(--fill-subtle);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
}

/* Tag Badges */
.tag-badge {
  font-size: 10.5px;
  color: var(--accent-text);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.tag-badge:hover {
  background: var(--accent-border);
  color: var(--text-primary);
}

.chips-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.chip-subtask {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 32%, transparent);
  color: var(--success);
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.14s ease;
}

.chip-subtask:hover,
.chip-subtask.expanded {
  background: color-mix(in srgb, var(--success) 22%, transparent);
  color: var(--text-primary);
}

.inline-subtasks-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--fill-subtle);
  border-radius: 6px;
  border-left: 2px solid var(--tide);
}

.inline-subtask-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-secondary);
}

.inline-subtask-item:hover {
  color: var(--text-primary);
}

.st-text.done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.delete-btn:hover {
  color: var(--danger) !important;
}

/* Quick Snooze Popover Menu */
.snooze-action-wrap {
  position: relative;
}

.snooze-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  background: var(--surface-overlay);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 50;
  width: 120px;
  box-shadow: var(--shadow-lg);
}

.snooze-menu-head {
  font-size: 10.5px;
  color: var(--text-muted);
  font-weight: 600;
  padding: 2px 6px;
}

.snooze-opt-btn {
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--text-primary);
  font-size: 11.5px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.snooze-opt-btn:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

/* Star Pin Button */
.pin-star-btn {
  background: transparent;
  border: none;
  color: var(--text-quaternary);
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: all 0.15s;
}

.pin-star-btn:hover,
.pin-star-btn.active {
  color: var(--warning);
  transform: scale(1.15);
}

.task-row.is-pinned {
  border-left: 2.5px solid var(--warning) !important;
  background: color-mix(in srgb, var(--warning) 6%, transparent);
}

.badge-pinned {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  color: var(--warning);
  border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
  margin-right: 4px;
}

.chip-urgent {
  background: color-mix(in srgb, var(--danger) 14%, transparent) !important;
  color: var(--danger) !important;
  border-color: color-mix(in srgb, var(--danger) 35%, transparent) !important;
  font-weight: 600;
}

.chip-finder {
  background: var(--accent-soft);
  color: var(--accent-text);
  border: 1px solid var(--accent-border);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.chip-finder:hover {
  background: var(--accent-border);
  color: var(--text-primary);
  border-color: var(--accent);
}

/* Right-click Context Menu */
.context-menu {
  position: fixed;
  z-index: 1000;
  background: var(--surface-overlay);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 170px;
  box-shadow: var(--shadow-lg);
  animation: fade-in 0.12s ease;
}

.context-menu-title {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 3px;
  font-weight: 500;
}

.ctx-item {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  transition: all 0.12s;
}

.ctx-item:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

.ctx-item.danger:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.ctx-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 3px 0;
}
</style>
