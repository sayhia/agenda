import { getShanshuiThemeAtmosphere } from './shanshui.ts';
import { THEME_DEFINITIONS, getThemeDefinition, normalizeThemeId } from './themes.ts';

export type FocusPhaseMode = 'focus' | 'shortBreak' | 'longBreak';

export type FocusEffectStyle =
  | 'mist'
  | 'ripple'
  | 'embers'
  | 'bamboo'
  | 'aurora'
  | 'matrix'
  | 'petal'
  | 'snow'
  | 'firefly'
  | 'starfield'
  | 'spectrum'
  | 'nebula';

export type FocusEffectOverride = 'auto' | FocusEffectStyle;

export type FocusDialHudStyle =
  | 'spectrum'
  | 'radar'
  | 'gyro'
  | 'cyber'
  | 'bagua'
  | 'chronograph';

export type FocusDialHudOverride = 'auto' | FocusDialHudStyle;

export type FocusViewForm = 'dial' | 'liquid' | 'hourglass' | 'flipclock' | 'lotus';

export const FOCUS_VIEW_FORMS: { id: FocusViewForm; name: string; desc: string }[] = [
  { id: 'dial', name: '全息表盘', desc: '双色能量弧、60 刻度点亮与主题 HUD' },
  { id: 'liquid', name: '潮汐液瓶', desc: '琉璃容器内的双层流动波浪与浮起星泡' },
  { id: 'hourglass', name: '流金沙漏', desc: '双锥玻璃沙漏、颈部流沙与堆积砂丘' },
  { id: 'flipclock', name: '机械翻页', desc: '3D 立体翻页数字卡与激光底轨进度' },
  { id: 'lotus', name: '心流绽莲', desc: '十八瓣琉璃莲华随专注进度渐次舒展盛放' },
];

export interface FocusThemeAura {
  themeId: string;
  themeName: string;
  sealChar: string;
  poem: string;
  pigment: string;
  primaryColor: string;
  secondaryColor: string;
  sealColor: string;
  isLight: boolean;
  isShanshui: boolean;
  effectStyle: FocusEffectStyle;
  effectLabel: string;
  dialHudStyle: FocusDialHudStyle;
  dialHudLabel: string;
  recommendedAmbient: AmbientSoundId;
}

export type AmbientSoundId =
  | 'none'
  | 'stream'
  | 'rain'
  | 'forest'
  | 'fireplace'
  | 'alpha'
  | 'whitenoise';

export interface FocusPreset {
  id: string;
  label: string;
  shortLabel: string;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  description: string;
}

export interface FocusPreferences {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  dailyGoalMinutes: number;
  autoStartBreak: boolean;
  autoStartFocus: boolean;
  ambientSound: AmbientSoundId;
  ambientVolume: number;
  tickSoundEnabled: boolean;
  desktopNotifyEnabled: boolean;
  zenModeOnRun: boolean;
  fxEnabled: boolean;
  fxStyleOverride: FocusEffectOverride;
  dialHudOverride: FocusDialHudOverride;
  viewForm: FocusViewForm;
  ambientFollowTheme: boolean;
}

export interface FocusActiveSession {
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
  updatedAt: number;
}

export type FocusSessionMood = 'flow' | 'steady' | 'tired';

export const FOCUS_MOOD_LABELS: Record<FocusSessionMood, { label: string; icon: string }> = {
  flow: { label: '深度心流', icon: '🌊' },
  steady: { label: '稳步推进', icon: '⚡' },
  tired: { label: '略感疲惫', icon: '☁️' },
};

export interface FocusHistoryEntry {
  id: string;
  dateKey: string;
  completedAt: string;
  mode: FocusPhaseMode;
  durationMinutes: number;
  reminderId: string;
  reminderTitle: string;
  intention: string;
  distractions: number;
  mood?: FocusSessionMood;
}

export interface FocusDailySummary {
  dateKey: string;
  focusMinutes: number;
  sessions: number;
  distractions: number;
}

export interface FocusWeeklyPoint {
  dateKey: string;
  label: string;
  minutes: number;
  sessions: number;
  percent: number;
}

export interface ReminderFocusSummary {
  reminderId: string;
  totalMinutes: number;
  sessions: number;
  distractions: number;
  lastCompletedAt: string;
}

export interface FocusModeBreakdown {
  focusSessions: number;
  breakSessions: number;
  focusMinutes: number;
  breakMinutes: number;
  avgFocusMinutes: number;
  zeroDistractionPercent: number;
}

export interface BreathingCue {
  step: '吸气' | '屏息' | '呼气' | '调息';
  secondsRemainingInStep: number;
  hint: string;
}

export interface FocusStatsOverview {
  todayMinutes: number;
  todaySessions: number;
  dailyGoalMinutes: number;
  goalPercent: number;
  totalMinutes: number;
  totalSessions: number;
  streakDays: number;
  totalDistractions: number;
  weeklyTrend: FocusWeeklyPoint[];
  recentSessions: FocusHistoryEntry[];
}

export interface PhaseTransitionResult {
  nextMode: FocusPhaseMode;
  nextRoundsInCycle: number;
  shouldAutoStart: boolean;
  durationMinutes: number;
}

