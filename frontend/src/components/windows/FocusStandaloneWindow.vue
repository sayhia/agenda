<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Events } from '@wailsio/runtime';
import {
  CloseDesktopWindow,
  GetDesktopRuntimeStatus,
  GetReminders,
  OpenDesktopWindow,
  ResizeDesktopWindow,
  SetDesktopWindowAlwaysOnTop,
  UpdateReminder,
  UpdateSubtasks,
} from '../../../bindings/agenda/internal/agenda/agendaservice';
import type { Reminder } from '../../../bindings/agenda/internal/agenda/models';
import { parseReminderSubtasks, toUpdateReminderRequest } from '../../domain/reminder';
import { AMBIENT_SOUND_OPTIONS, type AmbientSound } from '../../utils/audio';
import { FOCUS_VIEW_FORMS } from '../../utils/focus';
import {
  bindFocusReminder,
  breakBreathingCue,
  claimFocusOwnership,
  completeCurrentTaskAndClearFocus,
  cycleFocusViewForm,
  extendFocusTimer,
  focusDisplayClock,
  focusEngineState,
  focusProgressPercent,
  focusThemeAura,
  getAmbientLabel,
  initFocusEngine,
  isFinalMinuteSprint,
  recordFocusDistraction,
  resetFocusTimer,
  setFocusAmbientSound,
  setFocusIntention,
  skipToNextFocusPhase,
  stopFocusEngine,
  switchFocusMode,
  toggleFocusTimer,
} from '../../utils/focusEngine';
import DesktopIcon from '../DesktopIcon.vue';
import FocusEffectCanvas from '../FocusEffectCanvas.vue';
import FocusStageView from '../FocusStageView.vue';
import ToastNotice from '../ToastNotice.vue';

const reminders = ref<Reminder[]>([]);
const alwaysOnTop = ref(true);
const isMiniHud = ref(false);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform);

const toastVisible = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error' | 'info'>('info');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribeEvents: Array<() => void> = [];

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  clearTimeout(toastTimer);
  toastMessage.value = msg;
  toastType.value = type;
  toastVisible.value = true;
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2600);
}

const activeReminders = computed(() =>
  reminders.value.filter((r) => r.status === 'active').slice(0, 20),
);

const boundReminder = computed(() =>
  focusEngineState.reminderId
    ? reminders.value.find((r) => r.id === focusEngineState.reminderId) || null
    : null,
);

const boundSubtasks = computed(() =>
  boundReminder.value ? parseReminderSubtasks(boundReminder.value.subtasks) : [],
);

const phaseLabel = computed(() => {
  if (focusEngineState.mode === 'shortBreak') return '短时小憩';
  if (focusEngineState.mode === 'longBreak') return '长程舒息';
  return '深度专注';
});

const currentViewFormName = computed(
  () => FOCUS_VIEW_FORMS.find((v) => v.id === focusEngineState.prefs.viewForm)?.name || '全息表盘',
);

async function loadReminders() {
  try {
    reminders.value = (await GetReminders()) || [];
  } catch {
    // Ignore transient load failures.
  }
}

async function syncDesktopStatus() {
  try {
    const status = await GetDesktopRuntimeStatus();
    const focusWin = status?.windows?.find((w) => w.kind === 'focus' || w.name === 'focus');
    if (focusWin && typeof focusWin.always_on_top === 'boolean') {
      alwaysOnTop.value = focusWin.always_on_top;
    }
  } catch {
    // Ignore transient status sync failures.
  }
}

async function toggleAlwaysOnTop() {
  const prev = alwaysOnTop.value;
  const next = !prev;
  alwaysOnTop.value = next;
  try {
    await SetDesktopWindowAlwaysOnTop('focus', next);
    showToast(next ? '已置顶于所有窗口上方' : '已取消窗口置顶', 'info');
  } catch (err: any) {
    alwaysOnTop.value = prev;
    showToast(`切换置顶失败: ${err?.message || err}`, 'error');
  }
}

async function toggleMiniHud() {
  const next = !isMiniHud.value;
  isMiniHud.value = next;
  await ResizeDesktopWindow('focus', next ? 340 : 440, next ? 166 : 620);
}

function handleTaskSelect(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  if (!id) {
    bindFocusReminder(null, true);
    return;
  }
  const found = reminders.value.find((r) => r.id === id) || null;
  bindFocusReminder(found, true);
}

