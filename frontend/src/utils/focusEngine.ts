import { computed, reactive } from 'vue';
import { Events } from '@wailsio/runtime';
import { SendDesktopNotification, UpdateFocusTrayStatus } from '../../bindings/agenda/internal/agenda/agendaservice';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import {
  AMBIENT_SOUND_OPTIONS,
  isAmbientPreviewActive,
  playFocusCompleteChime,
  playFocusDistractionSound,
  playFocusPauseSound,
  playFocusStartSound,
  playFocusTickSound,
  previewAmbientSound,
  setAmbientVolume,
  startAmbientSound,
  stopAmbientPreviewIfIdle,
  stopAmbientSound,
  type AmbientSound,
} from './audio';
import {
  FOCUS_DIAL_HUD_OPTIONS,
  FOCUS_EFFECT_OPTIONS,
  FOCUS_HISTORY_STORAGE_KEY,
  FOCUS_PREFS_STORAGE_KEY,
  FOCUS_SESSION_STORAGE_KEY,
  FOCUS_VIEW_FORMS,
  buildReminderFocusMap,
  clearFocusSession,
  computeRemainingSeconds,
  deleteFocusHistoryEntry,
  formatFocusClock,
  getBreathingCue,
  getFocusModeBreakdown,
  getFocusStatsOverview,
  getFocusThemeAura,
  getModeDurationMinutes,
  getRecommendedAmbientForTheme,
  loadFocusPreferences,
  loadFocusSession,
  recordFocusHistoryEntry,
  resetFocusPreferences,
  resolveNextPhase,
  saveFocusPreferences,
  saveFocusSession,
  sendFocusPhaseNotification,
  tagFocusHistoryEntryMood,
  type FocusDialHudOverride,
  type FocusEffectOverride,
  type FocusPhaseMode,
  type FocusPreferences,
  type FocusSessionMood,
  type FocusStatsOverview,
  type FocusViewForm,
} from './focus';
import { THEME_STORAGE_KEY, normalizeThemeId } from './themes';

export type FocusToastNotifier = (message: string, type: 'success' | 'error' | 'info') => void;

interface EngineState {
  initialized: boolean;
  prefs: FocusPreferences;
  stats: FocusStatsOverview;
  reminderId: string;
  reminderTitle: string;
  mode: FocusPhaseMode;
  durationMinutes: number;
  phaseTotalSeconds: number;
  secondsLeft: number;
  isRunning: boolean;
  endAt: number | null;
  startedAt: number | null;
  completedRoundsInCycle: number;
  intention: string;
  distractions: number;
  zenMode: boolean;
  pendingTaskCandidate: Reminder | null;
  activeThemeId: string;
  themeVersion: number;
  historyVersion: number;
  lastCompletionAt: number;
  lastCompletionMode: FocusPhaseMode;
  lastCompletedEntryId: string;
  lastStartPulseAt: number;
  floatingWidgetDismissed: boolean;
}

const initialPrefs = loadFocusPreferences();
const initialDuration = initialPrefs.focusMinutes;

function readDocumentThemeId(): string {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return normalizeThemeId(attr);
  }
  try {
    if (typeof localStorage !== 'undefined') {
      return normalizeThemeId(localStorage.getItem(THEME_STORAGE_KEY));
    }
  } catch {
    // Ignore storage read errors.
  }
  return 'midnight';
}

const state = reactive<EngineState>({
  initialized: false,
  prefs: initialPrefs,
  stats: getFocusStatsOverview(),
  reminderId: '',
  reminderTitle: '',
  mode: 'focus',
  durationMinutes: initialDuration,
  phaseTotalSeconds: initialDuration * 60,
  secondsLeft: initialDuration * 60,
  isRunning: false,
  endAt: null,
  startedAt: null,
  completedRoundsInCycle: 0,
  intention: '',
  distractions: 0,
  zenMode: false,
  pendingTaskCandidate: null,
  activeThemeId: readDocumentThemeId(),
  themeVersion: 0,
  historyVersion: 0,
  lastCompletionAt: 0,
  lastCompletionMode: 'focus',
  lastCompletedEntryId: '',
  lastStartPulseAt: 0,
  floatingWidgetDismissed: false,
});