export const FOCUS_SESSION_STORAGE_KEY = 'agenda_focus_session';
export const FOCUS_PREFS_STORAGE_KEY = 'agenda_focus_prefs_v1';
export const FOCUS_HISTORY_STORAGE_KEY = 'agenda_focus_history_v1';
export const LEGACY_DAILY_FOCUS_KEY_PREFIX = 'agenda_focus_daily_';

export const FOCUS_STATE_EVENT = 'agenda:focus-state-change';
export const FOCUS_STATS_EVENT = 'agenda:focus-stats-change';

export const FOCUS_PRESETS: FocusPreset[] = [
  {
    id: 'sprint',
    label: '15m 微冲刺',
    shortLabel: '15m',
    focusMinutes: 15,
    shortBreakMinutes: 3,
    longBreakMinutes: 10,
    description: '快速启动、消除拖延的轻盈节拍',
  },
  {
    id: 'classic',
    label: '25m 经典番茄',
    shortLabel: '25m',
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    description: '经久考验的 25/5 黄金注意力周期',
  },
  {
    id: 'flow',
    label: '45m 沉浸心流',
    shortLabel: '45m',
    focusMinutes: 45,
    shortBreakMinutes: 10,
    longBreakMinutes: 20,
    description: '适合编码、写作与结构化深度推进',
  },
  {
    id: 'deep',
    label: '50m 深度攻坚',
    shortLabel: '50m',
    focusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 25,
    description: '完整一课时的专注与充分恢复',
  },
  {
    id: 'ultradian',
    label: '90m 超昼夜节律',
    shortLabel: '90m',
    focusMinutes: 90,
    shortBreakMinutes: 15,
    longBreakMinutes: 30,
    description: '契合人类精力波峰的长周期深度研究',
  },
];

export const BREAK_DURATION_PRESETS = [3, 5, 10, 15, 20, 30] as const;

export const DEFAULT_FOCUS_PREFERENCES: FocusPreferences = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  dailyGoalMinutes: 100,
  autoStartBreak: false,
  autoStartFocus: false,
  ambientSound: 'none',
  ambientVolume: 0.28,
  tickSoundEnabled: false,
  desktopNotifyEnabled: true,
  zenModeOnRun: false,
  fxEnabled: true,
  fxStyleOverride: 'auto',
  dialHudOverride: 'auto',
  viewForm: 'dial',
  ambientFollowTheme: false,
};

const VALID_VIEW_FORMS = new Set<FocusViewForm>(['dial', 'liquid', 'hourglass', 'flipclock', 'lotus']);

const VALID_DIAL_HUD_STYLES = new Set<FocusDialHudOverride>([
  'auto',
  'spectrum',
  'radar',
  'gyro',
  'cyber',
  'bagua',
  'chronograph',
]);

const VALID_FX_STYLES = new Set<FocusEffectOverride>([
  'auto',
  'mist',
  'ripple',
  'embers',
  'bamboo',
  'aurora',
  'matrix',
  'petal',
  'snow',
  'firefly',
  'starfield',
  'spectrum',
  'nebula',
]);

const VALID_MODES = new Set<FocusPhaseMode>(['focus', 'shortBreak', 'longBreak']);
const VALID_AMBIENTS = new Set<AmbientSoundId>([
  'none',
  'stream',
  'rain',
  'forest',
  'fireplace',
  'alpha',
  'whitenoise',
]);

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num * 100) / 100));
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function emitBrowserEvent(eventName: string, detail?: unknown): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  } catch {
    // Ignore dispatch errors in restricted environments.
  }
}

