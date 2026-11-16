<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import {
  formatTime,
  formatEndTime,
  formatDateLabel,
  formatRelativeTime,
  formatRepeatLabel,
  isNearDue,
  extractUrls,
  extractLocalPaths,
  getCountdownBadge,
  highlightMatch,
  formatNotePreview,
} from '../utils/format';
import { getTagColor } from '../utils/tagColors';
import { RevealInFinder } from '../../bindings/agenda/internal/agenda/agendaservice';
import { parseReminderSubtasks, parseReminderTags } from '../domain/reminder';
import { getDailyShanshuiProverb } from '../utils/shanshui';
import { formatMinutesCompact } from '../utils/focus';
import {
  focusDisplayClock,
  focusEngineState,
  hasLiveFocusActivity,
  reminderFocusMap,
} from '../utils/focusEngine';
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
  (e: 'duplicate-offset', reminder: Reminder, offsetDays: number): void;
  (e: 'start-focus', reminder: Reminder): void;
  (e: 'update-title', reminder: Reminder, newTitle: string): void;
  (e: 'update-priority', reminder: Reminder, priority: string): void;
  (e: 'update-notes', reminder: Reminder, notes: string): void;
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
const lastSelectedId = ref<string | null>(null);
const portalTargetReady = ref(false);
const portalTarget = ref('#reminder-inspector-portal');

function ensurePortalTarget(): boolean {
  const hasPortal = Boolean(document.getElementById('reminder-inspector-portal'));
  if (!portalTargetReady.value) {
    portalTarget.value = hasPortal ? '#reminder-inspector-portal' : 'body';
    portalTargetReady.value = true;
  }
  return hasPortal;
}

