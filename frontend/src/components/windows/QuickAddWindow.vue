<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Events } from '@wailsio/runtime';
import {
  AddReminder,
  CheckTimeConflicts,
  CloseDesktopWindow,
  DeleteReminder,
  GetDesktopPreferences,
  GetReminders,
  OpenDesktopWindow,
  SaveDesktopPreferences,
  SuggestNextFreeSlot,
  TriggerOpenInMain,
} from '../../../bindings/agenda/internal/agenda/agendaservice';
import type { CreateReminderRequest, DesktopPreferences, Reminder } from '../../../bindings/agenda/internal/agenda/models';
import { parseReminderTags } from '../../domain/reminder';
import { formatTime } from '../../utils/format';
import type { ParsedReminder } from '../../utils/nlp';
import DesktopIcon from '../DesktopIcon.vue';
import QuickAddBar from '../QuickAddBar.vue';
import ToastNotice from '../ToastNotice.vue';

const reminders = ref<Reminder[]>([]);
const submitting = ref(false);
const quickAddRef = ref<InstanceType<typeof QuickAddBar> | null>(null);
const desktopPrefs = ref<DesktopPreferences | null>(null);
const conflicts = ref<Reminder[]>([]);
const suggestedSlotISO = ref('');
const currentPreview = ref<{ title: string; scheduledAt: string; durationMinutes: number } | null>(null);
const recentCreated = ref<Reminder[]>([]);

const toastVisible = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error' | 'info'>('info');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let conflictTimer: ReturnType<typeof setTimeout> | undefined;
let conflictSeq = 0;
let unsubscribeEvents: Array<() => void> = [];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform);
const autoHideAfterCreate = computed(() => desktopPrefs.value?.quick_add_auto_hide ?? true);
const hotkeyLabel = computed(() => {
  const raw = (desktopPrefs.value?.quick_add_hotkey ?? 'CmdOrCtrl+Alt+A').trim();
  if (!raw) return '全局热键已禁用';
  if (isMac) {
    return raw
      .replace(/CmdOrCtrl/gi, '⌘')
      .replace(/Alt/gi, '⌥')
      .replace(/Shift/gi, '⇧')
      .replace(/Ctrl/gi, '⌃')
      .replace(/\+/g, '');
  }
  return raw.replace(/CmdOrCtrl/gi, 'Ctrl');
});

const allKnownTags = computed(() => {
  const set = new Set<string>(['工作', '生活', '学习', '健康', '紧急', '项目', '会议']);
  for (const r of reminders.value) {
    for (const t of parseReminderTags(r.tags)) {
      set.add(t);
    }
  }
  return Array.from(set);
});

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  clearTimeout(toastTimer);
  toastMessage.value = msg;
  toastType.value = type;
  toastVisible.value = true;
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2600);
}

async function loadData() {
  try {
    const [list, prefs] = await Promise.all([GetReminders(), GetDesktopPreferences()]);
    reminders.value = list || [];
    desktopPrefs.value = prefs;
  } catch {
    // Ignore transient load errors.
  }
}

function handlePreviewChange(preview: { title: string; scheduledAt: string; durationMinutes: number } | null) {
  clearTimeout(conflictTimer);
  currentPreview.value = preview;
  if (!preview || !preview.scheduledAt) {
    conflicts.value = [];
    suggestedSlotISO.value = '';
    return;
  }
  const seq = ++conflictSeq;
  conflictTimer = setTimeout(async () => {
    try {
      const found = await CheckTimeConflicts(preview.scheduledAt, preview.durationMinutes || 30, '');
      if (seq !== conflictSeq) return;
      conflicts.value = found || [];
      if (conflicts.value.length > 0) {
        const freeSlot = await SuggestNextFreeSlot(preview.scheduledAt, preview.durationMinutes || 30);
        if (seq === conflictSeq) {
          suggestedSlotISO.value = freeSlot || '';
        }
      } else {
        suggestedSlotISO.value = '';
      }
    } catch {
      if (seq === conflictSeq) {
        conflicts.value = [];
        suggestedSlotISO.value = '';
      }
    }
  }, 180);
}

async function createAtSuggestedSlot() {
  if (!currentPreview.value || !suggestedSlotISO.value || submitting.value) return;
  const title = currentPreview.value.title.trim();
  if (!title) return;
  await handleQuickAdd(
    {
      title,
      scheduledAt: suggestedSlotISO.value,
      repeatRule: '',
      leadMinutes: Number(localStorage.getItem('agenda_default_lead') || 10),
      leadSpecified: false,
      durationMinutes: currentPreview.value.durationMinutes || 30,
      notes: '',
      prompt: '',
      hasTime: true,
      priority: 'p2',
      tags: '',
      rawInput: title,
    },
    () => {
      quickAddRef.value?.clearInput?.();
    },
  );
}