/** Formats a Date as YYYY-MM-DD in local timezone. */
export function formatFocusDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Formats seconds into MM:SS (or H:MM:SS when >= 60 minutes). */
export function formatFocusClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Formats minutes into a concise human string such as "1h 25m" or "45m". */
export function formatMinutesCompact(minutes: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/** Normalizes partial or untrusted focus preferences with bounds checking. */
export function sanitizeFocusPreferences(raw?: Partial<FocusPreferences> | null): FocusPreferences {
  const input = raw || {};
  const ambientSound =
    typeof input.ambientSound === 'string' && VALID_AMBIENTS.has(input.ambientSound as AmbientSoundId)
      ? (input.ambientSound as AmbientSoundId)
      : DEFAULT_FOCUS_PREFERENCES.ambientSound;

  return {
    focusMinutes: clampInt(input.focusMinutes, 1, 180, DEFAULT_FOCUS_PREFERENCES.focusMinutes),
    shortBreakMinutes: clampInt(input.shortBreakMinutes, 1, 60, DEFAULT_FOCUS_PREFERENCES.shortBreakMinutes),
    longBreakMinutes: clampInt(input.longBreakMinutes, 5, 90, DEFAULT_FOCUS_PREFERENCES.longBreakMinutes),
    longBreakInterval: clampInt(input.longBreakInterval, 2, 8, DEFAULT_FOCUS_PREFERENCES.longBreakInterval),
    dailyGoalMinutes: clampInt(input.dailyGoalMinutes, 15, 720, DEFAULT_FOCUS_PREFERENCES.dailyGoalMinutes),
    autoStartBreak: typeof input.autoStartBreak === 'boolean' ? input.autoStartBreak : DEFAULT_FOCUS_PREFERENCES.autoStartBreak,
    autoStartFocus: typeof input.autoStartFocus === 'boolean' ? input.autoStartFocus : DEFAULT_FOCUS_PREFERENCES.autoStartFocus,
    ambientSound,
    ambientVolume: clampFloat(input.ambientVolume, 0.05, 1, DEFAULT_FOCUS_PREFERENCES.ambientVolume),
    tickSoundEnabled: typeof input.tickSoundEnabled === 'boolean' ? input.tickSoundEnabled : DEFAULT_FOCUS_PREFERENCES.tickSoundEnabled,
    desktopNotifyEnabled:
      typeof input.desktopNotifyEnabled === 'boolean'
        ? input.desktopNotifyEnabled
        : DEFAULT_FOCUS_PREFERENCES.desktopNotifyEnabled,
    zenModeOnRun: typeof input.zenModeOnRun === 'boolean' ? input.zenModeOnRun : DEFAULT_FOCUS_PREFERENCES.zenModeOnRun,
    fxEnabled: typeof input.fxEnabled === 'boolean' ? input.fxEnabled : DEFAULT_FOCUS_PREFERENCES.fxEnabled,
    fxStyleOverride:
      typeof input.fxStyleOverride === 'string' && VALID_FX_STYLES.has(input.fxStyleOverride as FocusEffectOverride)
        ? (input.fxStyleOverride as FocusEffectOverride)
        : DEFAULT_FOCUS_PREFERENCES.fxStyleOverride,
    dialHudOverride:
      typeof input.dialHudOverride === 'string' && VALID_DIAL_HUD_STYLES.has(input.dialHudOverride as FocusDialHudOverride)
        ? (input.dialHudOverride as FocusDialHudOverride)
        : DEFAULT_FOCUS_PREFERENCES.dialHudOverride,
    viewForm:
      (input.viewForm as string) === 'horizon' || (input.viewForm as string) === 'matrix'
        ? 'lotus'
        : typeof input.viewForm === 'string' && VALID_VIEW_FORMS.has(input.viewForm as FocusViewForm)
          ? (input.viewForm as FocusViewForm)
          : DEFAULT_FOCUS_PREFERENCES.viewForm,
    ambientFollowTheme:
      typeof input.ambientFollowTheme === 'boolean'
        ? input.ambientFollowTheme
        : DEFAULT_FOCUS_PREFERENCES.ambientFollowTheme,
  };
}

/** Loads persisted focus preferences from storage. */
export function loadFocusPreferences(): FocusPreferences {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_FOCUS_PREFERENCES };
  try {
    const raw = storage.getItem(FOCUS_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FOCUS_PREFERENCES };
    return sanitizeFocusPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FOCUS_PREFERENCES };
  }
}

/** Persists sanitized focus preferences to storage and notifies listeners. */
export function saveFocusPreferences(patch: Partial<FocusPreferences>): FocusPreferences {
  const next = sanitizeFocusPreferences({ ...loadFocusPreferences(), ...patch });
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(FOCUS_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors.
    }
  }
  emitBrowserEvent(FOCUS_STATS_EVENT, { prefs: next });
  return next;
}

/** Resets all focus preferences to default values. */
export function resetFocusPreferences(): FocusPreferences {
  const next = { ...DEFAULT_FOCUS_PREFERENCES };
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(FOCUS_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors.
    }
  }
  emitBrowserEvent(FOCUS_STATS_EVENT, { prefs: next });
  return next;
}

/** Returns duration in minutes for a specific phase mode under given preferences. */
export function getModeDurationMinutes(mode: FocusPhaseMode, prefs: FocusPreferences): number {
  if (mode === 'shortBreak') return prefs.shortBreakMinutes;
  if (mode === 'longBreak') return prefs.longBreakMinutes;
  return prefs.focusMinutes;
}

/** Computes the next Pomodoro phase and cycle count upon phase completion. */
export function resolveNextPhase(
  currentMode: FocusPhaseMode,
  completedRoundsInCycle: number,
  prefs: FocusPreferences,
): PhaseTransitionResult {
  const interval = Math.max(2, prefs.longBreakInterval || 4);
  if (currentMode === 'focus') {
    const nextRounds = (Math.max(0, completedRoundsInCycle) + 1) % interval;
    const isLongBreakDue = nextRounds === 0;
    const nextMode: FocusPhaseMode = isLongBreakDue ? 'longBreak' : 'shortBreak';
    return {
      nextMode,
      nextRoundsInCycle: nextRounds,
      shouldAutoStart: prefs.autoStartBreak,
      durationMinutes: getModeDurationMinutes(nextMode, prefs),
    };
  }
  return {
    nextMode: 'focus',
    nextRoundsInCycle: Math.max(0, completedRoundsInCycle) % interval,
    shouldAutoStart: prefs.autoStartFocus,
    durationMinutes: getModeDurationMinutes('focus', prefs),
  };
}

