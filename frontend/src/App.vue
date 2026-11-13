<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { Events, Window } from '@wailsio/runtime';
import {
  GetReminders,
  AddReminder,
  UpdateReminder,
  DeleteReminder,
  BatchDelete,
  BatchSetStatus,
  BatchSetPriority,
  BatchSetPinned,
  BatchAddTag,
  TogglePinReminder,
  GetDeliveryHistory,
  ExportICS,
  ImportICS,
  ExportCSV,
  ImportCSVContent,
  TriggerTestNotification,
  DuplicateReminder,
  RestoreReminder,
  OptimizeDatabase,
} from '../bindings/agenda/internal/agenda/agendaservice';
import type { Reminder, DeliveryRecord, UpdateReminderRequest } from '../bindings/agenda/internal/agenda/models';
import type { ParsedReminder } from './utils/nlp';
import { formatDateLabel } from './utils/format';
import { playReminderChime, playCompleteSound } from './utils/audio';
import { exportToMarkdown, copyMarkdownToClipboard, triggerFileDownload } from './utils/export';
import { parseReminderTags, toUpdateReminderRequest } from './domain/reminder';

import type { StatsData, AgendaView } from './types/ui';
import NavigationSidebar from './components/NavigationSidebar.vue';
import WorkspaceHeader from './components/WorkspaceHeader.vue';
import QuickAddBar from './components/QuickAddBar.vue';
import WeekStrip from './components/WeekStrip.vue';
import HorizonBentoStrip from './components/HorizonBentoStrip.vue';
import ReminderList from './components/ReminderList.vue';
import WeekTimelineView from './components/WeekTimelineView.vue';
import MonthCalendar from './components/MonthCalendar.vue';
import EisenhowerMatrixView from './components/EisenhowerMatrixView.vue';
import ReminderEditorModal from './components/ReminderEditorModal.vue';
import HistoryModal from './components/HistoryModal.vue';
import StatsDashboardModal from './components/StatsDashboardModal.vue';
import BatchActionBar from './components/BatchActionBar.vue';
import ToastNotice from './components/ToastNotice.vue';
import TideSwirlCanvas from './components/TideSwirlCanvas.vue';
import SettingsModal from './components/SettingsModal.vue';
import AIAssistantDrawer from './components/AIAssistantDrawer.vue';
import FocusTimerModal from './components/FocusTimerModal.vue';
import DailyBriefingModal from './components/DailyBriefingModal.vue';
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.vue';
import TrashModal from './components/TrashModal.vue';
import CommandPaletteModal from './components/CommandPaletteModal.vue';

// Element Refs for shortcuts
const workspaceHeaderRef = ref<InstanceType<typeof WorkspaceHeader> | null>(null);
const quickAddRef = ref<InstanceType<typeof QuickAddBar> | null>(null);

// State
const reminders = ref<Reminder[]>([]);
const isQuickAdding = ref(false);
const isLoading = ref(true);
const hasLoadedReminders = ref(false);
const selectedIds = ref<string[]>([]);
const isBatchBusy = ref(false);
const validViews: AgendaView[] = ['list', 'week', 'month', 'matrix'];
const storedView = localStorage.getItem('agenda_current_view') as AgendaView | null;
const currentView = ref<AgendaView>(storedView && validViews.includes(storedView) ? storedView : 'list');
watch(currentView, (v) => {
  localStorage.setItem('agenda_current_view', v);
});
const searchQuery = ref('');
const activeFilter = ref('all'); // all, today, near, active, paused
const selectedDate = ref<string | null>(null);
const selectedTag = ref<string | null>(null);
const filterOverdueOnly = ref(false);
const nowTick = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;

const overdueCount = computed(() => {
  const now = nowTick.value;
  return reminders.value.filter((r) => r.status === 'active' && new Date(r.scheduled_at).getTime() < now).length;
});
const activeId = ref<string | null>(null);

watch(reminders, (items) => {
  const existingIds = new Set(items.map((item) => item.id));
  selectedIds.value = selectedIds.value.filter((id) => existingIds.has(id));
  if (activeId.value && !existingIds.has(activeId.value)) activeId.value = null;
});

watch([currentView, activeFilter, selectedDate, selectedTag, filterOverdueOnly], () => {
  selectedIds.value = [];
  activeId.value = null;
});

// Modals
const showEditor = ref(false);
const isSavingEditor = ref(false);
const editingReminder = ref<Reminder | null>(null);
const initialEditorDate = ref<string | null>(null);

const showHistory = ref(false);
const isHistoryLoading = ref(false);
let historyRequestSequence = 0;
const historyTitle = ref('');
const historyRecords = ref<DeliveryRecord[]>([]);

const showSettings = ref(false);
const showAIDrawer = ref(false);
const showStatsDashboard = ref(false);

// Pro Modals (Rounds 23, 28, 30, 39)
const showFocusTimer = ref(false);
const focusReminder = ref<Reminder | null>(null);
const showDailyBriefing = ref(false);
const showKeyboardShortcuts = ref(false);
const showTrash = ref(false);
const showCommandPalette = ref(false);
const isCompactMode = ref(localStorage.getItem('agenda_compact_mode') === 'true');
watch(isCompactMode, (value) => localStorage.setItem('agenda_compact_mode', String(value)));
const isSidebarCollapsed = ref(localStorage.getItem('agenda_sidebar_collapsed') === 'true');
watch(isSidebarCollapsed, (v) => localStorage.setItem('agenda_sidebar_collapsed', String(v)));
const isSoundEnabled = ref(localStorage.getItem('agenda_sound_enabled') !== 'false');

const activeOverlayKey = computed(() => {
  if (showCommandPalette.value) return 'command';
  if (showFocusTimer.value) return 'focus';
  if (showDailyBriefing.value) return 'briefing';
  if (showKeyboardShortcuts.value) return 'shortcuts';
  if (showTrash.value) return 'trash';
  if (showStatsDashboard.value) return 'stats';
  if (showEditor.value) return 'editor';
  if (showHistory.value) return 'history';
  if (showSettings.value) return 'settings';
  if (showAIDrawer.value) return 'assistant';
  return '';
});
const hasOpenOverlay = computed(() => Boolean(activeOverlayKey.value));
let focusBeforeOverlay: HTMLElement | null = null;

function getTopDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs.length ? dialogs[dialogs.length - 1] : null;
}

watch(activeOverlayKey, async (current, previous) => {
  if (current && !previous) {
    focusBeforeOverlay = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  if (current) {
    await nextTick();
    const dialog = getTopDialog();
    const autofocus = dialog?.querySelector<HTMLElement>('[autofocus]');
    const firstControl = dialog?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])');
    (autofocus || firstControl || dialog)?.focus();
  } else if (previous) {
    await nextTick();
    focusBeforeOverlay?.focus();
    focusBeforeOverlay = null;
  }
});

function trapDialogFocus(event: KeyboardEvent): boolean {
  if (event.key !== 'Tab' || !hasOpenOverlay.value) return false;
  const dialog = getTopDialog();
  if (!dialog) return false;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.offsetParent !== null);
  if (!controls.length) {
    event.preventDefault();
    dialog.focus();
    return true;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
  return true;
}