async function toggleBoundSubtask(idx: number) {
  if (!boundReminder.value) return;
  const subs = parseReminderSubtasks(boundReminder.value.subtasks);
  if (!subs[idx]) return;
  subs[idx] = { ...subs[idx], done: !subs[idx].done };
  try {
    await UpdateSubtasks(boundReminder.value.id, JSON.stringify(subs));
    await loadReminders();
  } catch (err: any) {
    showToast(`更新子任务失败: ${err?.message || err}`, 'error');
  }
}

function cycleAmbient() {
  const idx = AMBIENT_SOUND_OPTIONS.findIndex((o) => o.id === focusEngineState.prefs.ambientSound);
  const next = AMBIENT_SOUND_OPTIONS[(idx + 1) % AMBIENT_SOUND_OPTIONS.length]?.id || 'none';
  setFocusAmbientSound(next as AmbientSound);
  showToast(`环境声景：${getAmbientLabel(next as AmbientSound)}`, 'info');
}

async function completeBoundTask() {
  const id = focusEngineState.reminderId;
  const target = reminders.value.find((r) => r.id === id);
  if (target) {
    try {
      await UpdateReminder(toUpdateReminderRequest(target, { status: 'ended' }));
      completeCurrentTaskAndClearFocus();
      await loadReminders();
      showToast(`已完成「${target.title}」并记录本次专注`, 'success');
    } catch (err: any) {
      showToast(`完成失败: ${err?.message || err}`, 'error');
    }
  }
}

function handleKeydown(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  const tag = el?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) {
    if (e.key === 'Escape') {
      el?.blur();
    }
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    toggleFocusTimer();
  } else if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    void toggleMiniHud();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (isMiniHud.value) {
      void toggleMiniHud();
    } else {
      void CloseDesktopWindow('focus');
    }
  }
}

onMounted(async () => {
  initFocusEngine(showToast);
  claimFocusOwnership();
  window.addEventListener('keydown', handleKeydown);
  await Promise.all([loadReminders(), syncDesktopStatus()]);
  unsubscribeEvents.push(
    Events.On('reminders-updated', () => { void loadReminders(); }),
    Events.On('desktop-status-updated', () => { void syncDesktopStatus(); }),
    Events.On('focus-bind-reminder', async (payload: any) => {
      const id = Array.isArray(payload?.data) ? payload.data[0] : (payload?.data ?? payload);
      await loadReminders();
      const found = reminders.value.find((r) => r.id === String(id || ''));
      if (found) {
        bindFocusReminder(found, true);
        claimFocusOwnership();
      }
    }),
  );
});

onUnmounted(() => {
  clearTimeout(toastTimer);
  window.removeEventListener('keydown', handleKeydown);
  unsubscribeEvents.splice(0).forEach((u) => u());
  stopFocusEngine();
});
</script>