/** Sanitizes and normalizes an active focus session object. */
export function sanitizeFocusSession(
  raw: Record<string, unknown> | null | undefined,
  prefs: FocusPreferences = loadFocusPreferences(),
): FocusActiveSession {
  const rawMode = raw?.mode;
  const legacyBreak = raw?.isBreak === true;
  const mode: FocusPhaseMode =
    typeof rawMode === 'string' && VALID_MODES.has(rawMode as FocusPhaseMode)
      ? (rawMode as FocusPhaseMode)
      : legacyBreak
        ? 'shortBreak'
        : 'focus';

  const fallbackMinutes = getModeDurationMinutes(mode, prefs);
  const durationMinutes = clampInt(raw?.durationMinutes, 1, 180, fallbackMinutes);
  const phaseTotalSeconds = clampInt(raw?.phaseTotalSeconds, 60, 180 * 60, durationMinutes * 60);
  const secondsLeft = clampInt(raw?.secondsLeft, 0, 240 * 60, phaseTotalSeconds);
  const endAt = typeof raw?.endAt === 'number' && Number.isFinite(raw.endAt) ? raw.endAt : null;
  const startedAt = typeof raw?.startedAt === 'number' && Number.isFinite(raw.startedAt) ? raw.startedAt : null;

  return {
    reminderId: typeof raw?.reminderId === 'string' ? raw.reminderId : '',
    reminderTitle: typeof raw?.reminderTitle === 'string' ? raw.reminderTitle : '',
    mode,
    durationMinutes,
    phaseTotalSeconds,
    secondsLeft,
    isRunning: raw?.isRunning === true && endAt !== null,
    endAt,
    startedAt,
    completedRoundsInCycle: clampInt(raw?.completedRoundsInCycle, 0, 16, 0),
    intention: typeof raw?.intention === 'string' ? raw.intention.slice(0, 120) : '',
    distractions: clampInt(raw?.distractions, 0, 999, 0),
    updatedAt: typeof raw?.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

/** Loads the active focus session if any exists in storage. */
export function loadFocusSession(prefs: FocusPreferences = loadFocusPreferences()): FocusActiveSession | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(FOCUS_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return sanitizeFocusSession(parsed, prefs);
  } catch {
    return null;
  }
}

/** Saves the active focus session state and broadcasts an update event. */
export function saveFocusSession(session: FocusActiveSession): FocusActiveSession {
  const normalized = sanitizeFocusSession(session as unknown as Record<string, unknown>);
  normalized.updatedAt = Date.now();
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(FOCUS_SESSION_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage quota errors.
    }
  }
  emitBrowserEvent(FOCUS_STATE_EVENT, normalized);
  return normalized;
}

/** Clears the saved active focus session and broadcasts state removal. */
export function clearFocusSession(): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(FOCUS_SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }
  emitBrowserEvent(FOCUS_STATE_EVENT, null);
}

/** Computes remaining whole seconds from a wall-clock deadline. */
export function computeRemainingSeconds(endAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

/** Reads all persisted focus history entries, capped and sorted newest first. */
export function loadFocusHistory(): FocusHistoryEntry[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(FOCUS_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, idx) => {
        const mode =
          typeof item.mode === 'string' && VALID_MODES.has(item.mode as FocusPhaseMode)
            ? (item.mode as FocusPhaseMode)
            : 'focus';
        const completedAt =
          typeof item.completedAt === 'string' && item.completedAt ? item.completedAt : new Date().toISOString();
        const dateKey =
          typeof item.dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dateKey)
            ? item.dateKey
            : formatFocusDateKey(new Date(completedAt));
        return {
          id: typeof item.id === 'string' && item.id ? item.id : `focus-${idx}`,
          dateKey,
          completedAt,
          mode,
          durationMinutes: clampInt(item.durationMinutes, 1, 240, 25),
          reminderId: typeof item.reminderId === 'string' ? item.reminderId : '',
          reminderTitle: typeof item.reminderTitle === 'string' ? item.reminderTitle : '',
          intention: typeof item.intention === 'string' ? item.intention : '',
          distractions: clampInt(item.distractions, 0, 999, 0),
          mood:
            item.mood === 'flow' || item.mood === 'steady' || item.mood === 'tired'
              ? item.mood
              : undefined,
        };
      });
  } catch {
    return [];
  }
}