watch(() => props.activeId, async (id) => {
  if (!id) return;
  await nextTick();
  const row = Array.from(listRootRef.value?.querySelectorAll<HTMLElement>('[data-reminder-id]') || [])
    .find((element) => element.dataset.reminderId === id);
  row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

async function copyReminderTitle(r: Reminder) {
  try {
    await navigator.clipboard?.writeText(r.title);
    emit('toast', '已复制日程标题', 'success');
  } catch {
    emit('toast', '当前环境不支持剪贴板复制', 'error');
  }
}

function resetSubFilters() {
  filterPriority.value = 'all';
  filterHasSubtasks.value = false;
  filterRepeating.value = false;
  filterOverdueOnly.value = false;
}

function handleClearAllSubFilters() {
  resetSubFilters();
  emit('clear-filters');
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
const filterOverdueOnly = ref<boolean>(false);

const expandedSubtasks = ref<Record<string, boolean>>({});
const activeSnoozeMenuId = ref<string | null>(null);
const snoozeFlipUp = ref(false);
const snoozeMenuRef = ref<HTMLElement | null>(null);
const snoozeMenuPos = ref<{ x: number; y: number }>({ x: 0, y: 0 });
const activeSnoozeReminder = computed(() =>
  activeSnoozeMenuId.value
    ? props.reminders.find((item) => item.id === activeSnoozeMenuId.value) || null
    : null
);

interface ReminderViewModel {
  tags: string[];
  subtasks: SubtaskItem[];
  progress: { total: number; done: number; pct: number } | null;
  time: string;
  endTime: string;
  dateLabel: ReturnType<typeof formatDateLabel>;
  relativeTime: string;
  repeatLabel: string;
  near: boolean;
  isOverdue: boolean;
  countdown: ReturnType<typeof getCountdownBadge>;
  urls: ReturnType<typeof extractUrls>;
  paths: ReturnType<typeof extractLocalPaths>;
  metaItems: string[];
  notePreview: string;
}

function formatDurationSummary(minutes: number): string {
  if (minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function buildNotePreview(
  notes: string,
  urls: ReturnType<typeof extractUrls>,
  paths: ReturnType<typeof extractLocalPaths>,
): string {
  if (!notes) return '';
  let text = notes;
  for (const link of urls) {
    text = text.replace(link.url, link.label);
  }
  for (const p of paths) {
    text = text.replace(p.path, p.label);
  }
  return formatNotePreview(text);
}

const reminderViewModels = computed(() => {
  props.nowTick;
  const map = new Map<string, ReminderViewModel>();
  for (const reminder of props.reminders) {
    const subtasks = parseReminderSubtasks(reminder.subtasks);
    const done = subtasks.filter((item) => item.done).length;
    const urls = extractUrls(reminder.notes);
    const paths = extractLocalPaths(`${reminder.notes} ${reminder.title}`);
    const repeatLabel = reminder.repeat_rule ? formatRepeatLabel(reminder.repeat_rule) : '';
    const countdown = getCountdownBadge(reminder.scheduled_at);
    const metaItems: string[] = [];
    if (repeatLabel) metaItems.push(repeatLabel);
    if (reminder.lead_minutes > 0) metaItems.push(`提前 ${reminder.lead_minutes} 分`);
    if (reminder.duration_minutes > 0) metaItems.push(`${reminder.duration_minutes} 分钟`);

    map.set(reminder.id, {
      tags: parseReminderTags(reminder.tags),
      subtasks,
      progress: subtasks.length ? { total: subtasks.length, done, pct: Math.round(done / subtasks.length * 100) } : null,
      time: formatTime(reminder.scheduled_at),
      endTime: formatEndTime(reminder.scheduled_at, reminder.duration_minutes),
      dateLabel: formatDateLabel(reminder.scheduled_at),
      relativeTime: formatRelativeTime(reminder.scheduled_at),
      repeatLabel,
      near: isNearDue(reminder.scheduled_at),
      isOverdue:
        reminder.status === 'expired' ||
        (reminder.status === 'active' && (countdown.isPast || new Date(reminder.scheduled_at).getTime() < Date.now())),
      countdown,
      urls,
      paths,
      metaItems,
      notePreview: buildNotePreview(reminder.notes, urls, paths),
    });
  }
  return map;
});

const hasActiveSubFilter = computed(() =>
  filterPriority.value !== 'all' || filterHasSubtasks.value || filterRepeating.value || filterOverdueOnly.value
);

const subFilterCounts = computed(() => {
  let high = 0;
  let subtasks = 0;
  let repeating = 0;
  let overdue = 0;
  for (const r of props.reminders) {
    const vm = reminderViewModels.value.get(r.id);
    if (r.priority === 'p0' || r.priority === 'p1') high++;
    if ((vm?.subtasks.length || 0) > 0) subtasks++;
    if (r.repeat_rule) repeating++;
    if (vm?.isOverdue) overdue++;
  }
  return { high, subtasks, repeating, overdue };
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
  if (filterOverdueOnly.value) filtered = filtered.filter((r) => viewModel(r).isOverdue);
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
  ensurePortalTarget();
  activeSnoozeMenuId.value = null;
  contextMenuTrigger = trigger;
  contextMenu.value = {
    visible: true,
    x: Math.min(Math.max(10, x), Math.max(10, window.innerWidth - 210)),
    y: Math.min(Math.max(10, y), Math.max(10, window.innerHeight - 480)),
    reminder: r,
  };
  nextTick(() => {
    const menuEl = contextMenuRef.value;
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const maxX = Math.max(10, window.innerWidth - rect.width - 10);
      const maxY = Math.max(10, window.innerHeight - rect.height - 10);
      contextMenu.value.x = Math.min(Math.max(10, x), maxX);
      contextMenu.value.y = Math.min(Math.max(10, y), maxY);
      menuEl.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  });
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
  activeSnoozeMenuId.value = null;
}

function handleListKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

  if (event.key === 'Escape') {
    const hasOtherDialog = Boolean(document.querySelector('[role="dialog"]'));
    if (hasOtherDialog) return;
    if (activeSnoozeMenuId.value) {
      activeSnoozeMenuId.value = null;
      event.stopImmediatePropagation();
    } else if (contextMenu.value.visible) {
      closeContextMenu(true);
      event.stopImmediatePropagation();
    }
    return;
  }

  if (isTyping || contextMenu.value.visible || activeSnoozeMenuId.value) return;
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && listRootRef.value?.contains(target)) {
    const rows = Array.from(listRootRef.value.querySelectorAll<HTMLElement>('.task-row[data-reminder-id]'));
    if (!rows.length) return;
    const currentRow = target?.closest<HTMLElement>('.task-row[data-reminder-id]');
    const idx = currentRow ? rows.indexOf(currentRow) : -1;
    if (idx === -1) return;
    event.preventDefault();
    const nextIdx = event.key === 'ArrowDown' ? (idx + 1) % rows.length : (idx - 1 + rows.length) % rows.length;
    rows[nextIdx].focus();
    rows[nextIdx].scrollIntoView({ block: 'nearest' });
  }
}

onMounted(() => {
  ensurePortalTarget();
  window.addEventListener('click', handleWindowClick);
  window.addEventListener('keydown', handleListKeydown);
});
onUnmounted(() => {
  clearTitleClickTimer();
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
  doneCount: number;
  totalMinutes: number;
  overdueCount: number;
  items: Reminder[];
}

function buildGroup(name: string, items: Reminder[]): ReminderGroup {
  const sorted = sortItems(items);
  let doneCount = 0;
  let totalMinutes = 0;
  let overdueCount = 0;
  for (const r of sorted) {
    if (r.status === 'ended') {
      doneCount++;
    } else {
      totalMinutes += r.duration_minutes > 0 ? r.duration_minutes : 30;
    }
    if (viewModel(r).isOverdue) overdueCount++;
  }
  return { name, count: sorted.length, doneCount, totalMinutes, overdueCount, items: sorted };
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
    if (p0.length) res.push(buildGroup('P0 · 紧急重要', p0));
    if (p1.length) res.push(buildGroup('P1 · 重要规划', p1));
    if (p2.length) res.push(buildGroup('P2 · 常规安排', p2));
    if (p3.length) res.push(buildGroup('P3 · 低优先级', p3));
    return res;
  }

  if (groupBy.value === 'status') {
    const active: Reminder[] = [];
    const expired: Reminder[] = [];
    const paused: Reminder[] = [];
    const ended: Reminder[] = [];

    for (const r of source) {
      if (r.status === 'expired') expired.push(r);
      else if (r.status === 'paused') paused.push(r);
      else if (r.status === 'ended') ended.push(r);
      else active.push(r);
    }

    const res: ReminderGroup[] = [];
    if (active.length) res.push(buildGroup('进行中', active));
    if (expired.length) res.push(buildGroup('已过期', expired));
    if (paused.length) res.push(buildGroup('已暂停', paused));
    if (ended.length) res.push(buildGroup('已完成', ended));
    return res;
  }

  if (groupBy.value === 'none') {
    return [buildGroup('全部事项', source)];
  }

  // Default: groupBy === 'date'
  const today: Reminder[] = [];
  const tomorrow: Reminder[] = [];
  const upcoming: Reminder[] = [];
  const recurring: Reminder[] = [];
  const expired: Reminder[] = [];
  const paused: Reminder[] = [];
  const ended: Reminder[] = [];

  for (const r of source) {
    if (r.status === 'expired') {
      expired.push(r);
      continue;
    }
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
  if (today.length) res.push(buildGroup('今天', today));
  if (tomorrow.length) res.push(buildGroup('明天', tomorrow));
  if (upcoming.length) res.push(buildGroup('即将到来', upcoming));
  if (recurring.length) res.push(buildGroup('重复日程', recurring));
  if (expired.length) res.push(buildGroup('已过期', expired));
  if (paused.length) res.push(buildGroup('已暂停', paused));
  if (ended.length) res.push(buildGroup('已完成', ended));

  return res;
});

const allGroupsCollapsed = computed(() =>
  groups.value.length > 0 && groups.value.every((g) => Boolean(collapsedGroups.value[g.name]))
);

function toggleAllGroupsCollapse() {
  const next = !allGroupsCollapsed.value;
  for (const g of groups.value) {
    collapsedGroups.value[g.name] = next;
  }
}

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

    if (list.length > 0 && list.every((s) => s.done) && r.status === 'active') {
      emit('toast', `「${r.title}」全部子任务已完成！`, 'success');
    }
  }
}

function toggleSnoozeMenu(id: string, event?: MouseEvent) {
  ensurePortalTarget();
  contextMenu.value.visible = false;
  if (activeSnoozeMenuId.value === id) {
    activeSnoozeMenuId.value = null;
    snoozeFlipUp.value = false;
    return;
  }
  const rect = (event?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect();
  snoozeFlipUp.value = rect ? window.innerHeight - rect.bottom < 260 : false;
  if (rect) {
    snoozeMenuPos.value = {
      x: Math.max(10, Math.min(rect.right - 156, window.innerWidth - 166)),
      y: snoozeFlipUp.value ? Math.max(10, rect.top - 246) : Math.min(rect.bottom + 6, window.innerHeight - 250),
    };
  }
  activeSnoozeMenuId.value = id;
  if (rect) {
    nextTick(() => {
      const menuEl = snoozeMenuRef.value;
      if (!menuEl) return;
      const menuRect = menuEl.getBoundingClientRect();
      const shouldFlipUp = rect.bottom + 6 + menuRect.height > window.innerHeight - 12 && rect.top - 6 - menuRect.height >= 10;
      snoozeFlipUp.value = shouldFlipUp;
      const x = Math.min(Math.max(10, rect.right - menuRect.width), Math.max(10, window.innerWidth - menuRect.width - 10));
      const y = shouldFlipUp
        ? Math.max(10, rect.top - menuRect.height - 6)
        : Math.min(rect.bottom + 6, Math.max(10, window.innerHeight - menuRect.height - 10));
      snoozeMenuPos.value = { x, y };
    });
  }
}

function handleQuickSnooze(r: Reminder, minutes: number) {
  activeSnoozeMenuId.value = null;
  emit('snooze', r, minutes);
}

function snoozeToTomorrowMorning(r: Reminder) {
  activeSnoozeMenuId.value = null;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const diffMin = Math.max(1, Math.round((d.getTime() - Date.now()) / 60000));
  emit('snooze', r, diffMin);
}

function snoozeToWeekend(r: Reminder) {
  activeSnoozeMenuId.value = null;
  const d = new Date();
  const day = d.getDay();
  const daysUntilSaturday = ((6 - day + 7) % 7) || 7;
  d.setDate(d.getDate() + daysUntilSaturday);
  d.setHours(10, 0, 0, 0);
  const diffMin = Math.max(1, Math.round((d.getTime() - Date.now()) / 60000));
  emit('snooze', r, diffMin);
}

function snoozeToNextMonday(r: Reminder) {
  activeSnoozeMenuId.value = null;
  const d = new Date();
  const day = d.getDay();
  const daysUntilMonday = ((1 - day + 7) % 7) || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(9, 0, 0, 0);
  const diffMin = Math.max(1, Math.round((d.getTime() - Date.now()) / 60000));
  emit('snooze', r, diffMin);
}

const inlineEditingId = ref<string | null>(null);
const inlineTitle = ref('');
const newSubtaskMap = ref<Record<string, string>>({});
let titleClickTimer: ReturnType<typeof setTimeout> | null = null;

function clearTitleClickTimer() {
  if (titleClickTimer) {
    clearTimeout(titleClickTimer);
    titleClickTimer = null;
  }
}

function handleTaskRowClick(e: MouseEvent, r: Reminder) {
  emit('activate', r.id);
  const target = e.target as HTMLElement | null;
  if (target?.closest('.task-title')) {
    clearTitleClickTimer();
    if (e.detail >= 2) return;
    titleClickTimer = setTimeout(() => {
      titleClickTimer = null;
      emit('edit', r);
    }, 180);
    return;
  }
  emit('edit', r);
}

function startInlineEdit(r: Reminder) {
  clearTitleClickTimer();
  inlineEditingId.value = r.id;
  inlineTitle.value = r.title;
  nextTick(() => {
    const input = listRootRef.value?.querySelector<HTMLInputElement>('.inline-title-input');
    input?.focus();
    input?.select();
  });
}

const dailyShanshuiVerse = computed(() => getDailyShanshuiProverb(new Date()));

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
  <div ref="listRootRef" class="reminder-list" :class="{ 'has-selection': selectedIds.length > 0 }">
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
        <span class="total-count tabular-nums">
          <template v-if="hasActiveSubFilter">显示 {{ visibleReminderIds.length }} / {{ reminders.length }} 项</template>
          <template v-else>共 {{ reminders.length }} 项日程</template>
        </span>

        <!-- Quick filter pills (Round 29) -->
        <div class="sub-filters">
          <button
            class="sub-filter-pill"
            :class="{ active: !hasActiveSubFilter }"
            @click="resetSubFilters"
          >全部</button>
          <button
            class="sub-filter-pill"
            :class="{ active: filterPriority === 'high' }"
            @click="filterPriority = filterPriority === 'high' ? 'all' : 'high'"
          >
            <span>高优先级</span>
            <span v-if="subFilterCounts.high > 0" class="pill-count tabular-nums">{{ subFilterCounts.high }}</span>
          </button>
          <button
            v-if="subFilterCounts.overdue > 0 || filterOverdueOnly"
            class="sub-filter-pill overdue-pill"
            :class="{ active: filterOverdueOnly }"
            @click="filterOverdueOnly = !filterOverdueOnly"
          >
            <span>已逾期</span>
            <span v-if="subFilterCounts.overdue > 0" class="pill-count tabular-nums">{{ subFilterCounts.overdue }}</span>
          </button>
          <button
            class="sub-filter-pill"
            :class="{ active: filterHasSubtasks }"
            @click="filterHasSubtasks = !filterHasSubtasks"
          >
            <span>含子任务</span>
            <span v-if="subFilterCounts.subtasks > 0" class="pill-count tabular-nums">{{ subFilterCounts.subtasks }}</span>
          </button>
          <button
            class="sub-filter-pill"
            :class="{ active: filterRepeating }"
            @click="filterRepeating = !filterRepeating"
          >
            <span>重复日程</span>
            <span v-if="subFilterCounts.repeating > 0" class="pill-count tabular-nums">{{ subFilterCounts.repeating }}</span>
          </button>
          <button
            v-if="hasActiveSubFilter"
            class="sub-filter-pill reset-pill"
            title="重置次级筛选"
            @click="resetSubFilters"
          >重置</button>
        </div>
      </div>

      <div class="controls-right">
        <button
          v-if="groups.length > 1"
          type="button"
          class="sub-filter-pill collapse-all-btn"
          :title="allGroupsCollapsed ? '展开所有分组' : '收起所有分组'"
          @click="toggleAllGroupsCollapse"
        >
          {{ allGroupsCollapsed ? '展开分组' : '收起分组' }}
        </button>
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
      <div class="empty-icon empty-shanshui-moon" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" width="54" height="54">
          <circle cx="32" cy="32" r="27" stroke-dasharray="3 3" opacity="0.45" />
          <circle cx="43" cy="21" r="4.5" fill="var(--seal-red, currentColor)" stroke="none" opacity="0.82" />
          <path d="M9 40 Q20 26 30 35 T55 34" stroke="currentColor" stroke-linecap="round" opacity="0.85" />
          <path d="M12 45 Q26 38 38 43 T53 43" stroke="currentColor" stroke-linecap="round" opacity="0.5" />
          <path d="M18 50 H46" stroke="currentColor" stroke-linecap="round" opacity="0.3" />
        </svg>
      </div>
      <h3 class="empty-title">{{ reminders.length === 0 ? '当前暂无匹配日程' : '当前筛选没有结果' }}</h3>
      <p class="empty-subtitle">{{ reminders.length === 0 ? `「${dailyShanshuiVerse.text}」—— ${dailyShanshuiVerse.source}` : '尝试调整优先级、已逾期、子任务或循环提醒筛选条件' }}</p>
      <div class="empty-actions">
        <button v-if="reminders.length > 0" class="primary-btn" @click="handleClearAllSubFilters">
          <span>清除当前筛选</span>
        </button>
        <button :class="reminders.length === 0 ? 'primary-btn' : 'empty-sec-btn'" @click="$emit('open-create')">
          <span class="icon-inline">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>新建日程</span>
          </span>
        </button>
        <button class="empty-sec-btn" @click="$emit('open-ai')">
          <span>AI 规划</span>
        </button>
        <button v-if="reminders.length === 0" class="empty-sec-btn" @click="handleClearAllSubFilters">
          <span>清除筛选</span>
        </button>
      </div>
    </div>

    <!-- Groups List -->
    <div v-else class="reminder-list-layout">
      <div class="groups-wrap">
        <div v-for="g in groups" :key="g.name" class="group-section">
          <button
            class="group-header"
            type="button"
            :aria-expanded="!collapsedGroups[g.name]"
            :aria-controls="`agenda-group-${g.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-')}`"
            @click="toggleGroupCollapse(g.name)"
          >
            <span class="group-collapse-arrow" :class="{ expanded: !collapsedGroups[g.name] }">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <span class="group-title">{{ g.name }}</span>
            <span class="group-badge">{{ g.count }}</span>
            <span v-if="g.doneCount > 0 && g.doneCount < g.count" class="group-meta-pill done tabular-nums">
              已完 {{ g.doneCount }}/{{ g.count }}
            </span>
            <span v-if="g.totalMinutes > 0" class="group-meta-pill tabular-nums">
              {{ formatDurationSummary(g.totalMinutes) }}
            </span>
            <span v-if="g.overdueCount > 0" class="group-meta-pill overdue tabular-nums">
              逾期 {{ g.overdueCount }}
            </span>
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
                'active-focus': activeId === r.id,
                'is-pinned': r.is_pinned,
                near: viewModel(r).near && r.status === 'active',
                overdue: viewModel(r).isOverdue,
                'menu-open': activeSnoozeMenuId === r.id,
                paused: r.status === 'paused',
                expired: r.status === 'expired',
                ended: r.status === 'ended',
              }"
              @focus="$emit('activate', r.id)"
              @click="(e) => handleTaskRowClick(e, r)"
              @keydown.enter.prevent="$emit('edit', r)"
              @keydown.f2.prevent="startInlineEdit(r)"
              @contextmenu="openContextMenu($event, r)"
              @keydown.shift.f10.prevent="openKeyboardMenu($event, r)"
            >
              <!-- Compact Lead Controls (Complete Circle + Multi-select Checkbox) -->
              <div class="row-lead-controls" @click.stop>
                <button
                  class="task-complete-btn"
                  :class="{ completed: r.status === 'ended', paused: r.status === 'paused', expired: r.status === 'expired' }"
                  :title="r.status === 'ended' ? '点击重新恢复未完成' : '点击标记完成'"
                  :aria-label="r.status === 'ended' ? `重新开启 ${r.title}` : `完成 ${r.title}`"
                  :aria-pressed="r.status === 'ended'"
                  @click.stop="$emit('toggle-status', r)"
                >
                  <svg v-if="r.status === 'ended'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="10" height="10">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>

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
              </div>

              <!-- Time Column -->
              <div class="time-col">
                <span class="time-text tabular-nums" :class="{ overdue: viewModel(r).isOverdue }">{{ viewModel(r).time }}</span>
                <span v-if="viewModel(r).endTime" class="time-end tabular-nums">~{{ viewModel(r).endTime }}</span>
                <span class="date-badge">{{ viewModel(r).dateLabel.label }}</span>
              </div>

              <!-- Main Content -->
              <div class="main-col">
                <div class="title-header-row">
                  <div class="title-line">
                    <!-- Pinned Tag -->
                    <span v-if="r.is_pinned" class="badge-pinned">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <span>置顶</span>
                    </span>

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
                      title="双击或按 F2 重命名，单击打开编辑"
                      @dblclick.stop="startInlineEdit(r)"
                      v-html="highlightMatch(r.title, searchQuery)"
                    ></span>

                    <!-- Colored Tag Badges (max 3 inline + overflow count) -->
                    <span
                      v-for="tag in parseTags(r.tags, r).slice(0, 3)"
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
                    <span
                      v-if="parseTags(r.tags, r).length > 3"
                      class="tag-badge tag-overflow-badge"
                      :title="parseTags(r.tags, r).map(t => `#${t}`).join(' · ')"
                    >
                      +{{ parseTags(r.tags, r).length - 3 }}
                    </span>
                  </div>

                  <!-- Streamlined In-flow Action Capsule (zero overlap with title/tags) -->
                  <div class="task-actions-capsule" @click.stop>
                    <button
                      class="icon-btn pin-action-btn"
                      :class="{ active: r.is_pinned }"
                      :title="r.is_pinned ? '取消置顶' : '置顶日程'"
                      @click.stop="$emit('toggle-pin', r.id)"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" :fill="r.is_pinned ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>

                    <div v-if="r.status === 'active' || r.status === 'expired'" class="snooze-action-wrap">
                      <button
                        class="icon-btn"
                        :class="{ active: activeSnoozeMenuId === r.id }"
                        title="快捷顺延/推迟日程"
                        aria-haspopup="menu"
                        :aria-expanded="activeSnoozeMenuId === r.id"
                        @click.stop="toggleSnoozeMenu(r.id, $event)"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                          <polyline points="12 6 12 12 16 14" />
                          <circle cx="12" cy="12" r="10" />
                        </svg>
                      </button>
                    </div>

                    <button
                      v-if="r.status === 'active' || r.status === 'expired'"
                      class="icon-btn focus-action-btn"
                      :class="{ active: focusEngineState.reminderId === r.id && focusEngineState.isRunning }"
                      title="启动番茄专注 (P)"
                      aria-label="启动番茄专注"
                      @click.stop="$emit('start-focus', r)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                        <circle cx="12" cy="13" r="8" />
                        <path d="M12 9v4l2.5 1.5" />
                        <path d="M9 2h6" />
                      </svg>
                    </button>

                    <button class="icon-btn" title="编辑日程" @click.stop="$emit('edit', r)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>

                    <button class="icon-btn" title="更多操作" aria-label="更多操作" @click.stop="openActionMenu($event, r)">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.7" />
                        <circle cx="12" cy="12" r="1.7" />
                        <circle cx="19" cy="12" r="1.7" />
                      </svg>
                    </button>

                    <button class="icon-btn delete-btn" title="删除日程" @click.stop="$emit('delete', r.id)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

              <!-- Unified Status / Interactive Chips + Quiet Inline Metadata -->
              <div class="chips-row">
                <span
                  class="chip chip-inline-time tabular-nums"
                  :class="{ overdue: viewModel(r).isOverdue }"
                >
                  {{ viewModel(r).dateLabel.label }} {{ viewModel(r).time }}{{ viewModel(r).endTime ? `-${viewModel(r).endTime}` : '' }}
                </span>

                <span v-if="r.status === 'paused'" class="chip chip-paused">
                  已暂停
                </span>

                <span v-else-if="r.status === 'ended'" class="chip chip-ended">
                  已完成
                </span>

                <span v-else-if="r.status === 'expired'" class="chip chip-expired">
                  已过期
                </span>

                <span
                  v-else-if="viewModel(r).countdown.showBadge"
                  class="chip chip-countdown icon-inline"
                  :class="{ 'chip-urgent': viewModel(r).countdown.isUrgent || viewModel(r).near }"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15.5 14" />
                  </svg>
                  <span>{{ viewModel(r).near && !viewModel(r).countdown.text.includes('逾期') ? `即将 · ${viewModel(r).countdown.text}` : viewModel(r).countdown.text }}</span>
                </span>

                <span v-else class="chip chip-countdown">
                  {{ viewModel(r).relativeTime }}
                </span>

                <!-- Active or Accumulated Focus Telemetry Pill -->
                <button
                  v-if="focusEngineState.reminderId === r.id && hasLiveFocusActivity"
                  type="button"
                  class="chip chip-focus-live tabular-nums"
                  :class="{ running: focusEngineState.isRunning }"
                  title="点击打开当前专注计时弹窗"
                  @click.stop="$emit('start-focus', r)"
                >
                  {{ focusEngineState.isRunning ? '专注中' : '已暂停' }} {{ focusDisplayClock }}
                </button>
                <span
                  v-else-if="reminderFocusMap.get(r.id)"
                  class="chip chip-focus-total tabular-nums"
                  :title="`累计已专注 ${reminderFocusMap.get(r.id)?.sessions} 轮`"
                >
                  已专注 {{ formatMinutesCompact(reminderFocusMap.get(r.id)?.totalMinutes || 0) }}
                </span>

                <!-- Subtasks Progress Pill -->
                <button
                  v-if="viewModel(r).subtasks.length > 0"
                  type="button"
                  class="chip chip-subtask"
                  :class="{ expanded: expandedSubtasks[r.id] }"
                  title="展开或收起子任务"
                  @click.stop="toggleSubtaskExpand(r.id)"
                >
                  <span class="st-bar-fill" :style="{ width: `${viewModel(r).progress?.pct || 0}%` }"></span>
                  <span class="st-bar-text icon-inline">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    <span>{{ viewModel(r).progress?.done }}/{{ viewModel(r).progress?.total }}</span>
                  </span>
                </button>

                <!-- Local File Path Revealer -->
                <button
                  v-for="p in viewModel(r).paths"
                  :key="p.path"
                  class="chip chip-finder icon-inline"
                  :disabled="Boolean(revealingPath)"
                  :aria-busy="revealingPath === p.path"
                  :title="'在访达中显示: ' + p.path"
                  @click.stop="handleReveal(p.path)"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>访达: {{ p.label }}</span>
                </button>

                <!-- URL Link Pills -->
                <a
                  v-for="link in viewModel(r).urls"
                  :key="link.url"
                  :href="link.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="chip chip-link icon-inline"
                  :title="link.url"
                  @click.stop
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <span>{{ link.label }}</span>
                </a>

                <!-- Calm inline secondary metadata -->
                <span v-if="viewModel(r).metaItems.length > 0" class="meta-inline-group">
                  <template v-for="(item, idx) in viewModel(r).metaItems" :key="item">
                    <span v-if="idx > 0" class="meta-inline-dot" aria-hidden="true">·</span>
                    <span class="meta-inline-item">{{ item }}</span>
                  </template>
                </span>
              </div>

              <!-- Clean 1-line Note Preview -->
              <p
                v-if="viewModel(r).notePreview"
                class="task-note-preview"
                :title="r.notes"
                v-html="highlightMatch(viewModel(r).notePreview, searchQuery)"
              ></p>

              <!-- Inline Expanded Subtasks Checklist (Round 7) -->
              <div v-if="expandedSubtasks[r.id]" class="inline-subtasks-panel" @click.stop>
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
          </div>
        </div>
      </div>
    </div>
    </div>

    <!-- Right-click Context Menu (Round 58) -->
    <Teleport v-if="portalTargetReady" :to="portalTarget">
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
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" :fill="contextMenu.reminder!.is_pinned ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span>{{ contextMenu.reminder!.is_pinned ? '取消置顶' : '置顶日程' }}</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="emit('edit', contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>编辑日程</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="copyReminderTitle(contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>复制标题</span>
        </span>
      </button>
      <div class="ctx-divider" role="separator"></div>
      <button class="ctx-item" role="menuitem" @click="handleQuickSnooze(contextMenu.reminder!, 15); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
          </svg>
          <span>顺延 15 分钟</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="handleQuickSnooze(contextMenu.reminder!, 60); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
          </svg>
          <span>顺延 1 小时</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="snoozeToTomorrowMorning(contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M17 18a5 5 0 0 0-10 0" />
            <line x1="12" y1="2" x2="12" y2="9" />
            <line x1="4.22" y1="10.22" x2="5.64" y2="11.64" />
            <line x1="1" y1="18" x2="3" y2="18" />
            <line x1="21" y1="18" x2="23" y2="18" />
            <line x1="18.36" y1="11.64" x2="19.78" y2="10.22" />
            <line x1="23" y1="22" x2="1" y2="22" />
          </svg>
          <span>顺延至明天 09:00</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="snoozeToWeekend(contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>顺延至本周末 (周六)</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="snoozeToNextMonday(contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 14 4 9 9 4" />
            <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
          </svg>
          <span>顺延至下周一 09:00</span>
        </span>
      </button>
      <div class="ctx-divider" role="separator"></div>
      <button v-if="contextMenu.reminder!.status === 'active' || contextMenu.reminder!.status === 'expired'" class="ctx-item" role="menuitem" @click="emit('start-focus', contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
          <span>开启 25 分钟番茄专注</span>
        </span>
      </button>
      <button v-if="contextMenu.reminder!.status === 'active' || contextMenu.reminder!.status === 'paused'" class="ctx-item" role="menuitem" @click="emit('toggle-pause', contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg v-if="contextMenu.reminder!.status === 'paused'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
          <span>{{ contextMenu.reminder!.status === 'paused' ? '恢复提醒' : '暂停提醒' }}</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="emit('view-history', contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>查看触发历史</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="emit('duplicate', contextMenu.reminder!); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>复刻排期至明日 (+1天)</span>
        </span>
      </button>
      <button class="ctx-item" role="menuitem" @click="emit('duplicate-offset', contextMenu.reminder!, 7); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>克隆为下周同时间 (+7天)</span>
        </span>
      </button>
      <div class="ctx-divider" role="separator"></div>
      <button class="ctx-item danger" role="menuitem" @click="emit('delete', contextMenu.reminder!.id); closeContextMenu(true)">
        <span class="icon-inline">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span>移入废纸篓</span>
        </span>
      </button>
      </div>
    </Teleport>

    <!-- Teleported Snooze Popover Menu -->
    <Teleport v-if="portalTargetReady" :to="portalTarget">
      <div
        v-if="activeSnoozeMenuId && activeSnoozeReminder"
        ref="snoozeMenuRef"
        class="snooze-dropdown glass-panel"
        :class="{ 'flip-up': snoozeFlipUp }"
        role="menu"
        aria-label="快捷推迟顺延"
        :style="{ left: `${snoozeMenuPos.x}px`, top: `${snoozeMenuPos.y}px` }"
        @click.stop
      >
        <div class="snooze-menu-head">智能推迟 / 顺延</div>
        <button class="snooze-opt-btn" role="menuitem" @click="handleQuickSnooze(activeSnoozeReminder, 15)">+15 分钟</button>
        <button class="snooze-opt-btn" role="menuitem" @click="handleQuickSnooze(activeSnoozeReminder, 30)">+30 分钟</button>
        <button class="snooze-opt-btn" role="menuitem" @click="handleQuickSnooze(activeSnoozeReminder, 60)">+1 小时</button>
        <button class="snooze-opt-btn" role="menuitem" @click="snoozeToTomorrowMorning(activeSnoozeReminder)">明早 09:00</button>
        <button class="snooze-opt-btn" role="menuitem" @click="snoozeToWeekend(activeSnoozeReminder)">本周末 (周六)</button>
        <button class="snooze-opt-btn" role="menuitem" @click="snoozeToNextMonday(activeSnoozeReminder)">下周一 09:00</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.chip-subtask {
  position: relative;
  overflow: hidden;
  cursor: pointer;
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

.focus-action-btn:hover,
.focus-action-btn.active {
  color: var(--tide-text);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.chip-focus-live {
  color: var(--tide-text) !important;
  background: var(--accent-soft) !important;
  border: 1px solid var(--accent-border) !important;
  font-weight: 700;
  cursor: pointer;
}

.chip-focus-live.running {
  box-shadow: 0 0 10px -2px color-mix(in srgb, var(--tide) 48%, transparent);
}

.chip-focus-total {
  color: var(--text-tertiary) !important;
  background: var(--fill-subtle) !important;
  border: 1px solid var(--border-subtle) !important;
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

.icon-inline {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.icon-inline svg {
  flex: none;
}

.group-collapse-arrow {
  display: inline-grid;
  place-items: center;
  color: var(--text-muted);
  width: 14px;
  height: 14px;
  transition: transform 0.16s ease, color 0.14s ease;
}

.group-collapse-arrow.expanded {
  transform: rotate(90deg);
}

.group-header:hover .group-collapse-arrow {
  color: var(--brand-light);
}

.task-row.ended .task-title {
  text-decoration: line-through;
  color: var(--text-muted);
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

.pill-count {
  display: inline-block;
  margin-left: 4px;
  font-size: 9.5px;
  opacity: 0.72;
}

.reset-pill {
  color: var(--accent-text);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.overdue-pill.active {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 42%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}

.collapse-all-btn {
  flex: none;
}

.group-meta-pill {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  font: 600 10px var(--font-mono);
}

.group-meta-pill.overdue {
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger);
}

.group-meta-pill.done {
  border-color: color-mix(in srgb, var(--success) 32%, transparent);
  background: color-mix(in srgb, var(--success) 9%, transparent);
  color: var(--success);
}

.time-end {
  color: var(--text-quaternary);
  font: 600 9.5px/1.15 var(--font-mono);
}

.time-text.overdue {
  color: var(--danger);
}

.tag-overflow-badge {
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  border-color: var(--border-subtle);
}

.chip-inline-time {
  display: none;
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text-secondary);
}

.chip-inline-time.overdue {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.st-check {
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
  cursor: pointer;
  flex: none;
}

.st-text {
  line-height: 1.4;
  transition: color 0.14s ease;
}

.inline-subtask-item {
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background 0.12s ease, color 0.12s ease;
}

.inline-subtask-item:hover {
  color: var(--text-primary);
  background: var(--fill-hover);
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
  z-index: calc(var(--z-overlay) + 5);
  background: var(--surface-overlay);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 184px;
  max-height: calc(100vh - 20px);
  overflow-y: auto;
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