function isWithinQuietHours(date = new Date()): boolean {
  if (localStorage.getItem('agenda_dnd_enabled') !== 'true') return false;

  const parseMinutes = (value: string | null, fallback: number) => {
    const [hours, minutes] = (value || '').split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
    return hours * 60 + minutes;
  };

  const start = parseMinutes(localStorage.getItem('agenda_dnd_start'), 23 * 60);
  const end = parseMinutes(localStorage.getItem('agenda_dnd_end'), 8 * 60);
  const current = date.getHours() * 60 + date.getMinutes();

  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function handleToggleSound() {
  isSoundEnabled.value = !isSoundEnabled.value;
  localStorage.setItem('agenda_sound_enabled', String(isSoundEnabled.value));
  showToast(isSoundEnabled.value ? '已开启提示音' : '已静音提示音', 'info');
}

const reminderMutationQueues = new Map<string, Promise<void>>();
let pendingMutationRefresh = false;

function requestRemindersRefresh() {
  if (reminderMutationQueues.size) {
    pendingMutationRefresh = true;
    return;
  }
  void loadReminders();
}

async function updateReminderLatest(
  snapshot: Reminder,
  patch: Partial<Omit<UpdateReminderRequest, 'id'>>,
): Promise<void> {
  const previous = reminderMutationQueues.get(snapshot.id) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const initialIndex = reminders.value.findIndex((item) => item.id === snapshot.id);
    const latest = initialIndex >= 0 ? reminders.value[initialIndex] : snapshot;
    const before = { ...latest };
    const optimistic = { ...latest, ...patch } as Reminder;
    if (initialIndex >= 0) reminders.value[initialIndex] = optimistic;

    try {
      const saved = await UpdateReminder(toUpdateReminderRequest(latest, patch));
      const currentIndex = reminders.value.findIndex((item) => item.id === snapshot.id);
      if (currentIndex >= 0 && saved) reminders.value[currentIndex] = saved;
    } catch (error) {
      const currentIndex = reminders.value.findIndex((item) => item.id === snapshot.id);
      if (currentIndex >= 0) reminders.value[currentIndex] = before;
      throw error;
    }
  });
  reminderMutationQueues.set(snapshot.id, operation);
  try {
    await operation;
  } finally {
    if (reminderMutationQueues.get(snapshot.id) === operation) reminderMutationQueues.delete(snapshot.id);
    if (!reminderMutationQueues.size && pendingMutationRefresh) {
      pendingMutationRefresh = false;
      void loadReminders();
    }
  }
}

async function handleInlineUpdateTitle(reminder: Reminder, newTitle: string) {
  try {
    await updateReminderLatest(reminder, { title: newTitle });
    showToast('已更新日程标题', 'success');
  } catch (err: any) {
    showToast(`更新标题失败: ${err.message || err}`, 'error');
  }
}

function handleDateFilter(date: string | null) {
  selectedDate.value = date;
  if (date) {
    currentView.value = 'list';
    selectedTag.value = null;
    filterOverdueOnly.value = false;
    activeFilter.value = 'all';
  }
}

function handleTagFilter(tag: string | null) {
  selectedTag.value = tag;
  if (tag) {
    currentView.value = 'list';
    activeFilter.value = 'all';
    selectedDate.value = null;
    filterOverdueOnly.value = false;
  }
}

function handleClearAllFilters() {
  selectedDate.value = null;
  selectedTag.value = null;
  filterOverdueOnly.value = false;
  activeFilter.value = 'all';
  searchQuery.value = '';
}

// Toast & Undo
const toastVisible = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error' | 'info'>('info');
const hasUndo = ref(false);
const lastDeletedId = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout>;

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info', undoId?: string) {
  toastMessage.value = msg;
  toastType.value = type;
  hasUndo.value = Boolean(undoId);
  lastDeletedId.value = undoId || null;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
    hasUndo.value = false;
  }, 4500);
}

async function handleUndoDelete() {
  if (!lastDeletedId.value) return;
  try {
    await RestoreReminder(lastDeletedId.value);
    lastDeletedId.value = null;
    hasUndo.value = false;
    toastVisible.value = false;
    await loadReminders();
    showToast('已撤销删除并恢复日程', 'success');
  } catch (err: any) {
    showToast(`撤销失败: ${err.message || err}`, 'error');
  }
}

// Stats Computation
const stats = computed<StatsData>(() => {
  let total = reminders.value.length;
  let today = 0;
  let nearDue = 0;
  let active = 0;
  let paused = 0;

  const now = nowTick.value;

  for (const r of reminders.value) {
    if (r.status === 'paused') {
      paused++;
      continue;
    }
    if (r.status === 'ended') {
      continue;
    }

    active++;

    const { isToday } = formatDateLabel(r.scheduled_at);
    if (isToday) today++;

    const target = new Date(r.scheduled_at).getTime();
    const diff = target - now;
    if (diff >= 0 && diff <= 15 * 60 * 1000) {
      nearDue++;
    }
  }

  return { total, today, nearDue, active, paused };
});