/** Appends a completed focus or break session into history and keeps daily legacy key in sync. */
export function recordFocusHistoryEntry(input: {
  mode: FocusPhaseMode;
  durationMinutes: number;
  reminderId?: string;
  reminderTitle?: string;
  intention?: string;
  distractions?: number;
  now?: Date;
}): FocusHistoryEntry {
  const now = input.now || new Date();
  const dateKey = formatFocusDateKey(now);
  const entry: FocusHistoryEntry = {
    id: `f_${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
    dateKey,
    completedAt: now.toISOString(),
    mode: input.mode,
    durationMinutes: clampInt(input.durationMinutes, 1, 240, 25),
    reminderId: input.reminderId || '',
    reminderTitle: (input.reminderTitle || '').trim(),
    intention: (input.intention || '').trim(),
    distractions: clampInt(input.distractions, 0, 999, 0),
  };

  const storage = getStorage();
  if (storage) {
    try {
      const existing = loadFocusHistory();
      const updated = [entry, ...existing].slice(0, 400);
      storage.setItem(FOCUS_HISTORY_STORAGE_KEY, JSON.stringify(updated));

      if (entry.mode === 'focus') {
        const legacyKey = `${LEGACY_DAILY_FOCUS_KEY_PREFIX}${dateKey}`;
        const prev = clampInt(storage.getItem(legacyKey), 0, 5000, 0);
        storage.setItem(legacyKey, String(prev + entry.durationMinutes));
      }
    } catch {
      // Ignore storage errors.
    }
  }
  emitBrowserEvent(FOCUS_STATS_EVENT, { entry });
  return entry;
}

/** Clears stored focus history (both structured log and legacy today counter). */
export function clearFocusHistory(referenceDate: Date = new Date()): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(FOCUS_HISTORY_STORAGE_KEY);
    storage.removeItem(`${LEGACY_DAILY_FOCUS_KEY_PREFIX}${formatFocusDateKey(referenceDate)}`);
  } catch {
    // Ignore storage errors.
  }
  emitBrowserEvent(FOCUS_STATS_EVENT, { cleared: true });
}

/** Deletes a single focus history entry by ID and syncs the daily legacy counter. */
export function deleteFocusHistoryEntry(entryId: string): boolean {
  const storage = getStorage();
  if (!storage || !entryId) return false;
  try {
    const existing = loadFocusHistory();
    const target = existing.find((item) => item.id === entryId);
    if (!target) return false;
    const filtered = existing.filter((item) => item.id !== entryId);
    storage.setItem(FOCUS_HISTORY_STORAGE_KEY, JSON.stringify(filtered));
    if (target.mode === 'focus') {
      const legacyKey = `${LEGACY_DAILY_FOCUS_KEY_PREFIX}${target.dateKey}`;
      const dayMinutes = filtered
        .filter((item) => item.mode === 'focus' && item.dateKey === target.dateKey)
        .reduce((sum, item) => sum + item.durationMinutes, 0);
      if (dayMinutes > 0) storage.setItem(legacyKey, String(dayMinutes));
      else storage.removeItem(legacyKey);
    }
    emitBrowserEvent(FOCUS_STATS_EVENT, { deletedId: entryId });
    return true;
  } catch {
    return false;
  }
}

/** Records a subjective flow-state reflection mood onto a logged focus history entry. */
export function tagFocusHistoryEntryMood(entryId: string, mood: FocusSessionMood): boolean {
  const storage = getStorage();
  if (!storage || !entryId) return false;
  try {
    const existing = loadFocusHistory();
    let updated = false;
    const next = existing.map((item) => {
      if (item.id === entryId) {
        updated = true;
        return { ...item, mood };
      }
      return item;
    });
    if (!updated) return false;
    storage.setItem(FOCUS_HISTORY_STORAGE_KEY, JSON.stringify(next));
    emitBrowserEvent(FOCUS_STATS_EVENT, { moodTagged: entryId, mood });
    return true;
  } catch {
    return false;
  }
}

/** Builds an O(N) lookup map of cumulative focus effort per reminderId. */
export function buildReminderFocusMap(
  entries: FocusHistoryEntry[] = loadFocusHistory(),
): Map<string, ReminderFocusSummary> {
  const map = new Map<string, ReminderFocusSummary>();
  for (const entry of entries) {
    if (entry.mode !== 'focus' || !entry.reminderId) continue;
    const prev = map.get(entry.reminderId) || {
      reminderId: entry.reminderId,
      totalMinutes: 0,
      sessions: 0,
      distractions: 0,
      lastCompletedAt: entry.completedAt,
    };
    prev.totalMinutes += entry.durationMinutes;
    prev.sessions += 1;
    prev.distractions += entry.distractions;
    if (entry.completedAt > prev.lastCompletedAt) {
      prev.lastCompletedAt = entry.completedAt;
    }
    map.set(entry.reminderId, prev);
  }
  return map;
}

/** Returns cumulative focus metrics for a single reminder ID. */
export function getReminderFocusSummary(
  reminderId?: string | null,
  entries: FocusHistoryEntry[] = loadFocusHistory(),
): ReminderFocusSummary | null {
  if (!reminderId) return null;
  return buildReminderFocusMap(entries).get(reminderId) || null;
}

/** Computes distraction-free rate and average focus session metrics. */
export function getFocusModeBreakdown(
  entries: FocusHistoryEntry[] = loadFocusHistory(),
): FocusModeBreakdown {
  let focusSessions = 0;
  let breakSessions = 0;
  let focusMinutes = 0;
  let breakMinutes = 0;
  let zeroDistractionCount = 0;

  for (const entry of entries) {
    if (entry.mode === 'focus') {
      focusSessions += 1;
      focusMinutes += entry.durationMinutes;
      if (entry.distractions === 0) zeroDistractionCount += 1;
    } else {
      breakSessions += 1;
      breakMinutes += entry.durationMinutes;
    }
  }

  return {
    focusSessions,
    breakSessions,
    focusMinutes,
    breakMinutes,
    avgFocusMinutes: focusSessions > 0 ? Math.round(focusMinutes / focusSessions) : 0,
    zeroDistractionPercent:
      focusSessions > 0 ? Math.round((zeroDistractionCount / focusSessions) * 100) : 100,
  };
}

/** Computes a gentle 4-4-4-4 box-breathing cue for break relaxation phases. */
export function getBreathingCue(elapsedSeconds: number): BreathingCue {
  const safe = Math.max(0, Math.floor(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
  const cyclePos = safe % 16;
  const sub = cyclePos % 4;
  const remaining = 4 - sub;
  if (cyclePos < 4) {
    return { step: '吸气', secondsRemainingInStep: remaining, hint: `缓慢吸气 · ${remaining}s` };
  }
  if (cyclePos < 8) {
    return { step: '屏息', secondsRemainingInStep: remaining, hint: `柔和屏息 · ${remaining}s` };
  }
  if (cyclePos < 12) {
    return { step: '呼气', secondsRemainingInStep: remaining, hint: `舒缓呼气 · ${remaining}s` };
  }
  return { step: '调息', secondsRemainingInStep: remaining, hint: `放松停顿 · ${remaining}s` };
}

/** Exports a concise Markdown summary report of focus stats, 7-day trend and sessions. */
export function exportFocusHistoryMarkdown(referenceDate: Date = new Date()): string {
  const overview = getFocusStatsOverview(referenceDate);
  const breakdown = getFocusModeBreakdown();
  const lines: string[] = [
    `# Agenda 番茄专注效能报告 (${formatFocusDateKey(referenceDate)})`,
    '',
    '## 核心概览',
    `- **今日专注**：${overview.todayMinutes} 分钟（${overview.todaySessions} 轮 · 目标达成 ${overview.goalPercent}%）`,
    `- **连续专注**：${overview.streakDays} 天`,
    `- **累计专注**：${formatMinutesCompact(overview.totalMinutes)}（${overview.totalSessions} 轮 · 均轮 ${breakdown.avgFocusMinutes}m · 零分心率 ${breakdown.zeroDistractionPercent}%）`,
    '',
    '## 近 7 日趋势',
    ...overview.weeklyTrend.map((d) => `- ${d.dateKey} (${d.label}): ${d.minutes} 分钟 · ${d.sessions} 轮`),
  ];

  if (overview.recentSessions.length > 0) {
    lines.push('', '## 近期专注记录');
    for (const s of overview.recentSessions) {
      const taskLabel = s.reminderTitle || s.intention || '自由沉浸专注';
      const distNote = s.distractions > 0 ? ` · ${s.distractions} 次分心` : '';
      const moodNote = s.mood ? ` · ${FOCUS_MOOD_LABELS[s.mood].label}` : '';
      lines.push(`- [${s.dateKey}] **${taskLabel}** (+${s.durationMinutes}m${distNote}${moodNote})`);
    }
  }
  return lines.join('\n');
}