async function toggleAutoHide() {
  if (!desktopPrefs.value) return;
  const next = !desktopPrefs.value.quick_add_auto_hide;
  try {
    desktopPrefs.value = await SaveDesktopPreferences({
      ...desktopPrefs.value,
      quick_add_auto_hide: next,
    });
    showToast(next ? '已开启创建后自动隐藏' : '已切换为连续创建模式', 'info');
  } catch (err: any) {
    showToast(`保存失败: ${err?.message || err}`, 'error');
  }
}

async function handleQuickAdd(parsed: ParsedReminder, onSuccess: () => void) {
  if (submitting.value) return;
  submitting.value = true;
  const leadDefault = Number(localStorage.getItem('agenda_default_lead') || 10);
  try {
    const created = await AddReminder({
      title: parsed.title,
      scheduled_at: parsed.scheduledAt,
      repeat_rule: parsed.repeatRule,
      lead_minutes: leadDefault,
      notes: '',
      duration_minutes: parsed.durationMinutes || 30,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      prompt: '',
      priority: parsed.priority || 'p2',
      tags: parsed.tags || '',
      subtasks: '',
      is_pinned: false,
    });
    onSuccess();
    conflicts.value = [];
    if (created) {
      recentCreated.value = [created, ...recentCreated.value.filter((x) => x.id !== created.id)].slice(0, 3);
    }
    showToast(`已创建日程「${created?.title || parsed.title}」`, 'success');
    if (autoHideAfterCreate.value) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        void CloseDesktopWindow('quick-add');
      }, 650);
    }
  } catch (err: any) {
    showToast(`创建失败: ${err?.message || err}`, 'error');
  } finally {
    submitting.value = false;
  }
}

async function handleBatchAdd(requests: CreateReminderRequest[], onSuccess: () => void) {
  if (submitting.value || !requests.length) return;
  submitting.value = true;
  try {
    let count = 0;
    for (const req of requests) {
      const created = await AddReminder(req);
      if (created) {
        recentCreated.value = [created, ...recentCreated.value.filter((x) => x.id !== created.id)].slice(0, 3);
      }
      count++;
    }
    onSuccess();
    conflicts.value = [];
    showToast(`AI 已批量创建 ${count} 条日程`, 'success');
    if (autoHideAfterCreate.value) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        void CloseDesktopWindow('quick-add');
      }, 750);
    }
  } catch (err: any) {
    showToast(`批量创建失败: ${err?.message || err}`, 'error');
  } finally {
    submitting.value = false;
  }
}

async function undoRecent(item: Reminder) {
  try {
    await DeleteReminder(item.id);
    recentCreated.value = recentCreated.value.filter((x) => x.id !== item.id);
    showToast(`已撤销「${item.title}」`, 'info');
  } catch (err: any) {
    showToast(`撤销失败: ${err?.message || err}`, 'error');
  }
}

function applyPresetText(text: string) {
  quickAddRef.value?.focusAndInsert?.(text);
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    void CloseDesktopWindow('quick-add');
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'm') {
    e.preventDefault();
    void OpenDesktopWindow('main', '');
  }
}

onMounted(async () => {
  await loadData();
  quickAddRef.value?.focus?.();
  window.addEventListener('keydown', handleKeydown);
  unsubscribeEvents.push(
    Events.On('reminders-updated', () => { void loadData(); }),
    Events.On('desktop-status-updated', () => { void loadData(); }),
    Events.On('common:WindowShow', () => {
      setTimeout(() => quickAddRef.value?.focus?.(), 60);
    }),
  );
});

onUnmounted(() => {
  clearTimeout(toastTimer);
  clearTimeout(hideTimer);
  clearTimeout(conflictTimer);
  window.removeEventListener('keydown', handleKeydown);
  unsubscribeEvents.splice(0).forEach((u) => u());
});
</script>