let tickerHandle: ReturnType<typeof setInterval> | null = null;
let toastNotifier: FocusToastNotifier | null = null;
let lastTickSecondSound = -1;
let unsubscribeFocusSyncEvent: (() => void) | null = null;
let unsubscribeFocusCommandEvent: (() => void) | null = null;
let lastTraySyncKey = '';
const FOCUS_OWNER_KEY = 'agenda_focus_owner_v1';
const FOCUS_OWNER_TTL_MS = 2500;
const ENGINE_INSTANCE_ID = `win-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
const BASE_DOCUMENT_TITLE = typeof document !== 'undefined' && document.title ? document.title : 'Agenda';

function readFocusOwner(): { id: string; updatedAt: number } | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(FOCUS_OWNER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string' && typeof parsed.updatedAt === 'number') {
      return parsed;
    }
  } catch {
    // Ignore storage read errors.
  }
  return null;
}

export function claimFocusOwnership(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(FOCUS_OWNER_KEY, JSON.stringify({ id: ENGINE_INSTANCE_ID, updatedAt: Date.now() }));
  } catch {
    // Ignore storage write errors.
  }
}

function releaseFocusOwnership(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const owner = readFocusOwner();
    if (owner && owner.id === ENGINE_INSTANCE_ID) {
      localStorage.removeItem(FOCUS_OWNER_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}

function isFocusOwner(): boolean {
  const owner = readFocusOwner();
  if (!owner) return true;
  if (owner.id === ENGINE_INSTANCE_ID) return true;
  return Date.now() - owner.updatedAt > FOCUS_OWNER_TTL_MS;
}

function syncTrayFocusStatus(force = false): void {
  const clock = formatFocusClock(state.secondsLeft);
  const hasLive = state.isRunning || (state.secondsLeft > 0 && state.secondsLeft < state.phaseTotalSeconds);
  const trayClock = hasLive ? clock : '';
  const key = `${state.isRunning}|${state.mode}|${trayClock}|${state.reminderTitle}`;
  if (!force && key === lastTraySyncKey) return;
  lastTraySyncKey = key;
  try {
    void UpdateFocusTrayStatus(state.isRunning, state.mode, trayClock, state.reminderTitle || '');
  } catch {
    // Ignore outside Wails runtime (e.g. unit tests / browser preview).
  }
}

function broadcastFocusSync(): void {
  try {
    void Events.Emit('focus-state-sync', ENGINE_INSTANCE_ID);
  } catch {
    // Ignore outside Wails runtime.
  }
}

function syncFromExternalSession(): void {
  state.prefs = loadFocusPreferences();
  state.stats = getFocusStatsOverview();
  state.historyVersion += 1;
  const saved = loadFocusSession(state.prefs);
  if (!saved) {
    state.isRunning = false;
    state.endAt = null;
    state.startedAt = null;
    state.reminderId = '';
    state.reminderTitle = '';
    state.intention = '';
    state.distractions = 0;
    const m = getModeDurationMinutes(state.mode, state.prefs);
    state.durationMinutes = m;
    state.phaseTotalSeconds = m * 60;
    state.secondsLeft = state.phaseTotalSeconds;
    stopTicker();
    stopAmbientSound();
    syncDocumentTitle();
    return;
  }
  state.reminderId = saved.reminderId;
  state.reminderTitle = saved.reminderTitle;
  state.mode = saved.mode;
  state.durationMinutes = saved.durationMinutes;
  state.phaseTotalSeconds = saved.phaseTotalSeconds;
  state.isRunning = saved.isRunning;
  state.endAt = saved.endAt;
  state.startedAt = saved.startedAt;
  state.completedRoundsInCycle = saved.completedRoundsInCycle;
  state.intention = saved.intention;
  state.distractions = saved.distractions;
  if (saved.isRunning && saved.endAt) {
    state.secondsLeft = computeRemainingSeconds(saved.endAt);
    ensureTicker();
  } else {
    state.secondsLeft = saved.secondsLeft;
    stopTicker();
    stopAmbientSound();
  }
  syncDocumentTitle();
}

function handleCrossWindowStorage(e: StorageEvent): void {
  if (!e.key) return;
  if (
    e.key === FOCUS_SESSION_STORAGE_KEY ||
    e.key === FOCUS_PREFS_STORAGE_KEY ||
    e.key === FOCUS_HISTORY_STORAGE_KEY
  ) {
    syncFromExternalSession();
  }
}

function syncDocumentTitle(): void {
  if (typeof document === 'undefined') return;
  if (state.isRunning) {
    const modeLabel =
      state.mode === 'focus' ? '专注' : state.mode === 'longBreak' ? '长休' : '小憩';
    document.title = `[${formatFocusClock(state.secondsLeft)}] ${modeLabel} · ${BASE_DOCUMENT_TITLE}`;
  } else {
    document.title = BASE_DOCUMENT_TITLE;
  }
}

function persistCurrentSession(broadcast = true): void {
  saveFocusSession({
    reminderId: state.reminderId,
    reminderTitle: state.reminderTitle,
    mode: state.mode,
    durationMinutes: state.durationMinutes,
    phaseTotalSeconds: state.phaseTotalSeconds,
    secondsLeft: state.secondsLeft,
    isRunning: state.isRunning,
    endAt: state.endAt,
    startedAt: state.startedAt,
    completedRoundsInCycle: state.completedRoundsInCycle,
    intention: state.intention,
    distractions: state.distractions,
    updatedAt: Date.now(),
  });
  if (broadcast) {
    claimFocusOwnership();
    broadcastFocusSync();
    syncTrayFocusStatus();
  }
}

function stopTicker(): void {
  if (tickerHandle) {
    clearInterval(tickerHandle);
    tickerHandle = null;
  }
}

let lastNonNoneAmbient: AmbientSound =
  initialPrefs.ambientSound && initialPrefs.ambientSound !== 'none'
    ? (initialPrefs.ambientSound as AmbientSound)
    : 'stream';

function syncAmbientPlayback(allowIdlePreview = false): void {
  if (!isFocusOwner()) {
    stopAmbientSound();
    return;
  }
  if (state.prefs.ambientSound !== 'none') {
    lastNonNoneAmbient = state.prefs.ambientSound as AmbientSound;
  }
  if (state.isRunning && state.prefs.ambientSound !== 'none') {
    startAmbientSound(state.prefs.ambientSound as AmbientSound, state.prefs.ambientVolume);
  } else if (allowIdlePreview && !state.isRunning && state.prefs.ambientSound !== 'none') {
    previewAmbientSound(state.prefs.ambientSound as AmbientSound, state.prefs.ambientVolume);
  } else {
    stopAmbientSound();
  }
}

function handlePhaseComplete(): void {
  if (!isFocusOwner()) {
    // Let the active owner handle completion, chime, and history recording.
    return;
  }
  claimFocusOwnership();
  const finishedMode = state.mode;
  const finishedMinutes = Math.max(1, Math.round(state.phaseTotalSeconds / 60));
  const finishedTitle = state.reminderTitle;

  state.isRunning = false;
  state.endAt = null;
  state.startedAt = null;
  state.lastCompletionAt = Date.now();
  state.lastCompletionMode = finishedMode;
  stopTicker();

  playFocusCompleteChime(finishedMode);
  const recordedEntry = recordFocusHistoryEntry({
    mode: finishedMode,
    durationMinutes: finishedMinutes,
    reminderId: state.reminderId,
    reminderTitle: finishedTitle,
    intention: state.intention,
    distractions: finishedMode === 'focus' ? state.distractions : 0,
  });
  if (finishedMode === 'focus') {
    state.lastCompletedEntryId = recordedEntry.id;
  }

  if (state.prefs.desktopNotifyEnabled) {
    const heading = finishedMode === 'focus' ? '专注时段已完成' : '休息结束，准备下一轮专注';
    const body = finishedTitle ? `任务：${finishedTitle}` : '点击返回 Agenda 查看节奏';
    void SendDesktopNotification(heading, body).catch(() => {
      sendFocusPhaseNotification(finishedMode, finishedTitle);
    });
  }

  const transition = resolveNextPhase(finishedMode, state.completedRoundsInCycle, state.prefs);
  state.mode = transition.nextMode;
  state.completedRoundsInCycle = transition.nextRoundsInCycle;
  state.durationMinutes = transition.durationMinutes;
  state.phaseTotalSeconds = transition.durationMinutes * 60;
  state.secondsLeft = state.phaseTotalSeconds;
  if (finishedMode === 'focus') {
    state.distractions = 0;
  }

  state.stats = getFocusStatsOverview();
  state.historyVersion += 1;

  const notice =
    finishedMode === 'focus'
      ? transition.nextMode === 'longBreak'
        ? `完成第 ${state.prefs.longBreakInterval} 轮专注（+${finishedMinutes}m），进入 ${transition.durationMinutes}m 长休`
        : `完成本轮专注（+${finishedMinutes}m），进入 ${transition.durationMinutes}m 小憩`
      : '休息结束，准备好开启下一轮专注';
  toastNotifier?.(notice, finishedMode === 'focus' ? 'success' : 'info');

  if (transition.shouldAutoStart) {
    startFocusTimer(false);
  } else {
    state.zenMode = false;
    stopAmbientSound();
    persistCurrentSession();
    syncDocumentTitle();
    syncTrayFocusStatus(true);
  }
}

function tick(): void {
  if (!state.isRunning || !state.endAt) return;
  const remaining = computeRemainingSeconds(state.endAt);
  const owner = isFocusOwner();
  if (remaining !== state.secondsLeft) {
    state.secondsLeft = remaining;
    if (owner && state.prefs.tickSoundEnabled && remaining > 0 && remaining !== lastTickSecondSound) {
      lastTickSecondSound = remaining;
      playFocusTickSound(remaining);
    }
    syncDocumentTitle();
    if (owner) {
      syncTrayFocusStatus();
    }
  }
  if (remaining <= 0) {
    handlePhaseComplete();
  } else if (owner) {
    claimFocusOwnership();
    saveFocusSession({
      reminderId: state.reminderId,
      reminderTitle: state.reminderTitle,
      mode: state.mode,
      durationMinutes: state.durationMinutes,
      phaseTotalSeconds: state.phaseTotalSeconds,
      secondsLeft: state.secondsLeft,
      isRunning: state.isRunning,
      endAt: state.endAt,
      startedAt: state.startedAt,
      completedRoundsInCycle: state.completedRoundsInCycle,
      intention: state.intention,
      distractions: state.distractions,
      updatedAt: Date.now(),
    });
  }
}

function ensureTicker(): void {
  stopTicker();
  tickerHandle = setInterval(tick, 400);
}

function handleThemeEventChange(): void {
  const nextThemeId = readDocumentThemeId();
  state.activeThemeId = nextThemeId;
  state.themeVersion += 1;
  if (state.prefs.ambientFollowTheme) {
    const rec = getRecommendedAmbientForTheme(nextThemeId);
    if (rec !== state.prefs.ambientSound) {
      state.prefs = saveFocusPreferences({ ambientSound: rec });
      syncAmbientPlayback();
    }
  }
}

function handleVisibilityReconcile(): void {
  if (typeof document !== 'undefined' && !document.hidden && state.isRunning) {
    tick();
  }
}

/** Initializes the global focus engine once on app mount and resumes running timers cleanly. */
export function initFocusEngine(notifier?: FocusToastNotifier): void {
  if (notifier) toastNotifier = notifier;
  if (state.initialized) return;
  state.initialized = true;
  state.prefs = loadFocusPreferences();
  state.stats = getFocusStatsOverview();
  state.historyVersion += 1;
  state.activeThemeId = readDocumentThemeId();

  if (typeof window !== 'undefined') {
    window.addEventListener('agenda:theme-change', handleThemeEventChange);
    window.addEventListener('agenda:custom-accent-change', handleThemeEventChange);
    window.addEventListener('storage', handleCrossWindowStorage);
    window.addEventListener('beforeunload', releaseFocusOwnership);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityReconcile);
  }
  try {
    unsubscribeFocusSyncEvent = Events.On('focus-state-sync', (payload: any) => {
      const sender = Array.isArray(payload?.data) ? payload.data[0] : (payload?.data ?? payload);
      if (sender !== ENGINE_INSTANCE_ID) {
        syncFromExternalSession();
      }
    });
    unsubscribeFocusCommandEvent = Events.On('focus-command', (payload: any) => {
      if (!isFocusOwner()) return;
      const cmd = String(Array.isArray(payload?.data) ? payload.data[0] : (payload?.data ?? payload) || '');
      if (cmd === 'toggle') toggleFocusTimer();
      else if (cmd === 'skip') skipToNextFocusPhase();
      else if (cmd === 'reset') resetFocusTimer();
    });
  } catch {
    // Ignore outside Wails runtime.
  }

  const saved = loadFocusSession(state.prefs);
  if (saved) {
    state.reminderId = saved.reminderId;
    state.reminderTitle = saved.reminderTitle;
    state.mode = saved.mode;
    state.durationMinutes = saved.durationMinutes;
    state.phaseTotalSeconds = saved.phaseTotalSeconds;
    state.secondsLeft = saved.secondsLeft;
    state.isRunning = saved.isRunning;
    state.endAt = saved.endAt;
    state.startedAt = saved.startedAt;
    state.completedRoundsInCycle = saved.completedRoundsInCycle;
    state.intention = saved.intention;
    state.distractions = saved.distractions;

    if (state.isRunning && state.endAt) {
      const remaining = computeRemainingSeconds(state.endAt);
      state.secondsLeft = remaining;
      if (remaining <= 0) {
        handlePhaseComplete();
      } else {
        ensureTicker();
        syncDocumentTitle();
        if (isFocusOwner()) {
          syncTrayFocusStatus(true);
        }
      }
    }
  }
}

export function setFocusToastNotifier(notifier: FocusToastNotifier | null): void {
  toastNotifier = notifier;
}

export function refreshFocusStats(): void {
  state.stats = getFocusStatsOverview();
  state.historyVersion += 1;
}

export function addManualFocusEntry(
  durationMinutes: number,
  reminderId?: string,
  reminderTitle?: string,
  intention?: string,
): void {
  recordFocusHistoryEntry({
    mode: 'focus',
    durationMinutes,
    reminderId: reminderId ?? state.reminderId,
    reminderTitle: reminderTitle ?? state.reminderTitle,
    intention: intention ?? state.intention,
    distractions: 0,
  });
  refreshFocusStats();
}

export function removeFocusHistoryEntry(entryId: string): boolean {
  const removed = deleteFocusHistoryEntry(entryId);
  if (removed) refreshFocusStats();
  return removed;
}

export function startFocusTimer(playCue: boolean = true): void {
  if (state.secondsLeft <= 0) {
    state.secondsLeft = state.phaseTotalSeconds;
  }
  if (!state.startedAt) {
    state.startedAt = Date.now();
  }
  state.endAt = Date.now() + state.secondsLeft * 1000;
  state.isRunning = true;
  state.lastStartPulseAt = Date.now();
  state.lastCompletedEntryId = '';
  state.floatingWidgetDismissed = false;
  if (state.prefs.zenModeOnRun && state.mode === 'focus') {
    state.zenMode = true;
  }
  if (playCue) {
    playFocusStartSound(state.mode);
  }
  syncAmbientPlayback();
  persistCurrentSession();
  syncDocumentTitle();
  ensureTicker();
}

export function pauseFocusTimer(): void {
  if (state.isRunning && state.endAt) {
    state.secondsLeft = computeRemainingSeconds(state.endAt);
  }
  const wasRunning = state.isRunning;
  state.isRunning = false;
  state.endAt = null;
  stopTicker();
  stopAmbientSound();
  if (wasRunning) {
    playFocusPauseSound();
  }
  persistCurrentSession();
  syncDocumentTitle();
}

export function toggleFocusTimer(): void {
  if (state.isRunning) pauseFocusTimer();
  else startFocusTimer();
}

export function resetFocusTimer(): void {
  state.isRunning = false;
  state.endAt = null;
  state.startedAt = null;
  state.zenMode = false;
  stopTicker();
  stopAmbientSound();
  const minutes = getModeDurationMinutes(state.mode, state.prefs);
  state.durationMinutes = minutes;
  state.phaseTotalSeconds = minutes * 60;
  state.secondsLeft = state.phaseTotalSeconds;
  state.distractions = 0;
  persistCurrentSession();
  syncDocumentTitle();
}

export function switchFocusMode(nextMode: FocusPhaseMode): void {
  state.isRunning = false;
  state.endAt = null;
  state.startedAt = null;
  state.zenMode = false;
  stopTicker();
  stopAmbientSound();
  state.mode = nextMode;
  const minutes = getModeDurationMinutes(nextMode, state.prefs);
  state.durationMinutes = minutes;
  state.phaseTotalSeconds = minutes * 60;
  state.secondsLeft = state.phaseTotalSeconds;
  persistCurrentSession();
  syncDocumentTitle();
}

export function applyCustomDuration(minutes: number): void {
  const clamped = Math.max(1, Math.min(180, Math.round(minutes)));
  if (state.mode === 'focus') {
    updateFocusPreferences({ focusMinutes: clamped });
  } else if (state.mode === 'shortBreak') {
    updateFocusPreferences({ shortBreakMinutes: clamped });
  } else {
    updateFocusPreferences({ longBreakMinutes: clamped });
  }
  state.durationMinutes = clamped;
  if (!state.isRunning) {
    state.phaseTotalSeconds = clamped * 60;
    state.secondsLeft = state.phaseTotalSeconds;
    persistCurrentSession();
    syncDocumentTitle();
  }
}

export function applyFocusPreset(preset: {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
}): void {
  updateFocusPreferences({
    focusMinutes: preset.focusMinutes,
    shortBreakMinutes: preset.shortBreakMinutes,
    longBreakMinutes: preset.longBreakMinutes,
  });
  const activeMinutes = getModeDurationMinutes(state.mode, state.prefs);
  state.durationMinutes = activeMinutes;
  if (!state.isRunning) {
    state.phaseTotalSeconds = activeMinutes * 60;
    state.secondsLeft = state.phaseTotalSeconds;
    persistCurrentSession();
    syncDocumentTitle();
  }
}

export function extendFocusTimer(deltaMinutes: number): void {
  const deltaSec = Math.round(deltaMinutes) * 60;
  if (deltaSec === 0) return;
  const nextLeft = Math.max(60, Math.min(240 * 60, state.secondsLeft + deltaSec));
  const actualDelta = nextLeft - state.secondsLeft;
  state.secondsLeft = nextLeft;
  state.phaseTotalSeconds = Math.max(state.phaseTotalSeconds + actualDelta, nextLeft, 60);
  if (!state.isRunning) {
    state.durationMinutes = Math.max(1, Math.round(state.phaseTotalSeconds / 60));
  }
  if (state.endAt) {
    state.endAt += actualDelta * 1000;
  }
  persistCurrentSession();
  syncDocumentTitle();
  const sign = deltaMinutes > 0 ? `+${deltaMinutes}` : `${deltaMinutes}`;
  toastNotifier?.(`已调整当前计时 ${sign} 分钟`, 'info');
}

export function skipToNextFocusPhase(): void {
  const transition = resolveNextPhase(state.mode, state.completedRoundsInCycle, state.prefs);
  state.isRunning = false;
  state.endAt = null;
  state.startedAt = null;
  state.zenMode = false;
  stopTicker();
  stopAmbientSound();
  state.mode = transition.nextMode;
  state.completedRoundsInCycle = transition.nextRoundsInCycle;
  state.durationMinutes = transition.durationMinutes;
  state.phaseTotalSeconds = transition.durationMinutes * 60;
  state.secondsLeft = state.phaseTotalSeconds;
  state.distractions = 0;
  persistCurrentSession();
  syncDocumentTitle();
}

export function bindFocusReminder(reminder: Reminder | null, force: boolean = false): void {
  if (!reminder) {
    if (force) {
      state.reminderId = '';
      state.reminderTitle = '';
      state.pendingTaskCandidate = null;
      persistCurrentSession();
    }
    return;
  }
  if (state.reminderId === reminder.id) {
    state.reminderTitle = reminder.title;
    state.pendingTaskCandidate = null;
    persistCurrentSession();
    return;
  }
  const hasInProgressSession =
    Boolean(state.reminderId) &&
    (state.isRunning || state.secondsLeft < state.phaseTotalSeconds);
  if (!force && hasInProgressSession) {
    state.pendingTaskCandidate = reminder;
    return;
  }
  state.pendingTaskCandidate = null;
  state.reminderId = reminder.id;
  state.reminderTitle = reminder.title;
  if (!state.isRunning && state.secondsLeft !== state.phaseTotalSeconds) {
    state.secondsLeft = state.phaseTotalSeconds;
  }
  persistCurrentSession();
}

export function resolvePendingTaskSwitch(acceptNewTask: boolean): void {
  const candidate = state.pendingTaskCandidate;
  state.pendingTaskCandidate = null;
  if (acceptNewTask && candidate) {
    state.isRunning = false;
    state.endAt = null;
    state.startedAt = null;
    stopTicker();
    stopAmbientSound();
    state.reminderId = candidate.id;
    state.reminderTitle = candidate.title;
    state.mode = 'focus';
    state.durationMinutes = state.prefs.focusMinutes;
    state.phaseTotalSeconds = state.durationMinutes * 60;
    state.secondsLeft = state.phaseTotalSeconds;
    state.distractions = 0;
    persistCurrentSession();
    syncDocumentTitle();
  }
}

export function setFocusIntention(intention: string): void {
  state.intention = intention.slice(0, 120);
  persistCurrentSession();
}

export function recordFocusDistraction(delta: number = 1): void {
  state.distractions = Math.max(0, state.distractions + delta);
  if (delta > 0) {
    playFocusDistractionSound();
  }
  persistCurrentSession();
}

export function setFocusAmbientSound(sound: AmbientSound, previewWhenIdle: boolean = true): void {
  if (sound !== 'none') {
    lastNonNoneAmbient = sound;
  }
  state.prefs = saveFocusPreferences({ ambientSound: sound });
  syncAmbientPlayback(previewWhenIdle);
}

export function setFocusAmbientVolume(volume: number): void {
  state.prefs = saveFocusPreferences({ ambientVolume: volume });
  if (state.isRunning || isAmbientPreviewActive()) {
    setAmbientVolume(state.prefs.ambientVolume);
  } else if (state.prefs.ambientSound !== 'none') {
    previewAmbientSound(state.prefs.ambientSound as AmbientSound, state.prefs.ambientVolume, 2800);
  }
}

export function stopFocusAmbientPreview(): void {
  if (!state.isRunning) {
    stopAmbientPreviewIfIdle();
  }
}

export function toggleAmbientMute(): AmbientSound {
  const next: AmbientSound =
    state.prefs.ambientSound === 'none'
      ? lastNonNoneAmbient
      : 'none';
  setFocusAmbientSound(next);
  return next;
}

export function updateFocusPreferences(patch: Partial<FocusPreferences>): FocusPreferences {
  const prevSound = state.prefs.ambientSound;
  state.prefs = saveFocusPreferences(patch);
  if (patch.ambientVolume !== undefined) {
    setAmbientVolume(state.prefs.ambientVolume);
  }
  if (patch.ambientSound !== undefined && patch.ambientSound !== prevSound) {
    syncAmbientPlayback();
  }
  if (!state.isRunning) {
    const newMinutes = getModeDurationMinutes(state.mode, state.prefs);
    if (patch.focusMinutes !== undefined && state.mode === 'focus') {
      state.durationMinutes = newMinutes;
      state.phaseTotalSeconds = newMinutes * 60;
      state.secondsLeft = state.phaseTotalSeconds;
      persistCurrentSession();
    } else if (patch.shortBreakMinutes !== undefined && state.mode === 'shortBreak') {
      state.durationMinutes = newMinutes;
      state.phaseTotalSeconds = newMinutes * 60;
      state.secondsLeft = state.phaseTotalSeconds;
      persistCurrentSession();
    } else if (patch.longBreakMinutes !== undefined && state.mode === 'longBreak') {
      state.durationMinutes = newMinutes;
      state.phaseTotalSeconds = newMinutes * 60;
      state.secondsLeft = state.phaseTotalSeconds;
      persistCurrentSession();
    }
  }
  state.stats = getFocusStatsOverview();
  state.historyVersion += 1;
  return state.prefs;
}

export function restoreDefaultFocusPreferences(): void {
  state.prefs = resetFocusPreferences();
  if (!state.isRunning) {
    const m = getModeDurationMinutes(state.mode, state.prefs);
    state.durationMinutes = m;
    state.phaseTotalSeconds = m * 60;
    state.secondsLeft = state.phaseTotalSeconds;
    persistCurrentSession();
  }
  syncAmbientPlayback();
  state.stats = getFocusStatsOverview();
  state.historyVersion += 1;
}

export function completeCurrentTaskAndClearFocus(): void {
  // Record elapsed full minutes (>= 1m) if user finishes task early during a running/paused focus phase
  if (state.mode === 'focus' && state.startedAt) {
    const elapsedMinutes = Math.floor((state.phaseTotalSeconds - state.secondsLeft) / 60);
    if (elapsedMinutes >= 1) {
      recordFocusHistoryEntry({
        mode: 'focus',
        durationMinutes: elapsedMinutes,
        reminderId: state.reminderId,
        reminderTitle: state.reminderTitle,
        intention: state.intention,
        distractions: state.distractions,
      });
    }
  }
  state.isRunning = false;
  state.endAt = null;
  state.startedAt = null;
  state.zenMode = false;
  state.reminderId = '';
  state.reminderTitle = '';
  state.intention = '';
  state.distractions = 0;
  stopTicker();
  stopAmbientSound();
  clearFocusSession();
  broadcastFocusSync();
  syncTrayFocusStatus(true);
  syncDocumentTitle();
  state.stats = getFocusStatsOverview();
  state.historyVersion += 1;
}

export function stopFocusEngine(): void {
  stopTicker();
  stopAmbientSound();
  if (unsubscribeFocusSyncEvent) {
    unsubscribeFocusSyncEvent();
    unsubscribeFocusSyncEvent = null;
  }
  if (unsubscribeFocusCommandEvent) {
    unsubscribeFocusCommandEvent();
    unsubscribeFocusCommandEvent = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('agenda:theme-change', handleThemeEventChange);
    window.removeEventListener('agenda:custom-accent-change', handleThemeEventChange);
    window.removeEventListener('storage', handleCrossWindowStorage);
    window.removeEventListener('beforeunload', releaseFocusOwnership);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityReconcile);
  }
  if (state.isRunning && isFocusOwner()) {
    persistCurrentSession(false);
  }
  releaseFocusOwnership();
  state.initialized = false;
}

export function applyThemeRecommendedAmbient(): AmbientSound {
  const rec = getRecommendedAmbientForTheme(readDocumentThemeId()) as AmbientSound;
  state.prefs = saveFocusPreferences({ ambientSound: rec });
  syncAmbientPlayback(true);
  return rec;
}

export function toggleAmbientFollowTheme(): boolean {
  const next = !state.prefs.ambientFollowTheme;
  const patch: Partial<FocusPreferences> = { ambientFollowTheme: next };
  if (next) {
    patch.ambientSound = getRecommendedAmbientForTheme(readDocumentThemeId());
  }
  state.prefs = saveFocusPreferences(patch);
  syncAmbientPlayback(next);
  return next;
}

export function toggleFocusFxEnabled(): boolean {
  const next = !state.prefs.fxEnabled;
  state.prefs = saveFocusPreferences({ fxEnabled: next });
  return next;
}

export function setFocusEffectStyle(style: FocusEffectOverride): void {
  state.prefs = saveFocusPreferences({ fxStyleOverride: style, fxEnabled: true });
}

export function cycleFocusEffectStyle(): FocusEffectOverride {
  const idx = FOCUS_EFFECT_OPTIONS.findIndex((o) => o.id === state.prefs.fxStyleOverride);
  const next = FOCUS_EFFECT_OPTIONS[(idx + 1) % FOCUS_EFFECT_OPTIONS.length].id;
  setFocusEffectStyle(next);
  return next;
}

export function setFocusDialHudStyle(dialHud: FocusDialHudOverride): void {
  state.prefs = saveFocusPreferences({ dialHudOverride: dialHud, fxEnabled: true });
}

export function cycleFocusDialHudStyle(): FocusDialHudOverride {
  const idx = FOCUS_DIAL_HUD_OPTIONS.findIndex((o) => o.id === state.prefs.dialHudOverride);
  const next = FOCUS_DIAL_HUD_OPTIONS[(idx + 1) % FOCUS_DIAL_HUD_OPTIONS.length].id;
  setFocusDialHudStyle(next);
  return next;
}

export function setFocusViewForm(viewForm: FocusViewForm): void {
  state.prefs = saveFocusPreferences({ viewForm });
}

export function cycleFocusViewForm(): FocusViewForm {
  const idx = FOCUS_VIEW_FORMS.findIndex((v) => v.id === state.prefs.viewForm);
  const next = FOCUS_VIEW_FORMS[(idx + 1) % FOCUS_VIEW_FORMS.length].id;
  setFocusViewForm(next);
  return next;
}

export function rateLastFocusSessionMood(mood: FocusSessionMood): void {
  if (!state.lastCompletedEntryId) return;
  if (tagFocusHistoryEntryMood(state.lastCompletedEntryId, mood)) {
    state.lastCompletedEntryId = '';
    refreshFocusStats();
  }
}

export function dismissFloatingFocusWidget(): void {
  state.floatingWidgetDismissed = true;
}

export function resetFloatingFocusWidget(): void {
  state.floatingWidgetDismissed = false;
}

export function syncFocusWithCurrentTheme(): void {
  state.activeThemeId = readDocumentThemeId();
  state.themeVersion += 1;
}

export function toggleZenMode(): void {
  state.zenMode = !state.zenMode;
}

export function getAmbientLabel(sound: AmbientSound): string {
  return AMBIENT_SOUND_OPTIONS.find((opt) => opt.id === sound)?.name || '静音';
}

export const focusEngineState = state;

export const focusThemeAura = computed(() => {
  void state.themeVersion;
  return getFocusThemeAura(state.activeThemeId, state.prefs.fxStyleOverride, state.prefs.dialHudOverride);
});

export const isFinalMinuteSprint = computed(
  () => state.isRunning && state.secondsLeft > 0 && state.secondsLeft <= 60,
);

export const focusDisplayClock = computed(() => formatFocusClock(state.secondsLeft));

export const focusProgressPercent = computed(() => {
  if (state.phaseTotalSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, ((state.phaseTotalSeconds - state.secondsLeft) / state.phaseTotalSeconds) * 100));
});

export const hasLiveFocusActivity = computed(
  () => state.isRunning || (state.secondsLeft > 0 && state.secondsLeft < state.phaseTotalSeconds),
);

export const reminderFocusMap = computed(() => {
  void state.historyVersion;
  return buildReminderFocusMap();
});

export const focusBreakdown = computed(() => {
  void state.historyVersion;
  return getFocusModeBreakdown();
});

export const breakBreathingCue = computed(() => {
  if (state.mode === 'focus' || !state.isRunning) return null;
  const elapsed = Math.max(0, state.phaseTotalSeconds - state.secondsLeft);
  return getBreathingCue(elapsed);
});