/** Aggregates focus-only daily minutes across structured history + optional legacy today value. */
export function aggregateDailyFocusMap(
  entries: FocusHistoryEntry[],
  referenceDate: Date = new Date(),
  legacyTodayMinutes: number = 0,
): Map<string, FocusDailySummary> {
  const map = new Map<string, FocusDailySummary>();
  for (const entry of entries) {
    if (entry.mode !== 'focus') continue;
    const prev = map.get(entry.dateKey) || {
      dateKey: entry.dateKey,
      focusMinutes: 0,
      sessions: 0,
      distractions: 0,
    };
    prev.focusMinutes += entry.durationMinutes;
    prev.sessions += 1;
    prev.distractions += entry.distractions;
    map.set(entry.dateKey, prev);
  }

  const todayKey = formatFocusDateKey(referenceDate);
  if (legacyTodayMinutes > 0) {
    const existing = map.get(todayKey);
    if (!existing) {
      map.set(todayKey, {
        dateKey: todayKey,
        focusMinutes: legacyTodayMinutes,
        sessions: Math.max(1, Math.round(legacyTodayMinutes / 25)),
        distractions: 0,
      });
    } else if (legacyTodayMinutes > existing.focusMinutes) {
      existing.focusMinutes = legacyTodayMinutes;
    }
  }
  return map;
}

