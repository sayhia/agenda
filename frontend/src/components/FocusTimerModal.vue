<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { playFocusCompleteChime } from '../utils/audio';

const props = defineProps<{ visible: boolean; reminder: Reminder | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'complete-task', reminder: Reminder): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
}>();

const FOCUS_DURATION = 25 * 60;
const BREAK_DURATION = 5 * 60;
const STORAGE_KEY = 'agenda_focus_session';
const DAILY_FOCUS_KEY_PREFIX = 'agenda_focus_daily_';

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayFocusMinutes = ref(0);

function loadTodayFocusStats() {
  try {
    const raw = localStorage.getItem(`${DAILY_FOCUS_KEY_PREFIX}${getTodayKey()}`);
    todayFocusMinutes.value = raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    todayFocusMinutes.value = 0;
  }
}

function recordFocusSession(minutes: number) {
  loadTodayFocusStats();
  todayFocusMinutes.value += minutes;
  try {
    localStorage.setItem(`${DAILY_FOCUS_KEY_PREFIX}${getTodayKey()}`, String(todayFocusMinutes.value));
  } catch {
    // fallback
  }
}

const isBreak = ref(false);
const totalSeconds = computed(() => isBreak.value ? BREAK_DURATION : FOCUS_DURATION);
const secondsLeft = ref(FOCUS_DURATION);
const isRunning = ref(false);
const sessionReminderId = ref('');
let endAt: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const progress = computed(() => ((totalSeconds.value - secondsLeft.value) / totalSeconds.value) * 100);
const displayTime = computed(() => `${String(Math.floor(secondsLeft.value / 60)).padStart(2, '0')}:${String(secondsLeft.value % 60).padStart(2, '0')}`);

function persistSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    reminderId: sessionReminderId.value,
    isBreak: isBreak.value,
    secondsLeft: secondsLeft.value,
    isRunning: isRunning.value,
    endAt,
  }));
}

function clearTicker() {
  if (timer) clearInterval(timer);
  timer = null;
}

function tick() {
  if (!isRunning.value || !endAt) return;
  secondsLeft.value = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
  if (secondsLeft.value === 0) handleTimerComplete();
  else persistSession();
}

function ensureTicker() {
  clearTicker();
  timer = setInterval(tick, 500);
}

function startTimer() {
  if (secondsLeft.value <= 0) secondsLeft.value = totalSeconds.value;
  endAt = Date.now() + secondsLeft.value * 1000;
  isRunning.value = true;
  persistSession();
  ensureTicker();
}

function pauseTimer() {
  tick();
  isRunning.value = false;
  endAt = null;
  clearTicker();
  persistSession();
}

function toggleTimer() {
  if (isRunning.value) pauseTimer();
  else startTimer();
}

function resetTimer() {
  isRunning.value = false;
  endAt = null;
  clearTicker();
  secondsLeft.value = totalSeconds.value;
  persistSession();
}

function switchMode(toBreak: boolean) {
  isRunning.value = false;
  endAt = null;
  clearTicker();
  isBreak.value = toBreak;
  secondsLeft.value = totalSeconds.value;
  persistSession();
}

function handleTimerComplete() {
  isRunning.value = false;
  endAt = null;
  clearTicker();
  playFocusCompleteChime();
  if (!isBreak.value) {
    recordFocusSession(Math.round(totalSeconds.value / 60));
  }
  emit('toast', isBreak.value ? '休息结束，可以开始下一轮专注' : '专注时段结束，休息五分钟吧', isBreak.value ? 'info' : 'success');
  isBreak.value = !isBreak.value;
  secondsLeft.value = totalSeconds.value;
  persistSession();
}

