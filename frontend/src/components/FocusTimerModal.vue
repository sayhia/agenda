<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { parseReminderSubtasks } from '../domain/reminder';
import { AMBIENT_SOUND_OPTIONS, playFocusCompleteChime, type AmbientSound } from '../utils/audio';
import { triggerFileDownload } from '../utils/export';
import {
  BREAK_DURATION_PRESETS,
  FOCUS_DIAL_HUD_OPTIONS,
  FOCUS_EFFECT_OPTIONS,
  FOCUS_MOOD_LABELS,
  FOCUS_PRESETS,
  FOCUS_VIEW_FORMS,
  clearFocusHistory,
  exportFocusHistoryMarkdown,
  formatMinutesCompact,
  type FocusDialHudOverride,
  type FocusEffectOverride,
  type FocusPhaseMode,
  type FocusSessionMood,
} from '../utils/focus';
import {
  addManualFocusEntry,
  applyCustomDuration,
  applyFocusPreset,
  bindFocusReminder,
  breakBreathingCue,
  completeCurrentTaskAndClearFocus,
  cycleFocusDialHudStyle,
  cycleFocusEffectStyle,
  cycleFocusViewForm,
  extendFocusTimer,
  focusBreakdown,
  focusDisplayClock,
  focusEngineState,
  focusProgressPercent,
  focusThemeAura,
  getAmbientLabel,
  isFinalMinuteSprint,
  pauseFocusTimer,
  rateLastFocusSessionMood,
  recordFocusDistraction,
  refreshFocusStats,
  reminderFocusMap,
  removeFocusHistoryEntry,
  resetFocusTimer,
  resolvePendingTaskSwitch,
  restoreDefaultFocusPreferences,
  setFocusAmbientSound,
  setFocusAmbientVolume,
  setFocusDialHudStyle,
  setFocusEffectStyle,
  setFocusIntention,
  setFocusViewForm,
  skipToNextFocusPhase,
  stopFocusAmbientPreview,
  switchFocusMode,
  syncFocusWithCurrentTheme,
  toggleAmbientFollowTheme,
  toggleAmbientMute,
  toggleFocusFxEnabled,
  toggleFocusTimer,
  toggleZenMode,
  updateFocusPreferences,
} from '../utils/focusEngine';
import { getChineseShichen } from '../utils/shanshui';
import FocusEffectCanvas from './FocusEffectCanvas.vue';
import FocusStageView from './FocusStageView.vue';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    reminder: Reminder | null;
    reminders?: Reminder[];
  }>(),
  {
    reminders: () => [],
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'popout'): void;
  (e: 'complete-task', reminder: Reminder): void;
  (e: 'update-subtasks', id: string, subtasksJson: string): void;
  (e: 'switch-task', reminder: Reminder | null): void;
  (e: 'cycle-theme', direction: 1 | -1): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
}>();

const activeDrawer = ref<'none' | 'prefs' | 'history'>('none');
const showTaskPicker = ref(false);
const customMinutesInput = ref(focusEngineState.durationMinutes);
const liveAnnouncement = ref('');

const state = focusEngineState;

const resolvedReminder = computed<Reminder | null>(() => {
  if (state.reminderId && props.reminders.length > 0) {
    const found = props.reminders.find((item) => item.id === state.reminderId);
    if (found) return found;
  }
  return props.reminder;
});

const activeTaskOptions = computed(() =>
  props.reminders.filter((item) => item.status === 'active').slice(0, 18),
);

const currentSubtasks = computed(() =>
  resolvedReminder.value ? parseReminderSubtasks(resolvedReminder.value.subtasks) : [],
);

const completedSubtaskCount = computed(
  () => currentSubtasks.value.filter((st) => st.done).length,
);

const currentTaskFocusSummary = computed(() => {
  const id = resolvedReminder.value?.id || state.reminderId;
  return id ? reminderFocusMap.value.get(id) || null : null;
});

const phaseMeta = computed(() => {
  if (state.mode === 'shortBreak') {
    return {
      badge: `SHORT BREAK · ${state.durationMinutes}M`,
      phaseLabel: state.isRunning ? 'GENTLE REST' : 'SHORT BREAK',
      seal: '憩',
      sealTip: '小憩闲章',
      shortTitle: '短休',
    };
  }
  if (state.mode === 'longBreak') {
    return {
      badge: `LONG BREAK · ${state.durationMinutes}M`,
      phaseLabel: state.isRunning ? 'DEEP RESTORE' : 'LONG BREAK',
      seal: '养',
      sealTip: '养神闲章',
      shortTitle: '长休',
    };
  }
  return {
    badge: `DEEP FOCUS · ${state.durationMinutes}M`,
    phaseLabel: state.isRunning ? 'FLOW STATE' : 'FOCUS READY',
    seal: '静',
    sealTip: '专注静印',
    shortTitle: '专注',
  };
});

const cycleDots = computed(() => {
  const total = Math.max(2, state.prefs.longBreakInterval);
  const done = state.completedRoundsInCycle % total;
  return Array.from({ length: total }, (_, idx) => ({
    index: idx,
    completed: idx < done,
    current: idx === done && state.mode === 'focus',
  }));
});

const currentShichen = computed(() => {
  props.visible;
  state.secondsLeft;
  return getChineseShichen(new Date());
});

function handleSyncThemeSound() {
  const enabled = toggleAmbientFollowTheme();
  if (enabled) {
    const label = AMBIENT_SOUND_OPTIONS.find((o) => o.id === state.prefs.ambientSound)?.name || state.prefs.ambientSound;
    emit('toast', `已开启随境配声（${focusThemeAura.value.themeName} · ${label}）`, 'info');
  } else {
    emit('toast', '已关闭声景随主题自动切换', 'info');
  }
}