<template>
  <div class="focus-win-shell" :class="{ 'is-mac': isMac, running: focusEngineState.isRunning, 'is-mini': isMiniHud }">
    <FocusEffectCanvas
      class="focus-win-canvas"
      :active="!isMiniHud"
      :running="focusEngineState.isRunning"
      :mode="focusEngineState.mode"
      :effectStyle="focusThemeAura.effectStyle"
      :dialHudStyle="focusThemeAura.dialHudStyle"
      :showDialHud="!isMiniHud && focusEngineState.prefs.viewForm === 'dial'"
      :fxEnabled="!isMiniHud && focusEngineState.prefs.fxEnabled"
      :completionSignal="focusEngineState.lastCompletionAt"
      :startSignal="focusEngineState.lastStartPulseAt"
      :sprintActive="isFinalMinuteSprint"
      :zenActive="focusEngineState.zenMode"
      :secondsLeft="focusEngineState.secondsLeft"
    />

    <header class="focus-win-header">
      <div class="focus-win-title">
        <strong>{{ isMiniHud ? phaseLabel : '番茄专注浮窗' }}</strong>
        <span class="today-pill tabular-nums">今日 {{ focusEngineState.stats.todayMinutes }}m</span>
      </div>
      <div class="focus-win-actions">
        <button
          v-if="!isMiniHud"
          type="button"
          class="win-tool-btn"
          :title="`切换计时形式（当前：${currentViewFormName}）`"
          @click="cycleFocusViewForm"
        >
          {{ currentViewFormName }}
        </button>
        <button
          type="button"
          class="win-tool-btn"
          :class="{ active: isMiniHud }"
          :title="isMiniHud ? '展开完整专注舞台' : '收起为极简悬浮条'"
          @click="toggleMiniHud"
        >
          <DesktopIcon :name="isMiniHud ? 'maximize' : 'minimize'" :size="11" />
          <span>{{ isMiniHud ? '展开' : '极简' }}</span>
        </button>
        <button
          type="button"
          class="win-tool-btn"
          :class="{ active: alwaysOnTop }"
          :title="alwaysOnTop ? '已置顶（点击取消）' : '窗口置顶'"
          @click="toggleAlwaysOnTop"
        >
          <DesktopIcon name="pin" :size="12" />
        </button>
        <button
          type="button"
          class="win-tool-btn"
          title="回到主工作台"
          @click="OpenDesktopWindow('main', '')"
        >
          <DesktopIcon name="popout" :size="12" />
        </button>
        <button
          type="button"
          class="win-tool-btn"
          title="隐藏专注浮窗"
          @click="CloseDesktopWindow('focus')"
        >
          <DesktopIcon name="close" :size="12" />
        </button>
      </div>
    </header>

    <!-- Compact Mini-HUD Bar -->
    <main v-if="isMiniHud" class="mini-hud-main">
      <div class="mini-hud-top">
        <div class="mini-hud-clock tabular-nums">{{ focusDisplayClock }}</div>
        <div class="mini-hud-copy">
          <span class="mini-hud-task">{{ focusEngineState.reminderTitle || focusEngineState.intention || '自由沉浸专注' }}</span>
          <div class="mini-progress-track">
            <div class="mini-progress-fill" :style="{ width: `${focusProgressPercent}%` }"></div>
          </div>
        </div>
      </div>
      <div class="mini-hud-controls">
        <button type="button" class="ctrl-btn" title="重置" @click="resetFocusTimer">
          <DesktopIcon name="reset" :size="13" />
        </button>
        <button type="button" class="ctrl-btn" title="+5分钟" @click="extendFocusTimer(5)">+5m</button>
        <button type="button" class="ctrl-primary" @click="toggleFocusTimer">
          <DesktopIcon :name="focusEngineState.isRunning ? 'pause' : 'play'" :size="12" />
          <span>{{ focusEngineState.isRunning ? '暂停' : '开始' }}</span>
        </button>
        <button type="button" class="ctrl-btn" title="下一阶段" @click="skipToNextFocusPhase">
          <DesktopIcon name="skip" :size="13" />
        </button>
      </div>
    </main>

    <!-- Full Focus Stage -->
    <main v-else class="focus-win-main">
      <!-- Phase Switcher -->
      <div class="phase-tabs">
        <button
          type="button"
          class="phase-tab"
          :class="{ active: focusEngineState.mode === 'focus' }"
          @click="switchFocusMode('focus')"
        >
          专注 {{ focusEngineState.prefs.focusMinutes }}m
        </button>
        <button
          type="button"
          class="phase-tab"
          :class="{ active: focusEngineState.mode === 'shortBreak' }"
          @click="switchFocusMode('shortBreak')"
        >
          短休 {{ focusEngineState.prefs.shortBreakMinutes }}m
        </button>
        <button
          type="button"
          class="phase-tab"
          :class="{ active: focusEngineState.mode === 'longBreak' }"
          @click="switchFocusMode('longBreak')"
        >
          长休 {{ focusEngineState.prefs.longBreakMinutes }}m
        </button>
      </div>

      <!-- Stage Dial / Liquid / Hourglass / Flip / Lotus -->
      <div class="stage-wrap">
        <FocusStageView
          :viewForm="focusEngineState.prefs.viewForm"
          :displayClock="focusDisplayClock"
          :progressPercent="focusProgressPercent"
          :mode="focusEngineState.mode"
          :isRunning="focusEngineState.isRunning"
          :fxEnabled="focusEngineState.prefs.fxEnabled"
          :isSprint="isFinalMinuteSprint"
          :phaseLabel="phaseLabel"
          :intention="focusEngineState.intention"
          :breathingCue="breakBreathingCue"
        />
      </div>

      <!-- Intention & Distraction Row -->
      <div class="intention-row">
        <input
          type="text"
          class="intention-input"
          :value="focusEngineState.intention"
          placeholder="本轮专注意图（如：完成核心接口联调）"
          maxlength="120"
          @input="setFocusIntention(($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="distraction-btn tabular-nums"
          title="记录一次分心打断"
          @click="recordFocusDistraction(1)"
        >
          分心 {{ focusEngineState.distractions }}
        </button>
      </div>

      <!-- Bound Task Picker + Optional Subtasks -->
      <div class="task-bind-row">
        <select
          class="task-select"
          :value="focusEngineState.reminderId"
          aria-label="绑定专注日程"
          @change="handleTaskSelect"
        >
          <option value="">自由沉浸专注（不绑定具体日程）</option>
          <option v-for="r in activeReminders" :key="r.id" :value="r.id">
            {{ r.title }}
          </option>
        </select>
        <button
          v-if="focusEngineState.reminderId"
          type="button"
          class="complete-task-btn"
          title="标记绑定日程已完成并归档本段专注"
          @click="completeBoundTask"
        >
          <DesktopIcon name="check" :size="12" />
          <span>完成</span>
        </button>
      </div>

      <div v-if="boundSubtasks.length > 0" class="bound-subtasks">
        <label v-for="(sub, idx) in boundSubtasks" :key="idx" class="bound-sub-item">
          <input type="checkbox" :checked="sub.done" @change="toggleBoundSubtask(idx)" />
          <span :class="{ done: sub.done }">{{ sub.title }}</span>
        </label>
      </div>

      <!-- Primary Controls -->
      <div class="focus-controls">
        <button type="button" class="ctrl-btn" title="重置当前阶段" @click="resetFocusTimer">
          <DesktopIcon name="reset" :size="14" />
        </button>
        <button type="button" class="ctrl-btn" title="延长 5 分钟" @click="extendFocusTimer(5)">+5m</button>
        <button type="button" class="ctrl-primary" @click="toggleFocusTimer">
          <DesktopIcon :name="focusEngineState.isRunning ? 'pause' : 'play'" :size="12" />
          <span>{{ focusEngineState.isRunning ? '暂停' : '开始专注' }}</span>
        </button>
        <button type="button" class="ctrl-btn" title="切换至下一阶段" @click="skipToNextFocusPhase">
          <DesktopIcon name="skip" :size="14" />
        </button>
        <button
          type="button"
          class="ctrl-btn"
          :title="`环境声景：${getAmbientLabel(focusEngineState.prefs.ambientSound)}`"
          @click="cycleAmbient"
        >
          <DesktopIcon :name="focusEngineState.prefs.ambientSound === 'none' ? 'volume-off' : 'headphones'" :size="14" />
        </button>
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
.focus-win-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  color: var(--text-primary);
  overflow: hidden;
}