function restoreSession() {
  loadTodayFocusStats();
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const requestedReminderId = props.reminder?.id || '';
    if (!session || (session.reminderId && requestedReminderId && session.reminderId !== requestedReminderId)) {
      sessionReminderId.value = requestedReminderId;
      resetTimer();
      return;
    }
    sessionReminderId.value = requestedReminderId || session.reminderId || '';
    isBreak.value = Boolean(session.isBreak);
    isRunning.value = Boolean(session.isRunning);
    endAt = Number.isFinite(session.endAt) ? session.endAt : null;
    secondsLeft.value = Number.isFinite(session.secondsLeft) ? Math.max(0, session.secondsLeft) : totalSeconds.value;
    if (isRunning.value && endAt) {
      tick();
      if (isRunning.value) ensureTicker();
    }
  } catch {
    resetTimer();
  }
}

function handleCompleteTask() {
  if (!props.reminder) return;
  localStorage.removeItem(STORAGE_KEY);
  emit('complete-task', props.reminder);
  emit('close');
}

watch(() => props.visible, (visible) => {
  if (visible) restoreSession();
});

onUnmounted(() => {
  clearTicker();
  if (isRunning.value) persistSession();
});
</script>

<template>
  <div v-if="visible" class="focus-overlay" @click.self="$emit('close')">
    <div class="focus-card st-reticle" role="dialog" aria-modal="true" aria-label="专注计时">
      <!-- Header -->
      <div class="focus-head">
        <div class="focus-badge" :class="{ 'is-break': isBreak, running: isRunning }">
          <span class="mode-dot"></span>
          <span>{{ isBreak ? 'REST SESSION · 5M BREAK' : 'DEEP FOCUS · 25M POMODORO' }}</span>
        </div>
        <div class="focus-head-right">
          <span v-if="todayFocusMinutes > 0" class="daily-focus-chip">今日 {{ todayFocusMinutes }}m</span>
          <button class="icon-btn close-btn" title="退出专注模式" @click="$emit('close')">✕</button>
        </div>
      </div>

      <!-- Current Task Banner -->
      <div class="task-info">
        <h3 class="task-title">{{ reminder?.title || '未关联具体任务' }}</h3>
        <p v-if="reminder?.notes" class="task-notes">{{ reminder.notes }}</p>
      </div>

      <!-- Scrolltide Telemetry Segmented Dial -->
      <div class="timer-dial-wrap" :class="{ running: isRunning, break: isBreak }">
        <svg class="timer-svg" width="260" height="260" viewBox="0 0 260 260" aria-hidden="true">
          <!-- Outer hair-tick dial markers (Scrolltide Tuner vibe) -->
          <g class="dial-ticks">
            <line
              v-for="tick in 60"
              :key="tick"
              :x1="130 + Math.cos(((tick * 6 - 90) * Math.PI) / 180) * (tick % 5 === 0 ? 119 : 122)"
              :y1="130 + Math.sin(((tick * 6 - 90) * Math.PI) / 180) * (tick % 5 === 0 ? 119 : 122)"
              :x2="130 + Math.cos(((tick * 6 - 90) * Math.PI) / 180) * 126"
              :y2="130 + Math.sin(((tick * 6 - 90) * Math.PI) / 180) * 126"
              :stroke-width="tick % 5 === 0 ? 1.5 : 0.8"
              :opacity="tick % 5 === 0 ? 0.45 : 0.2"
              stroke="currentColor"
            />
          </g>
          <circle
            class="timer-circle-bg"
            cx="130"
            cy="130"
            r="106"
            fill="none"
            stroke="var(--border-strong)"
            stroke-width="8"
          />
          <circle
            class="timer-circle-progress"
            :class="{ 'break-stroke': isBreak }"
            cx="130"
            cy="130"
            r="106"
            fill="none"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="2 * Math.PI * 106"
            :stroke-dashoffset="2 * Math.PI * 106 * (1 - progress / 100)"
            transform="rotate(-90 130 130)"
          />
        </svg>

        <div class="timer-center-text">
          <span class="timer-digits tabular-nums">{{ displayTime }}</span>
          <span class="timer-phase">{{ isBreak ? 'REST MODE' : 'T-MINUS FOCUS' }}</span>
        </div>
      </div>

      <!-- Controls -->
      <div class="focus-controls">
        <button class="control-btn primary-control" :class="{ running: isRunning }" @click="toggleTimer">
          {{ isRunning ? '暂停 ❚❚' : '开始专注 ▶' }}
        </button>
        <button class="control-btn" @click="resetTimer">重置 ↺</button>
        <button class="control-btn" @click="switchMode(!isBreak)">
          {{ isBreak ? '切换专注' : '切换小憩' }}
        </button>
      </div>

      <!-- Quick Complete Button -->
      <div v-if="reminder && reminder.status !== 'ended'" class="focus-foot">
        <button class="complete-btn" @click="handleCompleteTask">
          ✓ 任务已搞定，标记为完成
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.focus-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.focus-card {
  position: relative;
  width: 470px;
  max-width: 90vw;
  background:
    radial-gradient(65% 55% at 50% 0%, color-mix(in srgb, var(--tide) 13%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 22px;
  padding: 26px 28px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  animation: focus-scale 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes focus-scale {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}

.focus-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.focus-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.daily-focus-chip {
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lime) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--lime) 35%, transparent);
  color: var(--lime-strong);
  font: 700 9px var(--font-mono);
  letter-spacing: 0.05em;
}