/** Calculates continuous active focus streak in days ending today or yesterday. */
export function calculateFocusStreak(
  dailyMap: Map<string, FocusDailySummary>,
  referenceDate: Date = new Date(),
): number {
  const cursor = new Date(referenceDate);
  cursor.setHours(0, 0, 0, 0);

  const todayKey = formatFocusDateKey(cursor);
  const todayStats = dailyMap.get(todayKey);
  if (!todayStats || todayStats.focusMinutes <= 0) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  for (let i = 0; i < 366; i++) {
    const key = formatFocusDateKey(cursor);
    const stats = dailyMap.get(key);
    if (!stats || stats.focusMinutes <= 0) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Builds a 7-day trend array ending at referenceDate for Focus Analytics charts. */
export function buildWeeklyFocusTrend(
  dailyMap: Map<string, FocusDailySummary>,
  referenceDate: Date = new Date(),
): FocusWeeklyPoint[] {
  const base = new Date(referenceDate);
  base.setHours(0, 0, 0, 0);
  const points: Omit<FocusWeeklyPoint, 'percent'>[] = [];
  let maxMinutes = 1;

  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(base);
    d.setDate(d.getDate() - offset);
    const dateKey = formatFocusDateKey(d);
    const summary = dailyMap.get(dateKey);
    const minutes = summary?.focusMinutes || 0;
    const sessions = summary?.sessions || 0;
    if (minutes > maxMinutes) maxMinutes = minutes;
    points.push({
      dateKey,
      label: offset === 0 ? '今日' : `${d.getMonth() + 1}/${d.getDate()}`,
      minutes,
      sessions,
    });
  }

  return points.map((pt) => ({
    ...pt,
    percent: pt.minutes > 0 ? Math.max(8, Math.round((pt.minutes / maxMinutes) * 100)) : 0,
  }));
}

/** Computes complete focus telemetry overview for modals & dashboards. */
export function getFocusStatsOverview(referenceDate: Date = new Date()): FocusStatsOverview {
  const prefs = loadFocusPreferences();
  const entries = loadFocusHistory();
  const storage = getStorage();
  const todayKey = formatFocusDateKey(referenceDate);
  let legacyToday = 0;
  if (storage) {
    try {
      legacyToday = clampInt(storage.getItem(`${LEGACY_DAILY_FOCUS_KEY_PREFIX}${todayKey}`), 0, 5000, 0);
    } catch {
      legacyToday = 0;
    }
  }

  const dailyMap = aggregateDailyFocusMap(entries, referenceDate, legacyToday);
  const todaySummary = dailyMap.get(todayKey);
  const todayMinutes = todaySummary?.focusMinutes || 0;
  const todaySessions = todaySummary?.sessions || 0;
  const goalPercent = Math.min(100, Math.round((todayMinutes / Math.max(1, prefs.dailyGoalMinutes)) * 100));

  let totalMinutes = 0;
  let totalSessions = 0;
  let totalDistractions = 0;
  for (const summary of dailyMap.values()) {
    totalMinutes += summary.focusMinutes;
    totalSessions += summary.sessions;
    totalDistractions += summary.distractions;
  }

  return {
    todayMinutes,
    todaySessions,
    dailyGoalMinutes: prefs.dailyGoalMinutes,
    goalPercent,
    totalMinutes,
    totalSessions,
    streakDays: calculateFocusStreak(dailyMap, referenceDate),
    totalDistractions,
    weeklyTrend: buildWeeklyFocusTrend(dailyMap, referenceDate),
    recentSessions: entries.filter((e) => e.mode === 'focus').slice(0, 8),
  };
}

/** Sends an optional native/Web notification on Focus phase completion when permitted. */
export function sendFocusPhaseNotification(completedMode: FocusPhaseMode, title: string): void {
  if (typeof Notification === 'undefined') return;
  try {
    if (Notification.permission === 'granted') {
      const heading = completedMode === 'focus' ? '专注时段已完成' : '休息结束，准备下一轮专注';
      const body = title ? `任务：${title}` : '点击返回 Agenda 查看节奏';
      new Notification(heading, { body, silent: true });
    }
  } catch {
    // Ignore Notification API restrictions in desktop WebView.
  }
}

export const FOCUS_EFFECT_LABELS: Record<FocusEffectStyle, string> = {
  mist: '山岚云絮 · 金箔微尘',
  ripple: '听雨碧漪 · 水波潋滟',
  bamboo: '翠影风篁 · 林间微风',
  embers: '暖阳金烬 · 日晕流光',
  aurora: '星轨潮汐 · 极光呼吸',
  matrix: '量子星阵 · 流光雨列',
  petal: '落英飞花 · 栖霞舞瓣',
  snow: '霁雪寒霜 · 琼花轻舞',
  firefly: '萤火夏夜 · 星点徘徊',
  starfield: '深空星河 · 流光跃迁',
  spectrum: '音律频谱 · 流光星环',
  nebula: '紫微星云 · 引力涡旋',
};

export const FOCUS_EFFECT_OPTIONS: { id: FocusEffectOverride; name: string }[] = [
  { id: 'auto', name: '随主题自动' },
  { id: 'spectrum', name: '音律频谱' },
  { id: 'nebula', name: '紫微星云' },
  { id: 'starfield', name: '深空星河' },
  { id: 'aurora', name: '极光潮汐' },
  { id: 'ripple', name: '听雨碧漪' },
  { id: 'mist', name: '山岚云絮' },
  { id: 'petal', name: '落英飞花' },
  { id: 'snow', name: '霁雪琼花' },
  { id: 'firefly', name: '萤火夏夜' },
  { id: 'bamboo', name: '翠影风篁' },
  { id: 'embers', name: '暖阳金烬' },
  { id: 'matrix', name: '量子星阵' },
];

const THEME_EFFECT_MAP: Record<string, { style: FocusEffectStyle; ambient: AmbientSoundId }> = {
  midnight: { style: 'aurora', ambient: 'alpha' },
  daylight: { style: 'ripple', ambient: 'whitenoise' },
  cyber: { style: 'matrix', ambient: 'alpha' },
  amber: { style: 'embers', ambient: 'fireplace' },
  aurora: { style: 'starfield', ambient: 'alpha' },
  'shanshui-jiangshan': { style: 'mist', ambient: 'stream' },
  'shanshui-huangshan': { style: 'mist', ambient: 'forest' },
  'shanshui-potala': { style: 'snow', ambient: 'forest' },
  'shanshui-guilin': { style: 'firefly', ambient: 'stream' },
  'shanshui-sanxia': { style: 'ripple', ambient: 'stream' },
  'shanshui-taishan': { style: 'embers', ambient: 'fireplace' },
  'shanshui-xihu': { style: 'petal', ambient: 'stream' },
  'shanshui-lushan': { style: 'ripple', ambient: 'stream' },
  'shanshui-jiangnan': { style: 'ripple', ambient: 'rain' },
  'shanshui-emei': { style: 'nebula', ambient: 'forest' },
  'shanshui-dunhuang': { style: 'embers', ambient: 'fireplace' },
  'shanshui-jiuzhaigou': { style: 'spectrum', ambient: 'stream' },
  'shanshui-suzhou': { style: 'petal', ambient: 'rain' },
  'shanshui-zhangjiajie': { style: 'mist', ambient: 'forest' },
  'shanshui-changbai': { style: 'snow', ambient: 'whitenoise' },
  'shanshui-tianqing': { style: 'ripple', ambient: 'rain' },
  'shanshui-qixia': { style: 'petal', ambient: 'fireplace' },
  'shanshui-erhai': { style: 'firefly', ambient: 'stream' },
  'shanshui-qingcheng': { style: 'bamboo', ambient: 'forest' },
};

/** Maps a theme id to its matching ambient soundscape. */
export function getRecommendedAmbientForTheme(themeId?: string | null): AmbientSoundId {
  const normalized = normalizeThemeId(themeId);
  return THEME_EFFECT_MAP[normalized]?.ambient || 'stream';
}

/** Resolves visual particle & shader style metadata for the given theme. */
export function getFocusEffectStyleForTheme(themeId?: string | null): {
  style: FocusEffectStyle;
  label: string;
} {
  const normalized = normalizeThemeId(themeId);
  const style = THEME_EFFECT_MAP[normalized]?.style || (normalized.startsWith('shanshui-') ? 'mist' : 'aurora');
  return { style, label: FOCUS_EFFECT_LABELS[style] };
}

export const FOCUS_DIAL_HUD_LABELS: Record<FocusDialHudStyle, string> = {
  spectrum: '谐波频谱冠',
  radar: '全息雷达扫描',
  gyro: '天体浑天三环',
  cyber: '赛博机甲瞄准盘',
  bagua: '山水时令罗盘',
  chronograph: '精密陀飞轮秒针',
};

export const FOCUS_DIAL_HUD_OPTIONS: { id: FocusDialHudOverride; name: string }[] = [
  { id: 'auto', name: '随主题自动' },
  { id: 'radar', name: '全息雷达' },
  { id: 'gyro', name: '天体三环' },
  { id: 'cyber', name: '机甲准星' },
  { id: 'spectrum', name: '谐波频谱' },
  { id: 'bagua', name: '山水罗盘' },
  { id: 'chronograph', name: '陀飞轮盘' },
];

/** Maps a theme id to a signature holographic Dial HUD mode. */
export function getDialHudStyleForTheme(themeId?: string | null): FocusDialHudStyle {
  const normalized = normalizeThemeId(themeId);
  if (normalized === 'cyber') return 'cyber';
  if (normalized === 'midnight') return 'radar';
  if (normalized === 'aurora') return 'gyro';
  if (normalized === 'amber') return 'chronograph';
  if (normalized === 'daylight') return 'chronograph';
  if (normalized === 'shanshui-jiangshan' || normalized === 'shanshui-taishan' || normalized === 'shanshui-suzhou') {
    return 'bagua';
  }
  if (normalized === 'shanshui-emei' || normalized === 'shanshui-changbai' || normalized === 'shanshui-potala') {
    return 'gyro';
  }
  if (normalized === 'shanshui-sanxia' || normalized === 'shanshui-lushan') {
    return 'radar';
  }
  return 'spectrum';
}

/** Builds complete theme-synchronized atmosphere metadata for the Focus UI and FX canvas. */
export function getFocusThemeAura(
  themeId?: string | null,
  fxOverride: FocusEffectOverride = 'auto',
  dialHudOverride: FocusDialHudOverride = 'auto',
): FocusThemeAura {
  const normalized = normalizeThemeId(themeId);
  const def = getThemeDefinition(normalized) || THEME_DEFINITIONS[0];
  const isShanshui = def.group === 'shanshui';
  const atmo = isShanshui ? getShanshuiThemeAtmosphere(normalized) : null;
  const themeFx = getFocusEffectStyleForTheme(normalized);
  const resolvedStyle: FocusEffectStyle =
    fxOverride !== 'auto' && FOCUS_EFFECT_LABELS[fxOverride]
      ? fxOverride
      : themeFx.style;
  const resolvedDialHud: FocusDialHudStyle =
    dialHudOverride !== 'auto' && FOCUS_DIAL_HUD_LABELS[dialHudOverride]
      ? dialHudOverride
      : getDialHudStyleForTheme(normalized);
  return {
    themeId: normalized,
    themeName: def.name,
    sealChar: def.sealChar || (def.isLight ? '晴' : '汐'),
    poem: def.poem || atmo?.mood || def.desc,
    pigment: def.pigment || def.desc,
    primaryColor: def.color,
    secondaryColor: def.secondaryColor || def.color,
    sealColor: def.sealColor || def.color,
    isLight: Boolean(def.isLight),
    isShanshui,
    effectStyle: resolvedStyle,
    effectLabel: FOCUS_EFFECT_LABELS[resolvedStyle],
    dialHudStyle: resolvedDialHud,
    dialHudLabel: FOCUS_DIAL_HUD_LABELS[resolvedDialHud],
    recommendedAmbient: getRecommendedAmbientForTheme(normalized),
  };
}