function handleRateMood(mood: FocusSessionMood) {
  rateLastFocusSessionMood(mood);
  emit('toast', `已记录本轮心流感受：${FOCUS_MOOD_LABELS[mood].icon} ${FOCUS_MOOD_LABELS[mood].label}`, 'success');
}

function toggleDrawer(target: 'prefs' | 'history') {
  activeDrawer.value = activeDrawer.value === target ? 'none' : target;
  if (activeDrawer.value === 'history') {
    refreshFocusStats();
  }
}

function handleModeTab(mode: FocusPhaseMode) {
  switchFocusMode(mode);
  customMinutesInput.value = state.durationMinutes;
  liveAnnouncement.value = `已切换至${mode === 'focus' ? '专注' : mode === 'shortBreak' ? '短休' : '长休'}模式`;
}

function handlePresetSelect(presetFocusMin: number) {
  const matched = FOCUS_PRESETS.find((p) => p.focusMinutes === presetFocusMin);
  if (matched && state.mode === 'focus') {
    applyFocusPreset(matched);
  } else {
    applyCustomDuration(presetFocusMin);
  }
  customMinutesInput.value = state.durationMinutes;
}

function handleApplyCustomInput() {
  const val = Number(customMinutesInput.value);
  if (!Number.isFinite(val)) return;
  applyCustomDuration(val);
  customMinutesInput.value = state.durationMinutes;
}

function handleToggleSubtask(subtaskId: string) {
  const rem = resolvedReminder.value;
  if (!rem) return;
  const list = parseReminderSubtasks(rem.subtasks).map((item) =>
    item.id === subtaskId ? { ...item, done: !item.done } : item,
  );
  emit('update-subtasks', rem.id, JSON.stringify(list));
}

function handlePickTask(reminder: Reminder | null) {
  bindFocusReminder(reminder, true);
  emit('switch-task', reminder);
  showTaskPicker.value = false;
  if (reminder) {
    emit('toast', `已关联专注任务：${reminder.title}`, 'info');
  } else {
    emit('toast', '已切换为自由无任务专注', 'info');
  }
}

function handleCompleteTask() {
  const rem = resolvedReminder.value;
  if (!rem) return;
  completeCurrentTaskAndClearFocus();
  emit('complete-task', rem);
  emit('close');
}

function handleClearHistory() {
  clearFocusHistory();
  refreshFocusStats();
  emit('toast', '已清空本地专注历史记录', 'info');
}