.focus-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--tide-text);
  font: 700 9.5px var(--font-mono);
  letter-spacing: 0.12em;
}

.focus-badge.is-break {
  background: color-mix(in srgb, var(--success) 14%, transparent);
  border-color: color-mix(in srgb, var(--success) 35%, transparent);
  color: var(--success);
}

.dial-ticks {
  color: var(--text-quaternary);
}

.timer-dial-wrap.running::before {
  content: "";
  position: absolute;
  inset: 20px;
  border-radius: 50%;
  background:
    conic-gradient(from 0deg, color-mix(in srgb, var(--tide) 22%, transparent), transparent 38%, color-mix(in srgb, var(--lime) 16%, transparent) 66%, transparent 92%),
    radial-gradient(circle, color-mix(in srgb, var(--tide) 14%, transparent), transparent 65%);
  animation: focus-aura-spin 7s linear infinite;
  pointer-events: none;
}

.timer-dial-wrap.running.break::before {
  background:
    conic-gradient(from 0deg, rgba(0, 210, 148, 0.22), transparent 55%, rgba(70, 183, 255, 0.14) 85%, transparent),
    radial-gradient(circle, rgba(0, 210, 148, 0.14), transparent 65%);
}

@keyframes focus-aura-spin {
  to { transform: rotate(360deg); }
}

.mode-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
}

.task-info {
  text-align: center;
  max-width: 90%;
}

.task-title {
  font-size: 18px;
  font-weight: 750;
  color: var(--text-primary);
  line-height: 1.4;
}

.task-notes {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timer-dial-wrap {
  position: relative;
  width: 260px;
  height: 260px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.timer-circle-progress {
  stroke: var(--tide, #46b7ff);
  transition: stroke-dashoffset 0.4s ease;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--tide, #46b7ff) 55%, transparent));
}

.timer-circle-progress.break-stroke {
  stroke: var(--success, #00d294);
  filter: drop-shadow(0 0 10px rgba(0, 210, 148, 0.5));
}

.timer-center-text {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.timer-digits {
  font-size: 48px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.timer-phase {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--text-muted);
}

.focus-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.control-btn {
  padding: 9px 18px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 650;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.18s ease;
}

.control-btn:hover {
  background: var(--fill-hover);
  border-color: var(--border-strong);
}

.primary-control {
  background: var(--cta-bg);
  color: var(--cta-ink);
  border-color: transparent;
  font-weight: 700;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}

.primary-control:hover {
  background: var(--cta-bg-hover);
  transform: translateY(-1px);
}

.primary-control.running {
  background: var(--lime);
  color: var(--ink-on-lime);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--lime) 38%, transparent);
}

.focus-foot {
  margin-top: 4px;
}

.complete-btn {
  font-size: 12px;
  font-weight: 600;
  padding: 7px 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
  color: var(--success);
  cursor: pointer;
  transition: all 0.18s ease;
}

.complete-btn:hover {
  background: color-mix(in srgb, var(--success) 22%, transparent);
  transform: translateY(-1px);
}
</style>