// Day Counts for WeekStrip
const dayCounts = computed<Record<string, number>>(() => {
  nowTick.value;
  const map: Record<string, number> = {};
  for (const r of reminders.value) {
    if (r.status !== 'active') continue;
    const d = new Date(r.scheduled_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    map[key] = (map[key] || 0) + 1;
  }
  return map;
});

// Filtered Reminders
const filteredReminders = computed(() => {
  nowTick.value;
  let list = reminders.value;

  // Search filter
  const query = searchQuery.value.trim().toLowerCase();
  if (query) {
    list = list.filter((r) => {
      return (
        r.title.toLowerCase().includes(query) ||
        (r.notes && r.notes.toLowerCase().includes(query)) ||
        (r.tags && parseReminderTags(r.tags).some((tag) => tag.toLowerCase().includes(query))) ||
        (r.prompt && r.prompt.toLowerCase().includes(query))
      );
    });
  }

  // Filter Bar
  if (activeFilter.value === 'today') {
    list = list.filter((r) => formatDateLabel(r.scheduled_at).isToday);
  } else if (activeFilter.value === 'near') {
    const now = nowTick.value;
    list = list.filter((r) => {
      const diff = new Date(r.scheduled_at).getTime() - now;
      return diff >= 0 && diff <= 15 * 60 * 1000 && r.status === 'active';
    });
  } else if (activeFilter.value === 'active') {
    list = list.filter((r) => r.status === 'active');
  } else if (activeFilter.value === 'paused') {
    list = list.filter((r) => r.status === 'paused');
  }

  // Overdue filter
  if (filterOverdueOnly.value) {
    const now = nowTick.value;
    list = list.filter((r) => r.status === 'active' && new Date(r.scheduled_at).getTime() < now);
  }

  // Weekstrip selected date
  if (selectedDate.value) {
    list = list.filter((r) => {
      const d = new Date(r.scheduled_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return key === selectedDate.value;
    });
  }

  // Tag filter (Round 6)
  if (selectedTag.value) {
    const targetTag = selectedTag.value.toLowerCase();
    list = list.filter((r) => parseReminderTags(r.tags).some((tag) => tag.toLowerCase() === targetTag));
  }

  return list;
});

const allKnownTags = computed(() => {
  const set = new Set<string>(['工作', '生活', '学习', '健康', '紧急', '项目', '会议']);
  for (const r of reminders.value) {
    if (r.tags) {
      for (const t of parseReminderTags(r.tags)) {
        if (t.trim()) set.add(t.trim());
      }
    }
  }
  return Array.from(set);
});

// Data Loading
let reminderLoadSequence = 0;

async function loadReminders() {
  const requestId = ++reminderLoadSequence;
  if (!hasLoadedReminders.value) {
    isLoading.value = true;
  }
  try {
    const res = await GetReminders();
    if (requestId === reminderLoadSequence) {
      reminders.value = res || [];
    }
  } catch (err: any) {
    console.error('加载日程失败:', err);
    if (requestId === reminderLoadSequence) {
      showToast('加载日程列表失败', 'error');
    }
  } finally {
    if (requestId === reminderLoadSequence) {
      hasLoadedReminders.value = true;
      isLoading.value = false;
    }
  }
}

// Quick Add Handler
async function handleQuickAdd(parsed: ParsedReminder, onSuccess?: () => void) {
  if (isQuickAdding.value) return;
  isQuickAdding.value = true;
  try {
    const created = await AddReminder({
      title: parsed.title,
      scheduled_at: parsed.scheduledAt,
      repeat_rule: parsed.repeatRule,
      lead_minutes: parsed.leadMinutes,
      duration_minutes: parsed.durationMinutes,
      notes: parsed.notes,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      prompt: parsed.prompt,
      priority: parsed.priority || 'p2',
      tags: parsed.tags || '',
      subtasks: '',
      is_pinned: false,
    });
    if (created) {
      await loadReminders();
      onSuccess?.();
      showToast(`已创建日程: ${created.title}`, 'success');
    }
  } catch (err: any) {
    showToast(`创建失败: ${err.message || err}`, 'error');
  } finally {
    isQuickAdding.value = false;
  }
}

// CRUD
function handleCloseEditor() {
  if (!isSavingEditor.value) showEditor.value = false;
}

function openCreateModal(dateKey?: string) {
  initialEditorDate.value = typeof dateKey === 'string' ? dateKey : null;
  editingReminder.value = null;
  showEditor.value = true;
}

function openCreateModalWithDate(dateKey: string) {
  openCreateModal(dateKey);
}

function openEditModal(reminder: Reminder) {
  initialEditorDate.value = null;
  editingReminder.value = reminder;
  showEditor.value = true;
}

async function handleAIBatchSubmit(requests: any[], onSuccess?: () => void) {
  if (isQuickAdding.value) return;
  isQuickAdding.value = true;
  try {
    let count = 0;
    for (const req of requests) {
      await AddReminder({
        title: req.title,
        scheduled_at: req.scheduled_at,
        repeat_rule: req.repeat_rule || '',
        lead_minutes: req.lead_minutes || 0,
        duration_minutes: req.duration_minutes || 30,
        notes: req.notes || '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        prompt: req.prompt || `提醒您：${req.title}`,
        priority: req.priority || 'p2',
        tags: req.tags || '',
        subtasks: req.subtasks || '',
        is_pinned: Boolean(req.is_pinned),
      });
      count++;
    }
    await loadReminders();
    onSuccess?.();
    showToast(`AI 深度拆解成功：已批量添加 ${count} 项日程`, 'success');
  } catch (err: any) {
    await loadReminders();
    showToast(`AI 批量添加部分失败: ${err.message || err}`, 'error');
  } finally {
    isQuickAdding.value = false;
  }
}

async function handleSaveReminder(data: any) {
  if (isSavingEditor.value) return;
  isSavingEditor.value = true;
  try {
    if (data.id) {
      await UpdateReminder({
        id: data.id,
        title: data.title,
        scheduled_at: data.scheduled_at,
        repeat_rule: data.repeat_rule,
        lead_minutes: data.lead_minutes,
        duration_minutes: data.duration_minutes,
        notes: data.notes,
        timezone: data.timezone,
        prompt: data.prompt,
        status: data.status,
        priority: data.priority || 'p2',
        tags: data.tags || '',
        subtasks: data.subtasks || '',
        is_pinned: Boolean(data.is_pinned),
      });
      showToast(`已更新日程: ${data.title}`, 'success');
    } else {
      await AddReminder({
        title: data.title,
        scheduled_at: data.scheduled_at,
        repeat_rule: data.repeat_rule,
        lead_minutes: data.lead_minutes,
        duration_minutes: data.duration_minutes,
        notes: data.notes,
        timezone: data.timezone,
        prompt: data.prompt,
        priority: data.priority || 'p2',
        tags: data.tags || '',
        subtasks: data.subtasks || '',
        is_pinned: Boolean(data.is_pinned),
      });
      showToast(`已创建日程: ${data.title}`, 'success');
    }
    showEditor.value = false;
    await loadReminders();
  } catch (err: any) {
    showToast(`保存失败: ${err.message || err}`, 'error');
  } finally {
    isSavingEditor.value = false;
  }
}

async function handleTogglePin(id: string) {
  try {
    const res = await TogglePinReminder(id);
    await loadReminders();
    showToast(res?.is_pinned ? '已置顶日程' : '已取消置顶', 'info');
  } catch (err: any) {
    showToast(`置顶失败: ${err.message || err}`, 'error');
  }
}

async function handleBatchPin(pinned: boolean) {
  if (selectedIds.value.length === 0) return;
  try {
    await BatchSetPinned(selectedIds.value, pinned);
    selectedIds.value = [];
    await loadReminders();
    showToast(`已批量${pinned ? '置顶' : '取消置顶'}选中的日程`, 'success');
  } catch (err: any) {
    showToast(`批量置顶失败: ${err.message || err}`, 'error');
  }
}

async function handleBatchTag(tag: string) {
  if (selectedIds.value.length === 0) return;
  try {
    await BatchAddTag(selectedIds.value, tag);
    selectedIds.value = [];
    await loadReminders();
    showToast(`已批量为选中日程添加 #${tag} 标签`, 'success');
  } catch (err: any) {
    showToast(`批量添加标签失败: ${err.message || err}`, 'error');
  }
}

async function handleUpdatePriority(r: Reminder, priority: string) {
  try {
    await updateReminderLatest(r, { priority });
    showToast(`已调整优先级为 ${priority.toUpperCase()}`, 'info');
  } catch (err: any) {
    showToast(`调整优先级失败: ${err.message || err}`, 'error');
  }
}

function handleQuickAddPriority(priority: string) {
  editingReminder.value = {
    id: '',
    title: '',
    scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    repeat_rule: '',
    lead_minutes: 0,
    duration_minutes: 30,
    notes: '',
    timezone: 'Asia/Shanghai',
    prompt: '',
    status: 'active',
    priority,
    tags: '',
    subtasks: '',
    deleted_at: '',
    is_pinned: false,
    created_at: '',
    updated_at: '',
  };
  initialEditorDate.value = null;
  showEditor.value = true;
}

function handleEditAIAction(action: any) {
  showAIDrawer.value = false;
  editingReminder.value = {
    id: '',
    title: String(action.title || ''),
    scheduled_at: action.scheduled_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    repeat_rule: action.repeat_rule || '',
    lead_minutes: Number(action.lead_minutes) || 0,
    duration_minutes: Number(action.duration_minutes) || 30,
    notes: action.notes || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    prompt: action.title ? `提醒您：${action.title}` : '',
    status: 'active',
    priority: action.priority || 'p2',
    tags: action.tags || '',
    subtasks: '',
    deleted_at: '',
    is_pinned: false,
    created_at: '',
    updated_at: '',
  };
  initialEditorDate.value = null;
  showEditor.value = true;
}

async function handleDeleteReminder(id: string) {
  try {
    await DeleteReminder(id);
    selectedIds.value = selectedIds.value.filter((i) => i !== id);
    if (activeId.value === id) {
      activeId.value = null;
    }
    await loadReminders();
    showToast('日程已移至废纸篓', 'info', id);
  } catch (err: any) {
    showToast(`删除失败: ${err.message || err}`, 'error');
  }
}

async function handleDuplicateReminder(reminder: Reminder) {
  try {
    const targetDate = new Date(reminder.scheduled_at);
    targetDate.setDate(targetDate.getDate() + 1);
    const duplicated = await DuplicateReminder(reminder.id, targetDate.toISOString());
    if (duplicated) {
      await loadReminders();
      showToast(`已复刻日程: ${duplicated.title} (排期至明天)`, 'success');
    }
  } catch (err: any) {
    showToast(`复刻日程失败: ${err.message || err}`, 'error');
  }
}

function handleStartFocus(reminder?: Reminder) {
  let target = reminder;
  if (!target) {
    try {
      const saved = JSON.parse(localStorage.getItem('agenda_focus_session') || 'null');
      target = reminders.value.find((item) => item.id === saved?.reminderId && item.status === 'active');
    } catch {
      // Ignore invalid local focus state.
    }
  }
  focusReminder.value = target || reminders.value.find((item) => item.status === 'active') || null;
  showFocusTimer.value = true;
}

function handleCloseFocus() {
  showFocusTimer.value = false;
  focusReminder.value = null;
}

async function handleFocusCompleteTask(reminder: Reminder) {
  try {
    await updateReminderLatest(reminder, { status: 'ended' });
    playCompleteSound(0.28);
    showToast(`🎉 专注完成并结束任务: ${reminder.title}`, 'success');
  } catch (err: any) {
    showToast(`更新日程状态失败: ${err.message || err}`, 'error');
  }
}

async function setReminderStatus(reminder: Reminder, status: string) {
  await updateReminderLatest(reminder, { status });
}

/** Marks an item complete, or reopens an already completed item. */
async function handleToggleStatus(reminder: Reminder) {
  try {
    const nextStatus = reminder.status === 'ended' ? 'active' : 'ended';
    await setReminderStatus(reminder, nextStatus);
    if (nextStatus === 'ended') playCompleteSound(0.18);
    showToast(nextStatus === 'ended' ? '日程已完成' : '日程已重新开启', 'success');
  } catch (err: any) {
    showToast(`更新完成状态失败: ${err.message || err}`, 'error');
  }
}

/** Pauses notification delivery without completing the item. */
async function handleTogglePause(reminder: Reminder) {
  try {
    const nextStatus = reminder.status === 'paused' ? 'active' : 'paused';
    await setReminderStatus(reminder, nextStatus);
    showToast(nextStatus === 'paused' ? '已暂停提醒' : '已恢复提醒', 'info');
  } catch (err: any) {
    showToast(`更新提醒状态失败: ${err.message || err}`, 'error');
  }
}

async function handleUpdateSubtasks(id: string, subtasksJson: string) {
  const item = reminders.value.find((reminder) => reminder.id === id);
  if (!item) return;
  try {
    await updateReminderLatest(item, { subtasks: subtasksJson });
    playCompleteSound(0.15);
  } catch (err: any) {
    showToast(`更新清单失败: ${err.message || err}`, 'error');
  }
}

async function handleRescheduleReminder(reminder: Reminder, scheduledAt: string) {
  try {
    const target = new Date(scheduledAt);
    if (Number.isNaN(target.getTime())) {
      throw new Error('无效的排期时间');
    }

    await updateReminderLatest(reminder, {
      scheduled_at: target.toISOString(),
    });
    showToast(`已将「${reminder.title}」移动到 ${target.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, 'success');
  } catch (err: any) {
    showToast(`移动日程失败: ${err.message || err}`, 'error');
  }
}

async function handleSnooze(reminder: Reminder, minutes: number) {
  try {
    const scheduledTime = new Date(reminder.scheduled_at).getTime();
    const baseTime = Number.isFinite(scheduledTime) ? Math.max(Date.now(), scheduledTime) : Date.now();
    const d = new Date(baseTime + minutes * 60 * 1000);
    await updateReminderLatest(reminder, {
      scheduled_at: d.toISOString(),
      status: 'active',
    });
    showToast(`日程已顺延 ${minutes} 分钟`, 'success');
  } catch (err: any) {
    showToast(`顺延失败: ${err.message || err}`, 'error');
  }
}

async function handleCopyMarkdown() {
  const ok = await copyMarkdownToClipboard(reminders.value);
  if (ok) {
    showToast('已复制 Markdown 待办清单至剪贴板', 'success');
  } else {
    showToast('复制失败，请重试', 'error');
  }
}

async function handleOptimizeDB() {
  try {
    const res = await OptimizeDatabase();
    showToast(res || '数据库检测正常，已完成碎片整理', 'success');
  } catch (err: any) {
    showToast(`数据库维护失败: ${err.message || err}`, 'error');
  }
}

function handleCloseHistory() {
  historyRequestSequence++;
  isHistoryLoading.value = false;
  showHistory.value = false;
}

async function handleViewHistory(reminder: Reminder) {
  const requestId = ++historyRequestSequence;
  historyTitle.value = reminder.title;
  historyRecords.value = [];
  isHistoryLoading.value = true;
  showHistory.value = true;
  try {
    const records = await GetDeliveryHistory(reminder.id);
    if (requestId === historyRequestSequence) historyRecords.value = records || [];
  } catch (err: any) {
    if (requestId === historyRequestSequence) {
      showHistory.value = false;
      showToast(`加载审计记录失败: ${err.message || err}`, 'error');
    }
  } finally {
    if (requestId === historyRequestSequence) isHistoryLoading.value = false;
  }
}

// Selection
function toggleSelect(id: string) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((i) => i !== id);
  } else {
    selectedIds.value.push(id);
  }
}

// Batch Actions
async function handleBatchComplete() {
  try {
    await BatchSetStatus(selectedIds.value, 'ended');
    playCompleteSound(0.25);
    const count = selectedIds.value.length;
    selectedIds.value = [];
    await loadReminders();
    showToast(`已将选中的 ${count} 项日程标记为已完成`, 'success');
  } catch (err: any) {
    showToast(`批量完成失败: ${err.message || err}`, 'error');
  }
}

async function handleBatchPostponeHour() {
  if (isBatchBusy.value) return;
  isBatchBusy.value = true;
  const successes: string[] = [];
  const failures: string[] = [];
  const targets = selectedIds.value
    .map((id) => reminders.value.find((item) => item.id === id))
    .filter((item): item is Reminder => Boolean(item));

  for (const item of targets) {
    try {
      const date = new Date(item.scheduled_at);
      date.setHours(date.getHours() + 1);
      await updateReminderLatest(item, { scheduled_at: date.toISOString() });
      successes.push(item.id);
    } catch {
      failures.push(item.id);
    }
  }

  selectedIds.value = failures;
  isBatchBusy.value = false;
  await loadReminders();

  if (successes.length > 0) {
    showToast(`已成功顺延 ${successes.length} 项日程 1 小时`, 'success');
  }
  if (failures.length > 0) {
    showToast(`${failures.length} 项日程顺延失败`, 'error');
  }
}

async function handleBatchPostponeDay() {
  if (isBatchBusy.value) return;
  isBatchBusy.value = true;
  const successes: string[] = [];
  const failures: string[] = [];
  const targets = selectedIds.value
    .map((id) => reminders.value.find((item) => item.id === id))
    .filter((item): item is Reminder => Boolean(item));

  for (const item of targets) {
    try {
      const date = new Date(item.scheduled_at);
      date.setDate(date.getDate() + 1);
      await updateReminderLatest(item, { scheduled_at: date.toISOString() });
      successes.push(item.id);
    } catch {
      failures.push(item.id);
    }
  }

  selectedIds.value = failures;
  isBatchBusy.value = false;
  if (failures.length) {
    showToast(`批量顺延完成：成功 ${successes.length} 项，失败 ${failures.length} 项`, 'error');
  } else {
    showToast(`已顺延 ${successes.length} 项日程至明天`, 'success');
  }
}

async function handleBatchPriority(priority: string) {
  try {
    await BatchSetPriority(selectedIds.value, priority);
    const count = selectedIds.value.length;
    selectedIds.value = [];
    await loadReminders();
    showToast(`已将 ${count} 项日程优先级调整为 ${priority.toUpperCase()}`, 'success');
  } catch (err: any) {
    showToast(`调整优先级失败: ${err.message || err}`, 'error');
  }
}

function handleBatchExport() {
  const selectedItems = reminders.value.filter((r) => selectedIds.value.includes(r.id));
  if (selectedItems.length === 0) return;
  const md = exportToMarkdown(selectedItems);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  triggerFileDownload(md, `Agenda_Batch_${dateStr}.md`, 'text/markdown;charset=utf-8');
  showToast(`已成功导出 ${selectedItems.length} 项日程为 Markdown`, 'success');
}

async function handleBatchPause() {
  const ids = reminders.value
    .filter((reminder) => selectedIds.value.includes(reminder.id) && reminder.status === 'active')
    .map((reminder) => reminder.id);
  if (!ids.length) return void showToast('所选日程中没有可暂停的提醒', 'info');
  try {
    await BatchSetStatus(ids, 'paused');
    selectedIds.value = [];
    await loadReminders();
    showToast(`已暂停 ${ids.length} 项提醒`, 'info');
  } catch (err: any) {
    showToast(`批量暂停失败: ${err.message || err}`, 'error');
  }
}

async function handleBatchResume() {
  const ids = reminders.value
    .filter((reminder) => selectedIds.value.includes(reminder.id) && reminder.status === 'paused')
    .map((reminder) => reminder.id);
  if (!ids.length) return void showToast('所选日程中没有已暂停的提醒', 'info');
  try {
    await BatchSetStatus(ids, 'active');
    selectedIds.value = [];
    await loadReminders();
    showToast(`已恢复 ${ids.length} 项提醒`, 'success');
  } catch (err: any) {
    showToast(`批量恢复失败: ${err.message || err}`, 'error');
  }
}

async function handleBatchDelete() {
  if (isBatchBusy.value) return;
  isBatchBusy.value = true;
  try {
    await BatchDelete(selectedIds.value);
    selectedIds.value = [];
    await loadReminders();
    showToast('已批量删除所选日程', 'info');
  } catch (err: any) {
    showToast(`批量删除失败: ${err.message || err}`, 'error');
  } finally {
    isBatchBusy.value = false;
  }
}

// ICS Import/Export
async function handleExportICS() {
  try {
    const icsContent = await ExportICS();
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Agenda_Butler_${new Date().toISOString().slice(0, 10)}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已成功导出 iCalendar (.ics) 日历文件', 'success');
  } catch (err: any) {
    showToast(`导出失败: ${err.message || err}`, 'error');
  }
}

async function handleImportICS(content: string) {
  try {
    const count = await ImportICS(content);
    await loadReminders();
    showToast(`成功导入 ${count} 条日历事项`, 'success');
  } catch (err: any) {
    showToast(`导入失败: ${err.message || err}`, 'error');
  }
}

async function handleExportCSV() {
  try {
    const csvContent = await ExportCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Agenda_Butler_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已成功导出标准 CSV 表格文件', 'success');
  } catch (err: any) {
    showToast(`导出失败: ${err.message || err}`, 'error');
  }
}

async function handleImportCSV(content: string) {
  try {
    const count = await ImportCSVContent(content);
    await loadReminders();
    showToast(`成功导入 ${count} 条表格日程`, 'success');
  } catch (err: any) {
    showToast(`导入失败: ${err.message || err}`, 'error');
  }
}

async function handleTestNotify() {
  try {
    await TriggerTestNotification('日程管家系统通知', '这是一条来自日程管家 Wails3 PC 客户端的原生测试通知！');
    showToast('已向系统发送原生通知', 'success');
  } catch (err: any) {
    showToast(`通知失败: ${err.message || err}`, 'error');
  }
}

function findReminderForAIAction(action: any): Reminder | null {
  const id = action.id || action.reminder_id || action.reminderID;
  if (id) {
    return reminders.value.find((r) => r.id === id) || null;
  }

  const title = String(action.reminder_title || action.title || '').trim().toLowerCase();
  if (!title) return null;
  return reminders.value.find((r) => r.title.trim().toLowerCase() === title) || null;
}

async function handleApplyAIAction(action: any) {
  try {
    const actionType = String(action.action || 'create').toLowerCase();

    if (actionType === 'create_batch' && Array.isArray(action.items)) {
      let count = 0;
      for (const item of action.items) {
        await AddReminder({
          title: item.title,
          scheduled_at: item.scheduled_at,
          repeat_rule: item.repeat_rule || '',
          lead_minutes: item.lead_minutes || 0,
          duration_minutes: item.duration_minutes || 15,
          notes: item.notes || '',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
          prompt: `提醒您：${item.title}`,
          priority: item.priority || 'p2',
          tags: item.tags || '',
          subtasks: item.subtasks || '',
          is_pinned: Boolean(item.is_pinned),
        });
        action.__onItemApplied?.(count);
        count++;
      }
      await loadReminders();
      showToast(`已通过 AI 智能批量安排 ${count} 项日程`, 'success');
      action.__onApplied?.();
      return;
    }

    if (actionType === 'delete') {
      const target = findReminderForAIAction(action);
      if (!target) throw new Error('未找到要删除的日程');
      await DeleteReminder(target.id);
      await loadReminders();
      showToast(`已删除日程：${target.title}`, 'success');
      action.__onApplied?.();
      return;
    }

    if (actionType === 'snooze') {
      const target = findReminderForAIAction(action);
      if (!target) throw new Error('未找到要顺延的日程');
      await handleSnooze(target, Number(action.minutes) || 30);
      action.__onApplied?.();
      return;
    }

    if (actionType === 'complete' || actionType === 'end') {
      const target = findReminderForAIAction(action);
      if (!target) throw new Error('未找到要完成的日程');
      await BatchSetStatus([target.id], 'ended');
      await loadReminders();
      showToast(`已完成日程：${target.title}`, 'success');
      action.__onApplied?.();
      return;
    }

    if (actionType === 'pause' || actionType === 'resume') {
      const target = findReminderForAIAction(action);
      if (!target) throw new Error('未找到要更新状态的日程');
      await BatchSetStatus([target.id], actionType === 'pause' ? 'paused' : 'active');
      await loadReminders();
      showToast(actionType === 'pause' ? `已暂停：${target.title}` : `已恢复：${target.title}`, 'success');
      action.__onApplied?.();
      return;
    }

    if (actionType === 'update') {
      const target = findReminderForAIAction(action);
      if (!target) throw new Error('未找到要修改的日程');
      await UpdateReminder({
        id: target.id,
        title: action.title || target.title,
        scheduled_at: action.scheduled_at || target.scheduled_at,
        repeat_rule: action.repeat_rule ?? target.repeat_rule,
        lead_minutes: action.lead_minutes ?? target.lead_minutes,
        duration_minutes: action.duration_minutes ?? target.duration_minutes,
        notes: action.notes ?? target.notes,
        timezone: action.timezone || target.timezone,
        prompt: action.prompt ?? target.prompt,
        status: action.status || target.status,
        priority: action.priority || target.priority || 'p2',
        tags: action.tags ?? target.tags,
        subtasks: action.subtasks ?? target.subtasks,
        is_pinned: action.is_pinned ?? target.is_pinned,
      });
      await loadReminders();
      showToast(`已更新日程：${action.title || target.title}`, 'success');
      action.__onApplied?.();
      return;
    }

    if (actionType === 'create') {
      const created = await AddReminder({
        title: action.title,
        scheduled_at: action.scheduled_at,
        repeat_rule: action.repeat_rule || '',
        lead_minutes: action.lead_minutes || 0,
        duration_minutes: action.duration_minutes || 30,
        notes: action.notes || '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        prompt: `提醒您：${action.title}`,
        priority: action.priority || 'p2',
        tags: action.tags || '',
        subtasks: action.subtasks || '',
        is_pinned: Boolean(action.is_pinned),
      });
      if (created) {
        await loadReminders();
        showToast(`已通过 AI 智能安排日程: ${created.title}`, 'success');
        action.__onApplied?.();
      }
    }
  } catch (err: any) {
    showToast(`执行失败: ${err.message || err}`, 'error');
  }
}

function handleSidebarChangeView(view: 'list' | 'week' | 'month' | 'matrix') {
  currentView.value = view;
  filterOverdueOnly.value = false;
}

function handleSidebarSelectFilter(filter: string) {
  activeFilter.value = filter;
  currentView.value = 'list';
  filterOverdueOnly.value = false;
  selectedTag.value = null;
  selectedDate.value = null;
}

function handleSidebarToggleOverdue() {
  filterOverdueOnly.value = !filterOverdueOnly.value;
  if (filterOverdueOnly.value) {
    currentView.value = 'list';
    selectedTag.value = null;
    selectedDate.value = null;
    activeFilter.value = 'all';
  }
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (trapDialogFocus(e)) return;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const metaOrCtrl = isMac ? e.metaKey : e.ctrlKey;

  // Esc: dismiss modals and drawers
  if (e.key === 'Escape') {
    if (showCommandPalette.value) {
      showCommandPalette.value = false;
      return;
    }
    if (showFocusTimer.value) {
      handleCloseFocus();
      return;
    }
    if (showDailyBriefing.value) {
      showDailyBriefing.value = false;
      return;
    }
    if (showKeyboardShortcuts.value) {
      showKeyboardShortcuts.value = false;
      return;
    }
    if (showTrash.value) {
      showTrash.value = false;
      return;
    }
    if (showStatsDashboard.value) {
      showStatsDashboard.value = false;
      return;
    }
    if (showEditor.value) {
      handleCloseEditor();
      return;
    }
    if (showHistory.value) {
      handleCloseHistory();
      return;
    }
    if (showSettings.value) {
      showSettings.value = false;
      return;
    }
    if (showAIDrawer.value) {
      showAIDrawer.value = false;
      return;
    }
    if (selectedTag.value) {
      selectedTag.value = null;
      return;
    }
    if (selectedDate.value) {
      selectedDate.value = null;
      return;
    }
    if (searchQuery.value) {
      searchQuery.value = '';
      return;
    }
    if (selectedIds.value.length > 0) {
      selectedIds.value = [];
      return;
    }
    if (activeId.value) {
      activeId.value = null;
      return;
    }
  }

  // While a modal or drawer is open, keep all shortcuts inside that surface.
  if (hasOpenOverlay.value) return;

  // Ctrl/Cmd shortcuts
  if (metaOrCtrl) {
    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      showCommandPalette.value = !showCommandPalette.value;
    } else if (e.key.toLowerCase() === 'b') {
      e.preventDefault();
      isSidebarCollapsed.value = !isSidebarCollapsed.value;
    } else if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      showAIDrawer.value = !showAIDrawer.value;
    } else if (e.key.toLowerCase() === 'n') {
      e.preventDefault();
      openCreateModal();
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      workspaceHeaderRef.value?.focusSearch();
    } else if (e.key.toLowerCase() === 'z') {
      if (lastDeletedId.value || hasUndo.value) {
        e.preventDefault();
        handleUndoDelete();
      }
    }
    return;
  }

  // Check if focus is inside an input/textarea/select
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable)
  ) {
    return;
  }

  // If any modal is active, skip single key shortcuts
  if (
    showCommandPalette.value ||
    showEditor.value ||
    showHistory.value ||
    showSettings.value ||
    showAIDrawer.value ||
    showStatsDashboard.value ||
    showFocusTimer.value ||
    showDailyBriefing.value ||
    showKeyboardShortcuts.value ||
    showTrash.value
  ) {
    return;
  }

  // Pro Shortcuts: '?' for Cheat Sheet
  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    showKeyboardShortcuts.value = true;
    return;
  }

  // View switching shortcuts (1: list, 2: week, 3: month, 4: matrix)
  if (e.key === '1') {
    currentView.value = 'list';
    return;
  } else if (e.key === '2') {
    currentView.value = 'week';
    return;
  } else if (e.key === '3') {
    currentView.value = 'month';
    return;
  } else if (e.key === '4') {
    currentView.value = 'matrix';
    return;
  }

  if (currentView.value !== 'list') return;

  // List item keyboard navigation (Round 14 & 39)
  const list = filteredReminders.value;
  if (list.length === 0) return;

  if (e.key === 'j' || e.key === 'ArrowDown') {
    e.preventDefault();
    const currIdx = list.findIndex((r) => r.id === activeId.value);
    const nextIdx = currIdx < list.length - 1 ? currIdx + 1 : 0;
    activeId.value = list[nextIdx].id;
  } else if (e.key === 'k' || e.key === 'ArrowUp') {
    e.preventDefault();
    const currIdx = list.findIndex((r) => r.id === activeId.value);
    const prevIdx = currIdx > 0 ? currIdx - 1 : list.length - 1;
    activeId.value = list[prevIdx].id;
  } else if (e.key === 'x') {
    if (activeId.value) {
      e.preventDefault();
      toggleSelect(activeId.value);
    }
  } else if (e.key === ' ' || e.code === 'Space') {
    if (activeId.value) {
      e.preventDefault();
      const item = list.find((r) => r.id === activeId.value);
      if (item) {
        handleToggleStatus(item);
      }
    }
  } else if (e.key === 'p') {
    if (activeId.value) {
      e.preventDefault();
      const item = list.find((r) => r.id === activeId.value);
      if (item) {
        handleStartFocus(item);
      }
    }
  } else if (e.key === 'e') {
    if (activeId.value) {
      e.preventDefault();
      const item = list.find((r) => r.id === activeId.value);
      if (item) {
        openEditModal(item);
      }
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedIds.value.length > 0) {
      e.preventDefault();
      handleBatchDelete();
    } else if (activeId.value) {
      e.preventDefault();
      handleDeleteReminder(activeId.value);
    }
  }
}

const unsubscribeWailsEvents: Array<() => void> = [];
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform);
const isWindowFullscreen = ref(false);

async function syncWindowFullscreenState() {
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    isWindowFullscreen.value = true;
    return;
  }
  try {
    isWindowFullscreen.value = Boolean(await Window.IsFullscreen());
  } catch {
    isWindowFullscreen.value = false;
  }
}

function handleDomFullscreenChange() {
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    isWindowFullscreen.value = true;
    return;
  }
  void syncWindowFullscreenState();
}

function handleSelectTheme(theme: string) {
  localStorage.setItem('agenda_theme', theme);
  if (theme && theme !== 'midnight' && theme !== 'obsidian') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  showCommandPalette.value = false;
  showToast(`已切换主题至 ${theme}`, 'success');
}

function syncSoundPreference(event?: Event) {
  const detail = (event as CustomEvent<boolean> | undefined)?.detail;
  isSoundEnabled.value = typeof detail === 'boolean'
    ? detail
    : localStorage.getItem('agenda_sound_enabled') !== 'false';
}

onMounted(async () => {
  const savedTheme = localStorage.getItem('agenda_theme');
  if (savedTheme && savedTheme !== 'midnight') document.documentElement.setAttribute('data-theme', savedTheme);
  else document.documentElement.removeAttribute('data-theme');

  window.addEventListener('keydown', handleGlobalKeyDown);
  window.addEventListener('agenda:sound-preference', syncSoundPreference);
  document.addEventListener('fullscreenchange', handleDomFullscreenChange);
  clockTimer = setInterval(() => { nowTick.value = Date.now(); }, 30_000);
  await Promise.all([loadReminders(), syncWindowFullscreenState()]);

  unsubscribeWailsEvents.push(
    Events.On('reminders-updated', requestRemindersRefresh),
    Events.On('open-create-modal', () => openCreateModal()),
    Events.On('open-ai-drawer', () => { showAIDrawer.value = true; }),
    Events.On('window-fullscreen', (payload: any) => {
      const value = Array.isArray(payload?.data) ? payload.data[0] : (payload?.data ?? payload);
      isWindowFullscreen.value = Boolean(value);
    }),
    Events.On('common:WindowFullscreen', () => { isWindowFullscreen.value = true; }),
    Events.On('common:WindowUnFullscreen', () => { isWindowFullscreen.value = false; }),
    Events.On('reminder-triggered', (payload: any) => {
      const data = payload?.data || payload;
      const soundEnabled = localStorage.getItem('agenda_sound_enabled') !== 'false';
      const isQuietHours = isWithinQuietHours();
      const isEmergency = data?.priority === 'p0' || data?.is_emergency;
      if (soundEnabled && (!isQuietHours || isEmergency)) playReminderChime();
      showToast(
        isQuietHours && !isEmergency ? `日程到期：${data.title || '提醒'}（免打扰静音）` : `日程到期：${data.title || '提醒'}`,
        'info'
      );
      void loadReminders();
    })
  );
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown);
  window.removeEventListener('agenda:sound-preference', syncSoundPreference);
  document.removeEventListener('fullscreenchange', handleDomFullscreenChange);
  unsubscribeWailsEvents.splice(0).forEach((unsubscribe) => unsubscribe());
  if (clockTimer) clearInterval(clockTimer);
  clearTimeout(toastTimer);
});
</script>

<template>
  <div
    class="agenda-app bg-dot-matrix"
    :class="{
      'compact-mode': isCompactMode,
      'sidebar-collapsed': isSidebarCollapsed,
      'is-mac': isMac,
      'is-fullscreen': isWindowFullscreen,
    }"
  >
    <!-- 1. Full-Width Unified Top TitleBar -->
    <WorkspaceHeader
      ref="workspaceHeaderRef"
      v-model:searchQuery="searchQuery"
      :currentView="currentView"
      :activeFilter="activeFilter"
      :filterOverdueOnly="filterOverdueOnly"
      :selectedTag="selectedTag"
      :selectedDate="selectedDate"
      :itemCount="filteredReminders.length"
      :isCompactMode="isCompactMode"
      :isSidebarCollapsed="isSidebarCollapsed"
      :isMac="isMac"
      :isFullscreen="isWindowFullscreen"
      @change-view="handleSidebarChangeView"
      @clear-date-filter="selectedDate = null"
      @clear-tag-filter="selectedTag = null"
      @export-ics="handleExportICS"
      @import-ics="handleImportICS"
      @export-csv="handleExportCSV"
      @import-csv="handleImportCSV"
      @test-notify="handleTestNotify"
      @open-create="openCreateModal"
      @toggle-compact="isCompactMode = !isCompactMode"
      @open-palette="showCommandPalette = true"
      @toggle-sidebar="isSidebarCollapsed = !isSidebarCollapsed"
      @refresh-data="loadReminders"
    />

    <!-- 2. Workspace Shell (Sidebar + Main Area below Unified TitleBar) -->
    <div class="workspace-shell">
      <TideSwirlCanvas />

      <!-- 2.1 Left Fixed Navigation Sidebar -->
      <NavigationSidebar
        :currentView="currentView"
        :activeFilter="activeFilter"
        :filterOverdueOnly="filterOverdueOnly"
        :selectedTag="selectedTag"
        :selectedDate="selectedDate"
        :reminders="reminders"
        :stats="stats"
        :overdueCount="overdueCount"
        :isCollapsed="isSidebarCollapsed"
        :isFullscreen="isWindowFullscreen"
        :isSoundEnabled="isSoundEnabled"
        @change-view="handleSidebarChangeView"
        @select-filter="handleSidebarSelectFilter"
        @toggle-overdue="handleSidebarToggleOverdue"
        @filter-tag="handleTagFilter"
        @clear-date-filter="selectedDate = null"
        @open-create="openCreateModal"
        @open-ai="showAIDrawer = true"
        @open-stats="showStatsDashboard = true"
        @open-focus="handleStartFocus"
        @open-briefing="showDailyBriefing = true"
        @open-trash="showTrash = true"
        @open-settings="showSettings = true"
        @open-shortcuts="showKeyboardShortcuts = true"
        @toggle-collapse="isSidebarCollapsed = !isSidebarCollapsed"
        @toggle-sound="handleToggleSound"
        @refresh-data="loadReminders"
      />

      <!-- 2.2 Right Workspace Area -->
      <div class="main-workspace">
        <!-- 2.2.1 Command Add & WeekStrip Section -->
        <div class="workspace-subbar">
        <QuickAddBar
          ref="quickAddRef"
          :submitting="isQuickAdding"
          :availableTags="allKnownTags"
          @submit="handleQuickAdd"
          @ai-batch-submit="handleAIBatchSubmit"
          @toast="showToast"
        />

        <HorizonBentoStrip
          v-if="currentView === 'list' && !isCompactMode"
          :reminders="reminders"
          :selectedDate="selectedDate"
          :dayCounts="dayCounts"
          :activeFilter="activeFilter"
          :nowTick="nowTick"
          @select-date="handleDateFilter"
          @select-filter="handleSidebarSelectFilter"
          @open-reminder="openEditModal"
        />

        <WeekStrip
          v-else-if="currentView === 'list'"
          :selectedDate="selectedDate"
          :dayCounts="dayCounts"
          :nowTick="nowTick"
          @select-date="handleDateFilter"
        />
      </div>

      <!-- 2.3 Main Scrollable Content Viewport -->
      <main class="main-content-scroll">
        <Transition name="view-switch" mode="out-in">
        <ReminderList
          v-if="currentView === 'list'"
          :reminders="filteredReminders"
          :loading="isLoading"
          :selectedIds="selectedIds"
          :activeId="activeId"
          :searchQuery="searchQuery"
          :nowTick="nowTick"
          @toggle-select="toggleSelect"
          @select-all="selectedIds = $event"
          @edit="openEditModal"
          @delete="handleDeleteReminder"
          @toggle-status="handleToggleStatus"
          @toggle-pause="handleTogglePause"
          @toggle-pin="handleTogglePin"
          @snooze="handleSnooze"
          @view-history="handleViewHistory"
          @update-subtasks="handleUpdateSubtasks"
          @filter-tag="handleTagFilter"
          @duplicate="handleDuplicateReminder"
          @start-focus="handleStartFocus"
          @update-title="handleInlineUpdateTitle"
          @update-priority="handleUpdatePriority"
          @activate="activeId = $event"
          @toast="showToast"
          @open-create="openCreateModal"
          @open-ai="showAIDrawer = true"
          @clear-filters="handleClearAllFilters"
        />

        <WeekTimelineView
          v-else-if="currentView === 'week'"
          :reminders="reminders"
          @select-reminder="openEditModal"
          @create-at-time="openCreateModalWithDate"
          @reschedule="handleRescheduleReminder"
        />

        <EisenhowerMatrixView
          v-else-if="currentView === 'matrix'"
          :reminders="filteredReminders"
          :searchQuery="searchQuery"
          @edit="openEditModal"
          @delete="handleDeleteReminder"
          @toggle-status="handleToggleStatus"
          @toggle-pin="handleTogglePin"
          @update-priority="handleUpdatePriority"
          @quick-add-priority="handleQuickAddPriority"
        />

        <MonthCalendar
          v-else
          :reminders="reminders"
          @select-reminder="openEditModal"
          @toggle-status="handleToggleStatus"
          @toggle-pause="handleTogglePause"
          @delete-reminder="handleDeleteReminder"
          @create-on-date="openCreateModalWithDate"
          @reschedule="handleRescheduleReminder"
        />
        </Transition>
      </main>

      <!-- 2.4 Floating Batch Action Dock -->
      <BatchActionBar
        :count="selectedIds.length"
        :busy="isBatchBusy"
        @batch-complete="handleBatchComplete"
        @batch-postpone-hour="handleBatchPostponeHour"
        @batch-postpone-day="handleBatchPostponeDay"
        @batch-priority="handleBatchPriority"
        @batch-pin="handleBatchPin"
        @batch-tag="handleBatchTag"
        @batch-export="handleBatchExport"
        @batch-pause="handleBatchPause"
        @batch-resume="handleBatchResume"
        @batch-delete="handleBatchDelete"
        @clear-selection="selectedIds = []"
      />
      </div>
    </div>

    <!-- Modals & Drawers Layer -->
    <ReminderEditorModal
      :visible="showEditor"
      :reminder="editingReminder"
      :initialDate="initialEditorDate"
      :allReminders="reminders"
      :saving="isSavingEditor"
      @close="handleCloseEditor"
      @save="handleSaveReminder"
    />

    <HistoryModal
      :visible="showHistory"
      :title="historyTitle"
      :records="historyRecords"
      :loading="isHistoryLoading"
      @close="handleCloseHistory"
    />

    <SettingsModal
      :visible="showSettings"
      :reminders="reminders"
      @close="showSettings = false"
      @test-notify="handleTestNotify"
      @toast="showToast"
      @sound-change="isSoundEnabled = $event"
      @refresh="loadReminders"
      @open-trash="showSettings = false; showTrash = true"
    />

    <!-- Stats Dashboard Modal (Round 10) -->
    <StatsDashboardModal
      :visible="showStatsDashboard"
      :reminders="reminders"
      @close="showStatsDashboard = false"
    />

    <!-- AI Assistant Sliding Drawer -->
    <AIAssistantDrawer
      :visible="showAIDrawer"
      :reminders="reminders"
      :overdueCount="overdueCount"
      @close="showAIDrawer = false"
      @apply-action="handleApplyAIAction"
      @edit-action="handleEditAIAction"
      @open-settings="showAIDrawer = false; showSettings = true"
    />

    <!-- Focus Pomodoro Timer Modal (Round 23) -->
    <FocusTimerModal
      :visible="showFocusTimer"
      :reminder="focusReminder"
      @close="handleCloseFocus"
      @complete-task="handleFocusCompleteTask"
      @toast="showToast"
    />

    <!-- Daily Briefing Modal (Round 28) -->
    <DailyBriefingModal
      :visible="showDailyBriefing"
      :reminders="reminders"
      @close="showDailyBriefing = false"
      @toast="showToast"
    />

    <!-- Keyboard Shortcuts Modal (Round 39) -->
    <KeyboardShortcutsModal
      :visible="showKeyboardShortcuts"
      @close="showKeyboardShortcuts = false"
    />

    <!-- Spotlight Command Palette Modal (⌘K) -->
    <CommandPaletteModal
      :visible="showCommandPalette"
      :reminders="reminders"
      :currentView="currentView"
      :isSidebarCollapsed="isSidebarCollapsed"
      :isCompactMode="isCompactMode"
      @close="showCommandPalette = false"
      @open-create="openCreateModal"
      @open-ai="showAIDrawer = true"
      @open-stats="showStatsDashboard = true"
      @open-focus="handleStartFocus"
      @open-briefing="showDailyBriefing = true"
      @open-trash="showTrash = true"
      @open-settings="showSettings = true"
      @open-shortcuts="showKeyboardShortcuts = true"
      @change-view="handleSidebarChangeView"
      @select-filter="handleSidebarSelectFilter"
      @toggle-overdue="handleSidebarToggleOverdue"
      @toggle-sidebar="isSidebarCollapsed = !isSidebarCollapsed"
      @toggle-compact="isCompactMode = !isCompactMode"
      @export-ics="handleExportICS"
      @export-csv="handleExportCSV"
      @select-theme="handleSelectTheme"
      @edit-reminder="openEditModal"
      @copy-markdown="handleCopyMarkdown"
      @optimize-db="handleOptimizeDB"
    />

    <!-- Trash Bin Modal (Round 30) -->
    <TrashModal
      :visible="showTrash"
      @close="showTrash = false"
      @restored="loadReminders"
      @toast="showToast"
    />

    <!-- Toast Notice with Undo Support (Round 30) -->
    <ToastNotice
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      :hasUndo="hasUndo"
      @undo="handleUndoDelete"
    />
  </div>
</template>

<style scoped>
.agenda-app {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  --wails-draggable: no-drag;
  -webkit-app-region: no-drag;
}

.workspace-shell {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: row;
  position: relative;
  overflow: hidden;
}

.main-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  position: relative;
  background-color: transparent;
}

.workspace-subbar {
  position: relative;
  z-index: 1;
  padding: 12px 24px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}

.main-content-scroll {
  position: relative;
  z-index: 1;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 24px 36px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Compact Mode Adaptations */
.agenda-app.compact-mode .workspace-subbar {
  padding: 8px 16px 0;
  gap: 6px;
}

.agenda-app.compact-mode .main-content-scroll {
  padding: 8px 16px 24px;
}
</style>