function handleExportMarkdownReport() {
  const md = exportFocusHistoryMarkdown();
  triggerFileDownload(md, `agenda-focus-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown;charset=utf-8');
  emit('toast', '已导出番茄专注 Markdown 总结报告', 'success');
}

function handleManualLogFocus() {
  const mins = Math.max(5, state.prefs.focusMinutes || 25);
  addManualFocusEntry(
    mins,
    resolvedReminder.value?.id || state.reminderId,
    resolvedReminder.value?.title || state.reminderTitle || '线下专注补录',
    state.intention,
  );
  emit('toast', `已补录 ${mins} 分钟线下专注记录`, 'success');
}

function handleDeleteHistoryEntry(entryId: string) {
  if (removeFocusHistoryEntry(entryId)) {
    emit('toast', '已删除该条专注记录', 'info');
  }
}

function handleAmbientVolumeInput(e: Event) {
  const raw = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(raw)) {
    setFocusAmbientVolume(raw / 100);
  }
}

function handleLogDistraction() {
  recordFocusDistraction(1);
  liveAnnouncement.value = `已记录第 ${state.distractions} 次分心提醒，收回心神`;
}

function formatHistoryTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function handleFocusKeydown(e: KeyboardEvent) {
  if (!props.visible) return;
  const target = e.target as HTMLElement | null;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.code === 'Space') {
    e.preventDefault();
    toggleFocusTimer();
  } else if (e.key.toLowerCase() === 'r') {
    e.preventDefault();
    resetFocusTimer();
    emit('toast', '已重置当前计时阶段', 'info');
  } else if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    skipToNextFocusPhase();
  } else if (e.key.toLowerCase() === 'm') {
    e.preventDefault();
    const sound = toggleAmbientMute();
    emit('toast', sound === 'none' ? '已静音背景环境音' : `已开启${getAmbientLabel(sound)}环境音`, 'info');
  } else if (e.key.toLowerCase() === 'z') {
    e.preventDefault();
    toggleZenMode();
  } else if (e.key.toLowerCase() === 'd') {
    e.preventDefault();
    handleLogDistraction();
  } else if (e.key.toLowerCase() === 'h') {
    e.preventDefault();
    cycleFocusDialHudStyle();
    emit('toast', `切换表盘 HUD：${focusThemeAura.value.dialHudLabel}`, 'info');
  } else if (e.key.toLowerCase() === 'v') {
    e.preventDefault();
    const form = cycleFocusViewForm();
    const label = FOCUS_VIEW_FORMS.find((v) => v.id === form)?.name || form;
    emit('toast', `切换计时展现形式：${label}`, 'info');
  } else if (e.key === ']' || e.key === '+' || e.key === '=') {
    e.preventDefault();
    extendFocusTimer(5);
  } else if (e.key === '[' || e.key === '-') {
    e.preventDefault();
    extendFocusTimer(-5);
  }
}

watch(
  () => [props.visible, props.reminder?.id],
  ([visible]) => {
    if (visible) {
      syncFocusWithCurrentTheme();
      refreshFocusStats();
      if (props.reminder) {
        bindFocusReminder(props.reminder);
      }
      customMinutesInput.value = state.durationMinutes;
      window.addEventListener('keydown', handleFocusKeydown);
    } else {
      showTaskPicker.value = false;
      activeDrawer.value = 'none';
      stopFocusAmbientPreview();
      window.removeEventListener('keydown', handleFocusKeydown);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  stopFocusAmbientPreview();
  window.removeEventListener('keydown', handleFocusKeydown);
});
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="focus-overlay" @click.self="$emit('close')">
      <div
        class="focus-card st-reticle"
        :class="{
          'is-zen': state.zenMode,
          'is-running-fx': state.isRunning && state.prefs.fxEnabled,
        }"
        role="dialog"
        aria-modal="true"
        aria-label="专注计时"
      >
        <FocusEffectCanvas
          :active="visible"
          :running="state.isRunning"
          :mode="state.mode"
          :effectStyle="focusThemeAura.effectStyle"
          :dialHudStyle="focusThemeAura.dialHudStyle"
          :showDialHud="state.prefs.viewForm === 'dial'"
          :fxEnabled="state.prefs.fxEnabled"
          :completionSignal="state.lastCompletionAt"
          :startSignal="state.lastStartPulseAt"
          :sprintActive="isFinalMinuteSprint"
          :zenActive="state.zenMode"
          :secondsLeft="state.secondsLeft"
        />
        <span class="sr-only" aria-live="polite">{{ liveAnnouncement }}</span>

        <!-- Header -->
        <div class="focus-head">
          <div
            class="focus-badge"
            :class="{
              'is-break': state.mode === 'shortBreak',
              'is-long-break': state.mode === 'longBreak',
              running: state.isRunning,
            }"
          >
            <span class="mode-dot"></span>
            <span>{{ phaseMeta.badge }}</span>
          </div>

          <div class="focus-head-right">
            <span class="shanshui-seal" :title="phaseMeta.sealTip">{{ phaseMeta.seal }}</span>
            <span
              class="daily-focus-chip"
              :title="`今日目标 ${state.stats.todayMinutes} / ${state.prefs.dailyGoalMinutes} 分钟 · 连续专注 ${state.stats.streakDays} 天`"
            >
              今日 {{ state.stats.todayMinutes }}/{{ state.prefs.dailyGoalMinutes }}m
            </span>
            <button
              type="button"
              class="focus-icon-btn"
              :class="{ active: state.zenMode }"
              title="禅意沉浸模式 (Z)"
              aria-label="切换禅意沉浸模式"
              @click="toggleZenMode"
            >
              <span>禅</span>
            </button>
            <button
              v-if="!state.zenMode"
              type="button"
              class="focus-icon-btn"
              :class="{ active: activeDrawer === 'prefs' }"
              title="专注偏好与目标设置"
              aria-label="专注偏好设置"
              @click="toggleDrawer('prefs')"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              v-if="!state.zenMode"
              type="button"
              class="focus-icon-btn"
              :class="{ active: activeDrawer === 'history' }"
              title="查看近期专注历史"
              aria-label="专注历史"
              @click="toggleDrawer('history')"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 14" />
              </svg>
            </button>
            <button
              v-if="!state.zenMode"
              type="button"
              class="focus-icon-btn"
              title="弹出为置顶独立专注浮窗"
              aria-label="弹出为置顶独立专注浮窗"
              @click="$emit('popout')"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
            <button
              class="modal-close-btn close-btn"
              :title="state.isRunning ? '最小化到顶部状态栏 (Esc · 计时将继续运行)' : '退出专注视图 (Esc)'"
              aria-label="最小化专注窗口"
              @click="$emit('close')"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Pending Task Switch Banner (prevents accidental overwrite of in-progress timer) -->
        <div v-if="state.pendingTaskCandidate" class="pending-switch-banner">
          <span class="pending-copy">
            正在为「{{ state.reminderTitle || '上一任务' }}」计时，是否切换为「{{ state.pendingTaskCandidate.title }}」？
          </span>
          <div class="pending-actions">
            <button type="button" class="mini-pill primary" @click="resolvePendingTaskSwitch(true)">切换新任务</button>
            <button type="button" class="mini-pill" @click="resolvePendingTaskSwitch(false)">保留当前</button>
          </div>
        </div>

        <div class="theme-aura-strip" :title="`${focusThemeAura.poem} · 表盘：${focusThemeAura.dialHudLabel}`">
          <div class="aura-left">
            <span class="aura-swatches" aria-hidden="true">
              <i :style="{ background: focusThemeAura.primaryColor }"></i>
              <i :style="{ background: focusThemeAura.secondaryColor }"></i>
            </span>
            <span class="aura-theme-name">{{ focusThemeAura.themeName }}</span>
            <span class="aura-sep">·</span>
            <span class="aura-effect-label">{{ focusThemeAura.dialHudLabel }}</span>
          </div>
          <div class="aura-actions">
            <button
              type="button"
              class="aura-chip-btn"
              :class="{ active: state.prefs.ambientFollowTheme }"
              :title="state.prefs.ambientFollowTheme ? '已开启：声景随主题切换' : '点击匹配当前主题声景并自动联动'"
              @click="handleSyncThemeSound()"
            >
              配声
            </button>
            <button
              type="button"
              class="aura-chip-btn"
              :class="{ active: state.prefs.fxEnabled }"
              title="开关表盘 HUD 与主题粒子特效"
              @click="toggleFocusFxEnabled()"
            >
              特效
            </button>
            <button
              v-if="state.prefs.viewForm === 'dial'"
              type="button"
              class="aura-chip-btn"
              :class="{ active: state.prefs.dialHudOverride !== 'auto' }"
              :title="`切换表盘 HUD 特效（当前：${focusThemeAura.dialHudLabel} · 快捷键 H）`"
              @click="cycleFocusDialHudStyle()"
            >
              换表盘
            </button>
            <button
              type="button"
              class="aura-chip-btn"
              :class="{ active: state.prefs.fxStyleOverride !== 'auto' }"
              :title="`切换背景粒子特效（当前：${focusThemeAura.effectLabel}）`"
              @click="cycleFocusEffectStyle()"
            >
              换粒子
            </button>
            <button
              type="button"
              class="aura-chip-btn"
              title="切换下一套主题（同步变换表盘、粒子与声景）"
              @click="$emit('cycle-theme', 1)"
            >
              换境
            </button>
          </div>
        </div>

        <!-- Phase Switcher & Cycle Dots -->
        <div v-if="!state.zenMode" class="phase-toolbar">
          <div class="phase-segmented" role="tablist" aria-label="专注阶段">
            <button
              type="button"
              role="tab"
              :aria-selected="state.mode === 'focus'"
              :class="{ active: state.mode === 'focus' }"
              @click="handleModeTab('focus')"
            >
              专注
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="state.mode === 'shortBreak'"
              :class="{ active: state.mode === 'shortBreak' }"
              @click="handleModeTab('shortBreak')"
            >
              短休
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="state.mode === 'longBreak'"
              :class="{ active: state.mode === 'longBreak' }"
              @click="handleModeTab('longBreak')"
            >
              长休
            </button>
          </div>

          <div
            class="cycle-dots-group"
            :title="`长休周期：已完成 ${state.completedRoundsInCycle} / ${state.prefs.longBreakInterval} 轮`"
          >
            <span
              v-for="dot in cycleDots"
              :key="dot.index"
              class="cycle-dot"
              :class="{ completed: dot.completed, current: dot.current }"
            ></span>
            <span class="cycle-label">{{ state.completedRoundsInCycle }}/{{ state.prefs.longBreakInterval }} 轮</span>
          </div>
        </div>

        <!-- Current Task Banner & Switcher -->
        <div class="task-info">
          <div class="task-title-row">
            <h3 class="task-title">{{ resolvedReminder?.title || state.reminderTitle || '自由沉浸专注（未绑定日程）' }}</h3>
            <button
              v-if="!state.zenMode && activeTaskOptions.length > 0"
              type="button"
              class="task-switch-btn"
              title="切换关联的活跃日程"
              @click="showTaskPicker = !showTaskPicker"
            >
              {{ showTaskPicker ? '收起' : '换任务' }}
            </button>
          </div>

          <p class="task-shichen-hint">
            {{ currentShichen.branch }}时{{ currentShichen.alias }} · {{ currentShichen.poeticHint }}
            <template v-if="state.stats.streakDays > 0"> · 连续 {{ state.stats.streakDays }} 天</template>
            <template v-if="currentTaskFocusSummary"> · 本任务已投 {{ formatMinutesCompact(currentTaskFocusSummary.totalMinutes) }}（{{ currentTaskFocusSummary.sessions }}轮）</template>
          </p>

          <p v-if="!state.zenMode && resolvedReminder?.notes" class="task-notes">{{ resolvedReminder.notes }}</p>

          <!-- Lightweight Task Picker -->
          <div v-if="!state.zenMode && showTaskPicker" class="task-picker-dropdown">
            <button
              type="button"
              class="task-pick-item"
              :class="{ active: !resolvedReminder }"
              @click="handlePickTask(null)"
            >
              <span>自由无任务专注</span>
              <small>不关联特定日程</small>
            </button>
            <button
              v-for="item in activeTaskOptions"
              :key="item.id"
              type="button"
              class="task-pick-item"
              :class="{ active: resolvedReminder?.id === item.id }"
              @click="handlePickTask(item)"
            >
              <span class="pick-title">{{ item.title }}</span>
              <small class="pick-priority">{{ (item.priority || 'p2').toUpperCase() }}</small>
            </button>
          </div>
        </div>

        <!-- Intention & Distraction Row -->
        <div v-if="!state.zenMode && state.mode === 'focus'" class="intention-row">
          <input
            type="text"
            class="intention-input"
            :value="state.intention"
            maxlength="80"
            placeholder="写下本轮核心推进目标（如：写完模块单测）..."
            aria-label="本轮专注核心目标"
            @input="setFocusIntention(($event.target as HTMLInputElement).value)"
          />
          <button
            type="button"
            class="distraction-btn"
            :class="{ has: state.distractions > 0 }"
            title="记录走神/打断一次，觉察并拉回注意力 (快捷键 D)"
            @click="handleLogDistraction"
          >
            <span>分心 {{ state.distractions > 0 ? state.distractions : '+1' }}</span>
          </button>
        </div>

        <!-- Presentation Form Switcher (5 Distinct Modalities · Hotkey V) -->
        <div v-if="!state.zenMode" class="view-form-bar" role="tablist" aria-label="计时展现形式">
          <button
            v-for="vf in FOCUS_VIEW_FORMS"
            :key="vf.id"
            type="button"
            role="tab"
            class="view-form-pill"
            :class="{ active: state.prefs.viewForm === vf.id }"
            :aria-selected="state.prefs.viewForm === vf.id"
            :title="`${vf.desc}（按 V 快捷切换）`"
            @click="setFocusViewForm(vf.id)"
          >
            {{ vf.name }}
          </button>
        </div>

        <!-- Kinetic Multi-Form Centerpiece Stage -->
        <FocusStageView
          :viewForm="state.prefs.viewForm"
          :displayClock="focusDisplayClock"
          :progressPercent="focusProgressPercent"
          :mode="state.mode"
          :isRunning="state.isRunning"
          :fxEnabled="state.prefs.fxEnabled"
          :isSprint="isFinalMinuteSprint"
          :phaseLabel="phaseMeta.phaseLabel"
          :intention="state.intention"
          :zenMode="state.zenMode"
          :breathingCue="breakBreathingCue"
        />

        <!-- Post-Session Flow Reflection Bar -->
        <div v-if="!state.zenMode && state.lastCompletedEntryId" class="mood-reflection-bar">
          <span class="mood-prompt">本轮专注体感如何？</span>
          <div class="mood-chips">
            <button
              v-for="(meta, moodKey) in FOCUS_MOOD_LABELS"
              :key="moodKey"
              type="button"
              class="mood-chip-btn"
              @click="handleRateMood(moodKey as FocusSessionMood)"
            >
              {{ meta.icon }} {{ meta.label }}
            </button>
          </div>
        </div>

        <!-- Daily Goal Progress Strip -->
        <div v-if="!state.zenMode" class="daily-goal-strip">
          <div class="goal-strip-meta">
            <span>今日专注达成 {{ state.stats.goalPercent }}%（已完成 {{ state.stats.todaySessions }} 轮 · {{ formatMinutesCompact(state.stats.todayMinutes) }}）</span>
            <span v-if="state.isRunning" class="running-bg-hint">关闭弹窗可最小化至顶栏继续运行</span>
          </div>
          <div class="goal-strip-track" aria-hidden="true">
            <div class="goal-strip-fill" :style="{ width: state.stats.goalPercent + '%' }"></div>
          </div>
        </div>

        <!-- Embedded Task Subtasks (when bound reminder has checklist items) -->
        <div v-if="!state.zenMode && currentSubtasks.length > 0" class="focus-subtasks-card">
          <div class="subtasks-head">
            <span>任务步骤推进</span>
            <small class="tabular-nums">{{ completedSubtaskCount }} / {{ currentSubtasks.length }}</small>
          </div>
          <div class="subtasks-list">
            <button
              v-for="sub in currentSubtasks"
              :key="sub.id"
              type="button"
              class="subtask-row"
              :class="{ done: sub.done }"
              @click="handleToggleSubtask(sub.id)"
            >
              <span class="subtask-check" aria-hidden="true">{{ sub.done ? '✓' : '' }}</span>
              <span class="subtask-text">{{ sub.title }}</span>
            </button>
          </div>
        </div>

        <!-- Presets & Ambient Sound Bar -->
        <div v-if="!state.zenMode" class="focus-preset-ambient-bar">
          <div class="preset-row">
            <div class="preset-pill-group" role="group" aria-label="专注时长预设">
              <button
                v-if="state.mode === 'focus' && resolvedReminder?.duration_minutes && !FOCUS_PRESETS.some((x) => x.focusMinutes === resolvedReminder?.duration_minutes)"
                type="button"
                class="preset-pill-btn task-est-pill"
                :class="{ active: state.durationMinutes === resolvedReminder.duration_minutes }"
                :disabled="state.isRunning"
                :title="`按「${resolvedReminder.title}」的日程预估时长设置`"
                @click="handlePresetSelect(resolvedReminder.duration_minutes)"
              >
                日程 {{ resolvedReminder.duration_minutes }}m
              </button>
              <button
                v-for="p in (state.mode === 'focus' ? FOCUS_PRESETS.map((x) => x.focusMinutes) : BREAK_DURATION_PRESETS)"
                :key="p"
                type="button"
                class="preset-pill-btn"
                :class="{ active: state.durationMinutes === p }"
                :disabled="state.isRunning"
                @click="handlePresetSelect(p)"
              >
                {{ p }}m
              </button>
            </div>
            <label class="custom-min-wrap" title="自定义当前阶段时长（分钟）">
              <input
                v-model.number="customMinutesInput"
                type="number"
                min="1"
                max="180"
                class="custom-min-input tabular-nums"
                :disabled="state.isRunning"
                aria-label="自定义时长分钟数"
                @change="handleApplyCustomInput"
              />
              <span>分</span>
            </label>
          </div>

          <div class="ambient-row">
            <div class="ambient-pill-group" role="group" aria-label="背景白噪">
              <button
                v-for="opt in AMBIENT_SOUND_OPTIONS"
                :key="opt.id"
                type="button"
                class="ambient-pill-btn"
                :class="{ active: state.prefs.ambientSound === opt.id }"
                :title="opt.hint"
                @click="setFocusAmbientSound(opt.id as AmbientSound)"
              >
                {{ opt.name }}
              </button>
            </div>
            <div v-if="state.prefs.ambientSound !== 'none'" class="ambient-volume-row">
              <span class="volume-label">声景音量</span>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                :value="Math.round(state.prefs.ambientVolume * 100)"
                aria-label="声景音量"
                @input="handleAmbientVolumeInput"
              />
              <span class="volume-val tabular-nums">{{ Math.round(state.prefs.ambientVolume * 100) }}%</span>
            </div>
          </div>
        </div>

        <!-- Collapsible Preferences Drawer -->
        <div v-if="!state.zenMode && activeDrawer === 'prefs'" class="focus-drawer">
          <div class="drawer-head">
            <span>专注节律与自动连播设置</span>
            <div style="display: inline-flex; align-items: center; gap: 8px;">
              <button type="button" class="drawer-reset-btn" @click="playFocusCompleteChime('focus')">试听提示音</button>
              <button type="button" class="drawer-reset-btn" @click="restoreDefaultFocusPreferences">恢复默认</button>
            </div>
          </div>
          <div class="prefs-grid">
            <label class="pref-toggle">
              <input
                type="checkbox"
                :checked="state.prefs.autoStartBreak"
                @change="updateFocusPreferences({ autoStartBreak: ($event.target as HTMLInputElement).checked })"
              />
              <span>专注完成后自动进入休息</span>
            </label>
            <label class="pref-toggle">
              <input
                type="checkbox"
                :checked="state.prefs.autoStartFocus"
                @change="updateFocusPreferences({ autoStartFocus: ($event.target as HTMLInputElement).checked })"
              />
              <span>休息结束后自动开始下一轮</span>
            </label>
            <label class="pref-toggle">
              <input
                type="checkbox"
                :checked="state.prefs.tickSoundEnabled"
                @change="updateFocusPreferences({ tickSoundEnabled: ($event.target as HTMLInputElement).checked })"
              />
              <span>启用柔和木鱼节拍声</span>
            </label>
            <label class="pref-toggle">
              <input
                type="checkbox"
                :checked="state.prefs.zenModeOnRun"
                @change="updateFocusPreferences({ zenModeOnRun: ($event.target as HTMLInputElement).checked })"
              />
              <span>开始专注时自动进入禅意模式</span>
            </label>
            <label class="pref-toggle">
              <input
                type="checkbox"
                :checked="state.prefs.desktopNotifyEnabled"
                @change="updateFocusPreferences({ desktopNotifyEnabled: ($event.target as HTMLInputElement).checked })"
              />
              <span>阶段完成时推送桌面通知</span>
            </label>
            <label class="pref-toggle">
              <input
                type="checkbox"
                :checked="state.prefs.fxEnabled"
                @change="updateFocusPreferences({ fxEnabled: ($event.target as HTMLInputElement).checked })"
              />
              <span>启用主题流光粒子与庆祝特效</span>
            </label>
            <label class="pref-toggle">
              <input
                type="checkbox"
                :checked="state.prefs.ambientFollowTheme"
                @change="updateFocusPreferences({ ambientFollowTheme: ($event.target as HTMLInputElement).checked })"
              />
              <span>声景随当前主题切换自动联动</span>
            </label>
          </div>
          <div class="fx-style-picker-row">
            <span class="fx-picker-label">表盘 HUD 全息风格（当前：{{ focusThemeAura.dialHudLabel }}）</span>
            <div class="fx-picker-pills" role="group" aria-label="表盘 HUD 全息风格">
              <button
                v-for="hudOpt in FOCUS_DIAL_HUD_OPTIONS"
                :key="hudOpt.id"
                type="button"
                class="fx-style-pill"
                :class="{ active: state.prefs.dialHudOverride === hudOpt.id }"
                @click="setFocusDialHudStyle(hudOpt.id as FocusDialHudOverride)"
              >
                {{ hudOpt.name }}
              </button>
            </div>
          </div>
          <div class="fx-style-picker-row">
            <span class="fx-picker-label">背景粒子意境（当前：{{ focusThemeAura.effectLabel }}）</span>
            <div class="fx-picker-pills" role="group" aria-label="背景粒子意境">
              <button
                v-for="fxOpt in FOCUS_EFFECT_OPTIONS"
                :key="fxOpt.id"
                type="button"
                class="fx-style-pill"
                :class="{ active: state.prefs.fxStyleOverride === fxOpt.id }"
                @click="setFocusEffectStyle(fxOpt.id as FocusEffectOverride)"
              >
                {{ fxOpt.name }}
              </button>
            </div>
          </div>
          <div class="prefs-numbers-row">
            <label class="pref-num-field">
              <span>每日目标(分)</span>
              <input
                type="number"
                min="15"
                max="720"
                step="15"
                :value="state.prefs.dailyGoalMinutes"
                @change="updateFocusPreferences({ dailyGoalMinutes: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
            <label class="pref-num-field">
              <span>长休周期(轮)</span>
              <input
                type="number"
                min="2"
                max="8"
                step="1"
                :value="state.prefs.longBreakInterval"
                @change="updateFocusPreferences({ longBreakInterval: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
            <label class="pref-num-field">
              <span>长休时长(分)</span>
              <input
                type="number"
                min="5"
                max="90"
                step="5"
                :value="state.prefs.longBreakMinutes"
                @change="updateFocusPreferences({ longBreakMinutes: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>
          </div>
        </div>

        <!-- Collapsible History Drawer -->
        <div v-if="!state.zenMode && activeDrawer === 'history'" class="focus-drawer">
          <div class="drawer-head">
            <span>近期专注记录（累计 {{ formatMinutesCompact(state.stats.totalMinutes) }} · 零分心 {{ focusBreakdown.zeroDistractionPercent }}%）</span>
            <div style="display: inline-flex; align-items: center; gap: 8px;">
              <button type="button" class="drawer-reset-btn" title="手动补录一轮线下专注" @click="handleManualLogFocus">
                +{{ state.prefs.focusMinutes }}m 补录
              </button>
              <button
                v-if="state.stats.recentSessions.length > 0"
                type="button"
                class="drawer-reset-btn"
                title="导出专注统计与历史 Markdown"
                @click="handleExportMarkdownReport"
              >
                导出报告
              </button>
              <button
                v-if="state.stats.recentSessions.length > 0"
                type="button"
                class="drawer-reset-btn"
                @click="handleClearHistory"
              >
                清空
              </button>
            </div>
          </div>
          <div v-if="state.stats.recentSessions.length === 0" class="history-empty">
            完成第一轮专注后，这里将自动沉淀你的节奏足迹。
          </div>
          <div v-else class="history-list">
            <div v-for="entry in state.stats.recentSessions" :key="entry.id" class="history-item">
              <div class="history-main">
                <span class="history-title">{{ entry.reminderTitle || entry.intention || '自由沉浸专注' }}</span>
                <span class="history-meta">{{ formatHistoryTime(entry.completedAt) }}</span>
              </div>
              <div class="history-badges">
                <span v-if="entry.mood" class="history-mood" :title="FOCUS_MOOD_LABELS[entry.mood].label">{{ FOCUS_MOOD_LABELS[entry.mood].icon }}</span>
                <span class="history-dur tabular-nums">+{{ entry.durationMinutes }}m</span>
                <span v-if="entry.distractions > 0" class="history-dist">{{ entry.distractions }} 分心</span>
                <button
                  type="button"
                  class="history-del-btn"
                  title="删除此条记录"
                  aria-label="删除此条专注记录"
                  @click="handleDeleteHistoryEntry(entry.id)"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Controls -->
        <div class="focus-controls">
          <button
            class="control-btn primary-control st-inline-icon"
            :class="{ running: state.isRunning }"
            title="空格键 (Space) 开始或暂停"
            @click="toggleFocusTimer"
          >
            <svg v-if="state.isRunning" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
            <span>{{ state.isRunning ? '暂停' : state.secondsLeft < state.phaseTotalSeconds ? '继续专注' : '开始专注' }}</span>
          </button>

          <template v-if="!state.zenMode">
            <button class="control-btn st-inline-icon" title="延长 5 分钟 (+ / ])" @click="extendFocusTimer(5)">
              <span>+5m</span>
            </button>
            <button class="control-btn st-inline-icon" title="重置本轮计时 (R)" @click="resetFocusTimer">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>重置</span>
            </button>
            <button class="control-btn st-inline-icon" title="跳过当前阶段 (N)" @click="skipToNextFocusPhase">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
              <span>下一段</span>
            </button>
          </template>
          <button v-else class="control-btn st-inline-icon" title="退出禅意沉浸 (Z)" @click="pauseFocusTimer(); toggleZenMode()">
            <span>退出禅意</span>
          </button>
        </div>

        <!-- Quick Complete Button -->
        <div v-if="!state.zenMode && resolvedReminder && resolvedReminder.status !== 'ended'" class="focus-foot">
          <button class="complete-btn st-inline-icon" @click="handleCompleteTask">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>任务已完成，结算本轮专注并归档</span>
          </button>
        </div>

        <p v-if="!state.zenMode" class="focus-shortcut-legend" aria-hidden="true">
          Space 启停 · V 换形态 · H 换表盘 · Z 禅意 · R 重置 · N 下一段
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.focus-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-scrim);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  z-index: var(--z-overlay-high);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.focus-card {
  position: relative;
  width: 492px;
  max-width: 100%;
  max-height: min(92vh, 780px);
  overflow-x: hidden;
  overflow-y: auto;
  background:
    radial-gradient(120% 75% at 50% 0%, color-mix(in srgb, var(--tide) 11%, transparent), transparent 62%),
    radial-gradient(90% 65% at 90% 100%, color-mix(in srgb, var(--theme-secondary, var(--lime-strong, var(--tide))) 8%, transparent), transparent 60%),
    color-mix(in srgb, var(--surface-overlay) 94%, transparent);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
  border: 1px solid var(--border-strong);
  border-radius: 22px;
  padding: 22px 24px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  transition: width 220ms var(--motion-normal), padding 220ms var(--motion-normal), box-shadow 260ms ease, border-color 260ms ease;
}

.focus-card > :not(.focus-effect-canvas) {
  position: relative;
  z-index: 1;
}

.focus-card.is-running-fx {
  border-color: color-mix(in srgb, var(--tide) 48%, var(--border-strong));
  box-shadow:
    var(--shadow-lg),
    0 0 36px -10px color-mix(in srgb, var(--tide) 32%, transparent),
    0 0 18px -6px color-mix(in srgb, var(--theme-secondary, var(--lime-strong, var(--tide))) 22%, transparent);
}

.focus-card.is-zen {
  width: 410px;
  padding: 28px 26px;
}

.theme-aura-strip {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 9px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-surface) 84%, transparent);
  border: 1px solid var(--border-subtle);
  backdrop-filter: blur(8px);
}

.aura-left {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  color: var(--text-secondary);
}

.aura-swatches {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.aura-swatches i {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary) 18%, transparent);
}

.aura-theme-name {
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aura-sep {
  opacity: 0.4;
}

.aura-effect-label {
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aura-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.aura-chip-btn {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-overlay);
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s ease;
}

.aura-chip-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}

.aura-chip-btn.active {
  color: var(--tide);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.focus-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.focus-head-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.daily-focus-chip {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--tide);
  background: var(--accent-soft);
  border: 1px solid var(--border-subtle);
  padding: 2px 7px;
  border-radius: 6px;
  white-space: nowrap;
}

.focus-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s ease;
}

.focus-icon-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}

.focus-icon-btn.active {
  color: var(--tide);
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.focus-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 99px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.focus-badge.running {
  color: var(--tide);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.focus-badge.is-break.running {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 38%, transparent);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.focus-badge.is-long-break.running {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 42%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
}

.mode-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}

.pending-switch-banner {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--warning) 12%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
  font-size: 11.5px;
  color: var(--text-primary);
  text-align: left;
}

.pending-actions {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.mini-pill {
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.mini-pill.primary {
  background: var(--tide);
  border-color: var(--tide);
  color: var(--ink-on-accent);
}

.phase-toolbar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.phase-segmented {
  display: inline-flex;
  padding: 2px;
  border-radius: 9px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  gap: 2px;
}

.phase-segmented button {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.phase-segmented button.active {
  background: var(--accent-soft);
  color: var(--tide);
}

.cycle-dots-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.cycle-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--border-strong);
  transition: transform 0.16s ease, background 0.16s ease;
}

.cycle-dot.completed {
  background: var(--tide);
}

.cycle-dot.current {
  background: color-mix(in srgb, var(--tide) 48%, transparent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.cycle-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
  margin-left: 2px;
}

.task-info {
  width: 100%;
  position: relative;
}

.task-title-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.task-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.35;
}

.task-switch-btn {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--tide);
  background: var(--accent-soft);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 2px 7px;
  cursor: pointer;
}

.task-shichen-hint {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--tide);
  letter-spacing: 0.03em;
  opacity: 0.9;
}

.task-notes {
  margin: 5px auto 0;
  font-size: 12px;
  color: var(--text-muted);
  max-width: 390px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-picker-dropdown {
  margin-top: 8px;
  width: 100%;
  max-height: 150px;
  overflow-y: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.task-pick-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.task-pick-item:hover,
.task-pick-item.active {
  background: var(--accent-soft);
  color: var(--tide);
}

.pick-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pick-priority {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.intention-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
}

.intention-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-primary);
}

.intention-input:focus {
  outline: none;
  border-color: var(--accent-border);
}

.distraction-btn {
  flex-shrink: 0;
  padding: 6px 9px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.distraction-btn.has {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 40%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
}

.view-form-bar {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
}

.view-form-pill {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 2px;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.16s ease;
}

.view-form-pill:hover {
  color: var(--text-primary);
}

.view-form-pill.active {
  background: var(--accent-soft);
  color: var(--tide);
  box-shadow: inset 0 0 0 1px var(--accent-border);
}

.fx-style-picker-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
}

.fx-picker-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-muted);
}

.fx-picker-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.fx-style-pill {
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-overlay);
  color: var(--text-muted);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}

.fx-style-pill.active {
  color: var(--tide);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.daily-goal-strip {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.goal-strip-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.running-bg-hint {
  color: var(--tide);
  font-size: 10.5px;
}

.goal-strip-track {
  width: 100%;
  height: 5px;
  border-radius: 99px;
  background: var(--bg-surface);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}

.goal-strip-fill {
  height: 100%;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--tide), var(--success));
  transition: width 0.3s ease;
}

.focus-subtasks-card {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 8px 10px;
  text-align: left;
}

.subtasks-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 5px;
}

.subtasks-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 92px;
  overflow-y: auto;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 5px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.subtask-row:hover {
  background: var(--fill-hover);
}

.subtask-row.done .subtask-text {
  text-decoration: line-through;
  color: var(--text-muted);
}

.subtask-check {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--tide);
  flex-shrink: 0;
}

.subtask-row.done .subtask-check {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.focus-preset-ambient-bar {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
}

.preset-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-pill-group,
.ambient-pill-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}

.custom-min-wrap {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--text-muted);
}

.custom-min-input {
  width: 36px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 700;
  text-align: center;
}

.custom-min-input:focus {
  outline: none;
}

.preset-pill-btn,
.ambient-pill-btn {
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.16s ease;
}

.preset-pill-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.preset-pill-btn.active,
.ambient-pill-btn.active {
  background: var(--accent-soft);
  color: var(--tide);
  border-color: var(--accent-border);
}

.preset-pill-btn:not(:disabled):hover,
.ambient-pill-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.ambient-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.ambient-volume-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.ambient-volume-row input[type='range'] {
  width: 130px;
  accent-color: var(--tide);
}

.focus-drawer {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  padding: 10px 12px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-primary);
}

.drawer-reset-btn {
  border: none;
  background: transparent;
  color: var(--tide);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.prefs-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 10px;
}

.pref-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
  cursor: pointer;
}

.pref-toggle input {
  accent-color: var(--tide);
}

.prefs-numbers-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid var(--border-subtle);
}

.pref-num-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 10.5px;
  color: var(--text-muted);
}

.pref-num-field input {
  width: 100%;
  background: var(--surface-overlay);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 4px 6px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-primary);
}

.history-empty {
  font-size: 11.5px;
  color: var(--text-muted);
  text-align: center;
  padding: 8px 0;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 140px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 7px;
  background: var(--surface-overlay);
  border: 1px solid var(--border-subtle);
}

.history-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.history-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
}

.history-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.history-dur {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--tide);
}

.history-dist {
  font-size: 10px;
  color: var(--warning);
}

.history-del-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.history-del-btn:hover {
  color: var(--danger, #ef4444);
  background: color-mix(in srgb, var(--danger, #ef4444) 14%, transparent);
}

.breathing-cue-pill {
  margin-top: 6px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 32%, transparent);
}

.focus-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}

.control-btn {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: 12.5px;
  font-weight: 600;
  padding: 8px 13px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s var(--motion-normal);
}

.control-btn:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.primary-control {
  background: var(--tide);
  color: var(--ink-on-accent);
  border-color: var(--tide);
  padding: 8px 18px;
  box-shadow: var(--cta-shadow);
}

.primary-control.running {
  background: var(--warning);
  color: var(--ink-on-warning, #07080a);
  border-color: var(--warning);
  box-shadow: 0 4px 16px -4px color-mix(in srgb, var(--warning) 48%, transparent);
}

.focus-foot {
  width: 100%;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.complete-btn {
  width: 100%;
  background: color-mix(in srgb, var(--success) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
  color: var(--success);
  font-size: 12.5px;
  font-weight: 600;
  padding: 9px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s var(--motion-normal);
}

.complete-btn:hover {
  background: color-mix(in srgb, var(--success) 25%, transparent);
}

.mood-reflection-bar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--success) 10%, var(--bg-surface));
  border: 1px solid color-mix(in srgb, var(--success) 28%, transparent);
}

.mood-prompt {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}

.mood-chips {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mood-chip-btn {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-overlay);
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}

.mood-chip-btn:hover {
  border-color: var(--accent-border);
  color: var(--tide);
}

.task-est-pill {
  border-color: color-mix(in srgb, var(--tide) 36%, transparent);
}

.history-mood {
  font-size: 11px;
}

.focus-shortcut-legend {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.72;
  letter-spacing: 0.02em;
}
</style>