.focus-win-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.focus-win-header {
  position: relative;
  z-index: 2;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--app-bg) 72%, transparent);
  backdrop-filter: blur(12px);
  --wails-draggable: drag;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.focus-win-shell.is-mac .focus-win-header {
  padding-left: 78px;
}

.focus-win-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.focus-win-title strong {
  font-size: 12.5px;
  font-weight: 700;
}

.today-pill {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
}

.focus-win-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  --wails-draggable: no-drag;
  -webkit-app-region: no-drag;
}

.win-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  min-width: 24px;
  padding: 0 7px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.win-tool-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.win-tool-btn.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}

.mini-hud-main {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 10px 14px 12px;
}

.mini-hud-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mini-hud-clock {
  font-family: var(--font-mono);
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  flex-shrink: 0;
}

.mini-hud-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mini-hud-task {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mini-progress-track {
  height: 5px;
  border-radius: 999px;
  background: var(--fill-subtle);
  overflow: hidden;
}

.mini-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--tide);
  transition: width 0.35s linear;
}

.mini-hud-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.focus-win-main {
  position: relative;
  z-index: 2;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 14px;
  min-height: 0;
  gap: 8px;
}

.phase-tabs {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--surface-raised) 82%, transparent);
  gap: 2px;
}

.phase-tab {
  height: 26px;
  padding: 0 11px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.phase-tab.active {
  background: var(--accent-soft);
  color: var(--tide-text);
}

.stage-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 0;
}

.intention-row {
  width: 100%;
  display: flex;
  gap: 6px;
}

.intention-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--input-bg) 88%, transparent);
  color: var(--text-primary);
  font-size: 11.5px;
  outline: none;
}

.intention-input:focus {
  border-color: var(--accent-border);
}

.distraction-btn {
  height: 30px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.distraction-btn:hover {
  border-color: var(--border-strong);
  color: var(--warning);
}

.task-bind-row {
  width: 100%;
  display: flex;
  gap: 6px;
}

.task-select {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--input-bg) 88%, transparent);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.complete-task-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid color-mix(in srgb, var(--success) 45%, transparent);
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}

.bound-subtasks {
  width: 100%;
  max-height: 74px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 9px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--surface-raised) 82%, transparent);
}

.bound-sub-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}

.bound-sub-item span.done {
  text-decoration: line-through;
  color: var(--text-quaternary);
}

.focus-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  min-width: 34px;
  padding: 0 9px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--surface-raised) 85%, transparent);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.ctrl-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.ctrl-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 22px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--cta-bg);
  color: var(--cta-ink);
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
  box-shadow: var(--cta-shadow);
}
</style>