<template>
  <div class="quick-win-shell" :class="{ 'is-mac': isMac }">
    <header class="quick-win-header">
      <div class="quick-win-title">
        <span class="win-badge"><DesktopIcon name="bolt" :size="13" /></span>
        <strong>快速捕获日程</strong>
        <span class="win-sub">{{ hotkeyLabel }} · Esc 隐藏</span>
      </div>
      <div class="quick-win-actions">
        <button
          type="button"
          class="win-chip-btn"
          :class="{ active: autoHideAfterCreate }"
          title="创建成功后自动隐藏悬浮窗"
          @click="toggleAutoHide"
        >
          <span>{{ autoHideAfterCreate ? '自动隐藏' : '连续录入' }}</span>
        </button>
        <button
          type="button"
          class="win-chip-btn"
          title="打开主工作台窗口"
          @click="OpenDesktopWindow('main', '')"
        >
          <span>主窗口</span>
          <DesktopIcon name="popout" :size="11" />
        </button>
        <button
          type="button"
          class="win-close-btn"
          title="隐藏悬浮窗 (Esc)"
          aria-label="隐藏悬浮窗"
          @click="CloseDesktopWindow('quick-add')"
        >
          <DesktopIcon name="close" :size="12" />
        </button>
      </div>
    </header>

    <main class="quick-win-body">
      <QuickAddBar
        ref="quickAddRef"
        :submitting="submitting"
        :availableTags="allKnownTags"
        @submit="handleQuickAdd"
        @ai-batch-submit="handleBatchAdd"
        @preview-change="handlePreviewChange"
        @toast="showToast"
      />

      <!-- Live Time Conflict Alert -->
      <div v-if="conflicts.length > 0" class="conflict-alert-bar">
        <span class="conflict-icon"><DesktopIcon name="alert" :size="13" /></span>
        <span class="conflict-copy">
          时段与「{{ conflicts[0].title }}」({{ formatTime(conflicts[0].scheduled_at) }})
          <template v-if="conflicts.length > 1">等 {{ conflicts.length }} 项</template>存在重叠
        </span>
        <button
          v-if="suggestedSlotISO"
          type="button"
          class="conflict-resolve-btn"
          title="自动顺延至最近空闲时段并创建"
          @click="createAtSuggestedSlot"
        >
          避让至 {{ formatTime(suggestedSlotISO) }} 创建
        </button>
      </div>

      <div class="quick-presets-row">
        <span class="presets-label">快捷时间：</span>
        <button type="button" class="preset-chip" @click="applyPresetText('15分钟后 ')">15分钟后</button>
        <button type="button" class="preset-chip" @click="applyPresetText('1小时后 ')">1小时后</button>
        <button type="button" class="preset-chip" @click="applyPresetText('今晚 20:00 ')">今晚 20:00</button>
        <button type="button" class="preset-chip" @click="applyPresetText('明天 09:00 ')">明天 09:00</button>
        <button type="button" class="preset-chip" @click="applyPresetText('每天 09:00 ')">每日晨会</button>
      </div>

      <!-- Recent Quick-Created Items -->
      <div v-if="recentCreated.length > 0" class="recent-created-strip">
        <span class="recent-label">本次已创建：</span>
        <div class="recent-chips">
          <div v-for="rc in recentCreated" :key="rc.id" class="recent-pill">
            <span class="recent-title" @click="TriggerOpenInMain(rc.id)">{{ rc.title }} · {{ formatTime(rc.scheduled_at) }}</span>
            <button type="button" class="recent-undo" title="撤销删除" @click="undoRecent(rc)">×</button>
          </div>
        </div>
      </div>
    </main>

    <ToastNotice
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      :hasUndo="false"
    />
  </div>
</template>

<style scoped>
.quick-win-shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--app-bg) 92%, transparent);
  color: var(--text-primary);
  overflow: hidden;
}

.quick-win-header {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid var(--border-subtle);
  --wails-draggable: drag;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.quick-win-shell.is-mac .quick-win-header {
  padding-left: 78px;
}

.quick-win-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.win-badge {
  font-size: 13px;
}

.quick-win-title strong {
  font-size: 13px;
  font-weight: 700;
}

.win-sub {
  font-size: 11px;
  color: var(--text-quaternary);
}

.quick-win-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  --wails-draggable: no-drag;
  -webkit-app-region: no-drag;
}

.win-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.14s ease;
}

.win-chip-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.win-chip-btn.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}

.win-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.win-close-btn:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

.quick-win-body {
  flex: 1;
  padding: 14px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.conflict-alert-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
  font-size: 11.5px;
  font-weight: 600;
}

.conflict-copy {
  flex: 1;
  min-width: 0;
}

.conflict-resolve-btn {
  flex-shrink: 0;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--warning) 55%, transparent);
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
  font-size: 10.5px;
  font-weight: 700;
  cursor: pointer;
}

.conflict-resolve-btn:hover {
  background: color-mix(in srgb, var(--warning) 28%, transparent);
}

.quick-presets-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.presets-label {
  font-size: 11px;
  color: var(--text-quaternary);
}

.preset-chip {
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.preset-chip:hover {
  border-color: var(--accent-border);
  color: var(--tide-text);
  background: var(--accent-soft);
}

.recent-created-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 6px;
  border-top: 1px dashed var(--border-subtle);
}

.recent-label {
  font-size: 10.5px;
  color: var(--text-quaternary);
}

.recent-chips {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.recent-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 6px 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  font-size: 10.5px;
  color: var(--text-secondary);
}

.recent-title {
  cursor: pointer;
  max-width: 150px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-title:hover {
  color: var(--tide-text);
}

.recent-undo {
  border: none;
  background: transparent;
  color: var(--text-quaternary);
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
}

.recent-undo:hover {
  color: var(--danger);
}
</style>
