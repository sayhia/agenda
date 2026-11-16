<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Events } from '@wailsio/runtime';
import type {
  DesktopPreferences,
  DesktopRuntimeStatus,
  RecentDeliveryItem,
  Reminder,
} from '../../bindings/agenda/internal/agenda/models';
import {
  GetAIConfig,
  SaveAIConfig,
  TestAIConnection,
  BackupDatabase,
  ArchiveOldEndedReminders,
  ClearDeliveryHistory,
  OptimizeDatabase,
  ImportJSONBackup,
  GetDesktopRuntimeStatus,
  SaveDesktopPreferences,
  SetAutoStartEnabled,
  SetSchedulerPaused,
  OpenDesktopWindow,
  FocusDesktopWindow,
  CloseDesktopWindow,
  SetDesktopWindowAlwaysOnTop,
  SendDesktopNotification,
  SendMorningBriefingNow,
  GetRecentDeliveries,
  PauseSchedulerFor,
  ResetAllDesktopWindowBounds,
  ResetDesktopWindowBounds,
  HideAllAuxiliaryWindows,
  TriggerImmediateSchedulerCheck,
  ExportCSV,
} from '../../bindings/agenda/internal/agenda/agendaservice';
import {
  playFocusCompleteChime,
  playReminderChime,
  getSoundProfile,
  getSoundProfileLabel,
  setSoundProfile,
  getSoundVolume,
  setSoundVolume,
  type SoundProfile,
} from '../utils/audio';
import {
  FOCUS_VIEW_FORMS,
} from '../utils/focus';
import DesktopIcon from './DesktopIcon.vue';
import {
  focusEngineState,
  restoreDefaultFocusPreferences,
  setFocusViewForm,
  toggleAmbientFollowTheme,
  updateFocusPreferences,
} from '../utils/focusEngine';
import { exportToMarkdown, exportToCSV, triggerFileDownload } from '../utils/export';
import { getLanguage, setLanguage, type Language } from '../utils/i18n';
import {
  CANVAS_INTENSITY_LABELS,
  CUSTOM_ACCENT_PRESETS,
  THEME_AUTO_MODE_LABELS,
  THEME_DEFINITIONS,
  applyThemeToDocument,
  exportThemeConfigJSON,
  filterThemes,
  getCanvasIntensity,
  getContrastRatio,
  getCustomAccentOverride,
  getFavoriteThemeIds,
  getHighContrastMode,
  getPairedThemeId,
  getRecentThemeIds,
  getShanshuiSerifMode,
  getSoundFollowTheme,
  getThemeAutoMode,
  getThemeDefinition,
  importThemeConfigJSON,
  normalizeThemeId,
  resetThemePreferences,
  resolveCustomAccentHex,
  resolveEffectiveThemeId,
  setCanvasIntensity,
  setCustomAccentOverride,
  setHighContrastMode,
  setShanshuiSerifMode,
  setSoundFollowTheme,
  setThemeAutoMode,
  toggleFavoriteThemeId,
  type CanvasIntensity,
  type ThemeAutoMode,
  type ThemeFilterCategory,
  type ThemeSeasonFilter,
} from '../utils/themes';
import {
  getRecommendedShanshuiThemeForTime,
  getSeasonalAtmosphere,
  getSeasonalShanshuiRecommendation,
} from '../utils/shanshui';
import ScrolltideSelect from './ScrolltideSelect.vue';

type SettingsTabId = 'appearance' | 'reminders' | 'desktop' | 'ai' | 'data' | 'about';
type ThemeGalleryFilter = 'all' | 'curated' | 'shanshui' | 'light' | 'dark' | 'fav';

const props = defineProps<{
  visible: boolean;
  reminders?: Reminder[];
  initialTab?: SettingsTabId;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'test-notify'): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
  (e: 'refresh'): void;
  (e: 'open-trash'): void;
  (e: 'sound-change', enabled: boolean): void;
}>();

const activeTab = ref<SettingsTabId>('appearance');
const settingsBodyRef = ref<HTMLElement | null>(null);

const defaultLead = ref(localStorage.getItem('agenda_default_lead') || '10');
const soundEnabled = ref(localStorage.getItem('agenda_sound_enabled') !== 'false');
const currentTheme = ref(normalizeThemeId(localStorage.getItem('agenda_theme')));
const currentSoundProfile = ref<SoundProfile>(getSoundProfile());

const soundProfiles = [
  { id: 'crystal', name: '晶体双音谐波' },
  { id: 'guqin', name: '古琴五声清弦' },
  { id: 'qing', name: '山寺古磬清响' },
  { id: 'zen', name: '禅音颂钵鸣响' },
  { id: 'droplet', name: '自然水滴清音' },
  { id: 'cyber', name: '数码脉冲调频' },
];

const currentLanguage = ref<Language>(getLanguage());
const activeLanguageLabel = computed(() => (currentLanguage.value === 'en-US' ? 'English' : '简体中文'));
const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English (US)' },
];

function handleLanguageChange(val: string) {
  setLanguage(val as Language);
  currentLanguage.value = val as Language;
  emit('toast', val === 'en-US' ? 'Language switched to English' : '界面语言已切换为简体中文', 'success');
}

const soundProfileOptions = soundProfiles.map((sp) => ({ value: sp.id, label: sp.name }));
const soundVolumePct = ref(Math.round(getSoundVolume() * 100));

function handleVolumeChange() {
  setSoundVolume(soundVolumePct.value / 100);
}
const leadPresets = [
  { value: '0', label: '准时' },
  { value: '5', label: '5m' },
  { value: '10', label: '10m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
];

function handleSoundProfileChange() {
  setSoundProfile(currentSoundProfile.value);
  playReminderChime(0.28, currentSoundProfile.value);
  emit('toast', `已切换音效为「${soundProfiles.find((s) => s.id === currentSoundProfile.value)?.name}」`, 'info');
}

const isOptimizingDB = ref(false);
const dbOptimizeResult = ref('');

async function handleOptimizeDB() {
  isOptimizingDB.value = true;
  try {
    const res = await OptimizeDatabase();
    dbOptimizeResult.value = res;
    emit('toast', '数据库整理完成', 'success');
  } catch (err: any) {
    emit('toast', `整理失败: ${err.message || err}`, 'error');
  } finally {
    isOptimizingDB.value = false;
  }
}

// Themes definition (Scrolltide Curated + Chinese Landscape Aesthetics)
const themes = THEME_DEFINITIONS;
const curatedThemes = themes.filter((t) => t.group === 'curated');
const shanshuiThemes = themes.filter((t) => t.group === 'shanshui');
const themeGalleryFilter = ref<ThemeFilterCategory>('all');
const themeSeasonFilter = ref<ThemeSeasonFilter>('all');
const themeSearchQuery = ref('');
const favoriteThemeIds = ref<string[]>(getFavoriteThemeIds());
const recentThemeIds = ref<string[]>(getRecentThemeIds());
const themeAutoMode = ref<ThemeAutoMode>(getThemeAutoMode());
const soundFollowTheme = ref<boolean>(getSoundFollowTheme());
const canvasIntensity = ref<CanvasIntensity>(getCanvasIntensity());
const customAccent = ref<string>(getCustomAccentOverride());
const showThemeConfigPanel = ref(false);
const themeConfigJSON = ref('');
const themeConfigFileInputRef = ref<HTMLInputElement | null>(null);
const previewingThemeId = ref<string | null>(null);
const shanshuiSerif = ref<boolean>(getShanshuiSerifMode());
const highContrast = ref<boolean>(getHighContrastMode());

const lightThemeCount = themes.filter((t) => t.isLight).length;
const darkThemeCount = themes.length - lightThemeCount;

const activeThemeInfo = computed(() => getThemeDefinition(currentTheme.value) || themes[0]);
const heroThemeInfo = computed(() => getThemeDefinition(previewingThemeId.value || currentTheme.value) || activeThemeInfo.value);
const pairedThemeInfo = computed(() => getThemeDefinition(getPairedThemeId(currentTheme.value)) || themes[1]);
const activeCustomAccentHex = computed(() => resolveCustomAccentHex(customAccent.value));
const effectiveAccentHex = computed(() => activeCustomAccentHex.value || activeThemeInfo.value.color || '#46b7ff');
const customColorPickerValue = computed(() => effectiveAccentHex.value);
const accentContrastInfo = computed(() => {
  const ratio = getContrastRatio(effectiveAccentHex.value, activeThemeInfo.value.bgPreview || '#07080a');
  const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : '装饰';
  return { ratio, grade };
});
const recentThemesList = computed(() =>
  recentThemeIds.value
    .map((id) => getThemeDefinition(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t)),
);

const canvasIntensityOptions: Array<{ id: CanvasIntensity; label: string; desc: string }> = (
  Object.entries(CANVAS_INTENSITY_LABELS) as Array<[CanvasIntensity, { label: string; desc: string }]>
).map(([id, info]) => ({ id, label: info.label, desc: info.desc }));

const seasonFilterOptions: Array<{ id: ThemeSeasonFilter; label: string }> = [
  { id: 'all', label: '四季' },
  { id: '春', label: '春' },
  { id: '夏', label: '夏' },
  { id: '秋', label: '秋' },
  { id: '冬', label: '冬' },
];

const filteredThemes = computed(() =>
  filterThemes({
    category: themeGalleryFilter.value,
    season: themeSeasonFilter.value,
    query: themeSearchQuery.value,
    favoriteIds: favoriteThemeIds.value,
  }),
);

const visibleCuratedThemes = computed(() => filteredThemes.value.filter((t) => t.group === 'curated'));
const visibleShanshuiThemes = computed(() => filteredThemes.value.filter((t) => t.group === 'shanshui'));
const seasonalAtmo = computed(() => getSeasonalAtmosphere(new Date()));

const autoModeOptions: Array<{ id: ThemeAutoMode; label: string; short: string; desc: string }> = (
  Object.entries(THEME_AUTO_MODE_LABELS) as Array<[ThemeAutoMode, { label: string; short: string; desc: string }]>
).map(([id, info]) => ({ id, label: info.label, short: info.short, desc: info.desc }));

function applyThemeSoundIfEnabled(themeId: string) {
  if (!soundFollowTheme.value) return;
  const rec = getThemeDefinition(themeId)?.recommendedSound;
  if (rec) {
    currentSoundProfile.value = rec;
    setSoundProfile(rec);
  }
}

function previewTheme(themeId: string) {
  const normalized = normalizeThemeId(themeId);
  if (normalized === currentTheme.value && !previewingThemeId.value) return;
  previewingThemeId.value = normalized;
  applyThemeToDocument(normalized, { animate: false });
}

function restoreThemePreview() {
  if (!previewingThemeId.value) return;
  previewingThemeId.value = null;
  applyThemeToDocument(currentTheme.value, { animate: false });
}

function selectTheme(themeId: string) {
  previewingThemeId.value = null;
  const normalized = normalizeThemeId(themeId);
  if (themeAutoMode.value === 'seasonal') {
    themeAutoMode.value = 'manual';
    setThemeAutoMode('manual');
  }
  currentTheme.value = applyThemeToDocument(normalized, {
    animate: true,
    persist: true,
    dispatch: true,
  });
  recentThemeIds.value = getRecentThemeIds();
  applyThemeSoundIfEnabled(normalized);
  emit('toast', `已切换主题为「${themes.find((t) => t.id === normalized)?.name}」`, 'success');
}

function handleThemeModeChange(mode: ThemeAutoMode) {
  previewingThemeId.value = null;
  themeAutoMode.value = mode;
  setThemeAutoMode(mode);
  const resolved = resolveEffectiveThemeId({ mode });
  currentTheme.value = applyThemeToDocument(resolved, { animate: true, dispatch: true });
  applyThemeSoundIfEnabled(resolved);
  emit('toast', `已切换流转模式为「${THEME_AUTO_MODE_LABELS[mode].label}」`, 'success');
}

function handleToggleThemePolarity() {
  selectTheme(getPairedThemeId(currentTheme.value));
}

function handleToggleFavoriteTheme(themeId: string) {
  favoriteThemeIds.value = toggleFavoriteThemeId(themeId);
}

function handleToggleSoundFollowTheme() {
  soundFollowTheme.value = !soundFollowTheme.value;
  setSoundFollowTheme(soundFollowTheme.value);
  if (soundFollowTheme.value) {
    applyThemeSoundIfEnabled(currentTheme.value);
    emit('toast', '已开启随境换音', 'info');
  } else {
    emit('toast', '已关闭随境换音', 'info');
  }
}

function cycleRandomShanshuiTheme() {
  const pool = shanshuiThemes.filter((t) => t.id !== currentTheme.value);
  const pick = pool[Math.floor(Math.random() * pool.length)] || shanshuiThemes[0];
  if (pick) selectTheme(pick.id);
}

function applyTimeRecommendedShanshuiTheme() {
  selectTheme(getRecommendedShanshuiThemeForTime(new Date()));
}

function applySeasonalShanshuiTheme() {
  selectTheme(getSeasonalShanshuiRecommendation(new Date()));
}

function handleCanvasIntensityChange(level: CanvasIntensity) {
  canvasIntensity.value = setCanvasIntensity(level);
  emit('toast', `背景浓度已设为「${CANVAS_INTENSITY_LABELS[canvasIntensity.value].label}」`, 'info');
}

function handleToggleShanshuiSerif() {
  shanshuiSerif.value = setShanshuiSerifMode(!shanshuiSerif.value);
  emit('toast', shanshuiSerif.value ? '已开启山水雅宋标题字体' : '已切换为系统无衬线标题', 'info');
}

function handleToggleHighContrast() {
  highContrast.value = setHighContrastMode(!highContrast.value);
  emit('toast', highContrast.value ? '已开启高对比护眼模式' : '已关闭高对比护眼模式', 'info');
}

async function copySwatchHex(hex?: string, label = '色值') {
  if (!hex) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(hex);
      emit('toast', `已复制${label}色值：${hex}`, 'success');
      return;
    }
  } catch {
    // ignore clipboard restrictions
  }
  emit('toast', `${label}：${hex}`, 'info');
}

function handleSelectCustomAccent(idOrHex: string) {
  customAccent.value = setCustomAccentOverride(idOrHex);
  if (customAccent.value === 'default') {
    emit('toast', '已恢复主题原色', 'success');
  } else {
    const preset = CUSTOM_ACCENT_PRESETS.find((p) => p.id === customAccent.value);
    emit('toast', `已叠加点睛色：${preset ? preset.name : customAccent.value}`, 'success');
  }
}

function handleCustomColorInput(ev: Event) {
  const value = (ev.target as HTMLInputElement | null)?.value;
  if (value) handleSelectCustomAccent(value);
}

async function handleExportThemeConfig() {
  const snapshot = exportThemeConfigJSON();
  themeConfigJSON.value = snapshot;
  showThemeConfigPanel.value = true;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(snapshot);
      emit('toast', '配置 JSON 已复制到剪贴板', 'success');
      return;
    }
  } catch {
    // Fallback to inline JSON panel already opened above
  }
  emit('toast', '已生成配置 JSON，可直接复制', 'info');
}

function handleDownloadThemeConfigFile() {
  const snapshot = exportThemeConfigJSON();
  themeConfigJSON.value = snapshot;
  triggerFileDownload(snapshot, `agenda-theme-${currentTheme.value}.json`, 'application/json;charset=utf-8');
  emit('toast', '已导出主题配置 JSON 文件', 'success');
}

function triggerThemeConfigFileImport() {
  themeConfigFileInputRef.value?.click();
}

async function onThemeConfigFileSelected(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    themeConfigJSON.value = await file.text();
    handleImportThemeConfig();
  } catch {
    emit('toast', '读取配置文件失败', 'error');
  } finally {
    input.value = '';
  }
}

function handleImportThemeConfig() {
  const res = importThemeConfigJSON(themeConfigJSON.value);
  if (!res.ok) {
    emit('toast', res.error, 'error');
    return;
  }
  previewingThemeId.value = null;
  currentTheme.value = res.themeId;
  themeAutoMode.value = getThemeAutoMode();
  favoriteThemeIds.value = getFavoriteThemeIds();
  recentThemeIds.value = getRecentThemeIds();
  soundFollowTheme.value = getSoundFollowTheme();
  canvasIntensity.value = getCanvasIntensity();
  customAccent.value = getCustomAccentOverride();
  shanshuiSerif.value = getShanshuiSerifMode();
  highContrast.value = getHighContrastMode();
  showThemeConfigPanel.value = false;
  emit('toast', `已导入并应用「${getThemeDefinition(res.themeId)?.name || res.themeId}」`, 'success');
}

function handleResetThemeDefaults() {
  previewingThemeId.value = null;
  currentTheme.value = resetThemePreferences();
  themeAutoMode.value = getThemeAutoMode();
  favoriteThemeIds.value = getFavoriteThemeIds();
  recentThemeIds.value = getRecentThemeIds();
  soundFollowTheme.value = getSoundFollowTheme();
  canvasIntensity.value = getCanvasIntensity();
  customAccent.value = getCustomAccentOverride();
  shanshuiSerif.value = getShanshuiSerifMode();
  highContrast.value = getHighContrastMode();
  themeConfigJSON.value = '';
  showThemeConfigPanel.value = false;
  emit('toast', '已恢复默认外观配置', 'success');
}

function handleSoundToggle() {
  soundEnabled.value = !soundEnabled.value;
  localStorage.setItem('agenda_sound_enabled', String(soundEnabled.value));
  emit('sound-change', soundEnabled.value);
  window.dispatchEvent(new CustomEvent('agenda:sound-preference', { detail: soundEnabled.value }));
}

function handleDefaultLeadChange(val?: string) {
  if (typeof val === 'string') defaultLead.value = val;
  localStorage.setItem('agenda_default_lead', defaultLead.value);
  emit('toast', defaultLead.value === '0' ? '已设为准时提醒' : `提前提醒已设为 ${defaultLead.value} 分钟`, 'success');
}

function handleTestAudio() {
  playReminderChime(0.28);
  emit('toast', '已播放当前提示音', 'info');
}

// AI Config
const aiBaseURL = ref('https://api.deepseek.com/v1');
const aiAPIKey = ref('');
const aiModel = ref('deepseek-chat');
const showAPIKey = ref(false);
const isTestingAI = ref(false);
const testResult = ref('');
const testSuccess = ref(false);

const aiPresets = [
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'ollama', label: 'Ollama', url: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

function applyAIPreset(url: string, model: string, label: string) {
  aiBaseURL.value = url;
  aiModel.value = model;
  emit('toast', `已填充 ${label} 推荐配置`, 'info');
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      if (props.initialTab) {
        activeTab.value = props.initialTab;
      }
      testResult.value = '';
      destructiveConfirm.value = null;
      showAPIKey.value = false;
      currentTheme.value = resolveEffectiveThemeId();
      themeAutoMode.value = getThemeAutoMode();
      favoriteThemeIds.value = getFavoriteThemeIds();
      recentThemeIds.value = getRecentThemeIds();
      soundFollowTheme.value = getSoundFollowTheme();
      canvasIntensity.value = getCanvasIntensity();
      customAccent.value = getCustomAccentOverride();
      shanshuiSerif.value = getShanshuiSerifMode();
      highContrast.value = getHighContrastMode();
      soundEnabled.value = localStorage.getItem('agenda_sound_enabled') !== 'false';
      void loadDesktopStatus();
      try {
        const cfg = await GetAIConfig();
        if (cfg) {
          aiBaseURL.value = cfg.base_url || 'https://api.deepseek.com/v1';
          aiAPIKey.value = cfg.api_key || '';
          aiModel.value = cfg.model || 'deepseek-chat';
        }
      } catch {
        // ignore
      }
    } else {
      restoreThemePreview();
    }
  },
);

watch(
  () => props.initialTab,
  (tab) => {
    if (props.visible && tab) {
      activeTab.value = tab;
    }
  },
);

async function handleTestAI() {
  if (!aiAPIKey.value.trim()) {
    testResult.value = '请先输入 API Key';
    testSuccess.value = false;
    return;
  }
  isTestingAI.value = true;
  testResult.value = '正在测试连接...';
  try {
    const res = await TestAIConnection(aiBaseURL.value, aiAPIKey.value, aiModel.value);
    testResult.value = res;
    testSuccess.value = true;
  } catch (err: any) {
    testResult.value = err.message || String(err);
    testSuccess.value = false;
  } finally {
    isTestingAI.value = false;
  }
}

async function handleSaveAI() {
  try {
    await SaveAIConfig({
      base_url: aiBaseURL.value.trim(),
      api_key: aiAPIKey.value.trim(),
      model: aiModel.value.trim(),
    });
    emit('toast', '已保存模型配置', 'success');
  } catch (err: any) {
    emit('toast', `保存失败: ${err.message || err}`, 'error');
  }
}

// Data Management
const isBackingUp = ref(false);
const backupPath = ref('');
const destructiveConfirm = ref<'archive' | 'history' | null>(null);
const isArchiving = ref(false);
const isClearingHistory = ref(false);

async function handleBackupDB() {
  isBackingUp.value = true;
  try {
    const path = await BackupDatabase();
    backupPath.value = path;
    emit('toast', '数据库快照已创建', 'success');
  } catch (err: any) {
    emit('toast', `备份失败: ${err.message || err}`, 'error');
  } finally {
    isBackingUp.value = false;
  }
}

async function handleArchive() {
  if (isArchiving.value) return;
  if (destructiveConfirm.value !== 'archive') {
    destructiveConfirm.value = 'archive';
    return;
  }
  destructiveConfirm.value = null;
  isArchiving.value = true;
  try {
    const count = await ArchiveOldEndedReminders(30);
    emit('toast', `已归档 ${count} 条 30 天前旧日程`, 'success');
    emit('refresh');
  } catch (err: any) {
    emit('toast', `归档失败: ${err.message || err}`, 'error');
  } finally {
    isArchiving.value = false;
  }
}

async function handleClearHistory() {
  if (isClearingHistory.value) return;
  if (destructiveConfirm.value !== 'history') {
    destructiveConfirm.value = 'history';
    return;
  }
  destructiveConfirm.value = null;
  isClearingHistory.value = true;
  try {
    await ClearDeliveryHistory();
    emit('toast', '已清空推送记录', 'info');
  } catch (err: any) {
    emit('toast', `清空失败: ${err.message || err}`, 'error');
  } finally {
    isClearingHistory.value = false;
  }
}

function handleExportMD() {
  const list = props.reminders || [];
  if (list.length === 0) {
    emit('toast', '暂无日程可导出', 'info');
    return;
  }
  const md = exportToMarkdown(list);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  triggerFileDownload(md, `Agenda_Butler_${dateStr}.md`, 'text/markdown;charset=utf-8');
  emit('toast', `已导出 ${list.length} 条日程 (Markdown)`, 'success');
}

async function handleExportCSV() {
  const list = props.reminders || [];
  if (list.length === 0) {
    emit('toast', '暂无日程可导出', 'info');
    return;
  }
  let csv = '';
  try {
    csv = await ExportCSV();
  } catch {
    csv = exportToCSV(list);
  }
  if (!csv) csv = exportToCSV(list);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  triggerFileDownload(csv, `Agenda_Butler_${dateStr}.csv`, 'text/csv;charset=utf-8');
  emit('toast', `已导出 ${list.length} 条日程 (CSV)`, 'success');
}

// Full Fidelity JSON Export & Restore
const jsonFileInputRef = ref<HTMLInputElement | null>(null);

function handleExportJSON() {
  const list = props.reminders || [];
  if (list.length === 0) {
    emit('toast', '暂无日程可导出', 'info');
    return;
  }
  const jsonStr = JSON.stringify(list, null, 2);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  triggerFileDownload(jsonStr, `Agenda_Backup_${dateStr}.json`, 'application/json;charset=utf-8');
  emit('toast', `已导出 ${list.length} 条日程 (JSON)`, 'success');
}

function triggerImportJSON() {
  jsonFileInputRef.value?.click();
}

async function onJSONFileSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const file = target.files[0];
  try {
    const text = await file.text();
    const count = await ImportJSONBackup(text);
    emit('toast', `已恢复导入 ${count} 条日程`, 'success');
    emit('refresh');
  } catch (err: any) {
    emit('toast', `导入失败: ${err.message || err}`, 'error');
  } finally {
    target.value = '';
  }
}

// DND Quiet Hours & Desktop Runtime (Multi-window, Tray, Background Service)
const dndEnabled = ref(localStorage.getItem('agenda_dnd_enabled') === 'true');
const dndStart = ref(localStorage.getItem('agenda_dnd_start') || '23:00');
const dndEnd = ref(localStorage.getItem('agenda_dnd_end') || '08:00');

const desktopStatus = ref<DesktopRuntimeStatus | null>(null);
const recentDeliveries = ref<RecentDeliveryItem[]>([]);
const desktopPrefs = ref<DesktopPreferences>({
  close_to_tray: true,
  start_minimized: false,
  show_tray_count: true,
  tray_click_action: 'popover',
  hotkey_target: 'quick-add',
  quick_add_hotkey: 'CmdOrCtrl+Alt+A',
  tray_popover_hotkey: '',
  focus_hotkey: '',
  quick_add_auto_hide: true,
  scheduler_paused: false,
  dnd_enabled: dndEnabled.value,
  dnd_start: dndStart.value,
  dnd_end: dndEnd.value,
  dnd_allow_p0: true,
  morning_briefing_enabled: false,
  morning_briefing_time: '09:00',
});
const isUpdatingAutoStart = ref(false);
const isRefreshingDesktop = ref(false);

const trayClickOptions = [
  { id: 'popover', label: '速览浮窗', desc: '左键点击托盘弹出今日速览浮窗' },
  { id: 'main', label: '主窗口', desc: '左键点击托盘显示/隐藏主工作台' },
  { id: 'menu', label: '原生菜单', desc: '左键直接展开系统托盘菜单' },
];

const hotkeyTargetOptions = [
  { id: 'quick-add', label: '快速新建浮窗', desc: '全局快捷键唤起轻量快速捕获浮窗' },
  { id: 'main', label: '主工作台', desc: '全局快捷键唤醒主窗口并打开新建弹窗' },
];

function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}小时 ${m}分`;
  if (m > 0) return `${m}分 ${rem}秒`;
  return `${rem}秒`;
}

async function loadDesktopStatus() {
  isRefreshingDesktop.value = true;
  try {
    const [st, logs] = await Promise.all([
      GetDesktopRuntimeStatus(),
      GetRecentDeliveries(8),
    ]);
    desktopStatus.value = st;
    recentDeliveries.value = logs || [];
    if (st?.preferences) {
      desktopPrefs.value = { ...st.preferences };
      dndEnabled.value = st.preferences.dnd_enabled;
      dndStart.value = st.preferences.dnd_start;
      dndEnd.value = st.preferences.dnd_end;
      localStorage.setItem('agenda_dnd_enabled', String(st.preferences.dnd_enabled));
      localStorage.setItem('agenda_dnd_start', st.preferences.dnd_start);
      localStorage.setItem('agenda_dnd_end', st.preferences.dnd_end);
    }
  } catch {
    // Ignore when running outside Wails runtime.
  } finally {
    isRefreshingDesktop.value = false;
  }
}

function deliveryStatusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case 'success':
      return { label: '已推送', cls: 'ok' };
    case 'lead_notice':
      return { label: '提前预警', cls: 'info' };
    case 'muted_dnd':
      return { label: '免打扰静音', cls: 'muted' };
    case 'created':
      return { label: '已创建', cls: 'info' };
    case 'paused':
      return { label: '已暂停', cls: 'muted' };
    case 'expired':
      return { label: '已到期', cls: 'warn' };
    case 'completed':
      return { label: '已完结', cls: 'ok' };
    default:
      return { label: status || '记录', cls: 'muted' };
  }
}

async function handleImmediateDaemonCheck() {
  try {
    await TriggerImmediateSchedulerCheck();
    await loadDesktopStatus();
    emit('toast', '已完成一次后台巡检与状态同步', 'success');
  } catch (err: any) {
    emit('toast', `巡检失败: ${err?.message || err}`, 'error');
  }
}

async function handleHideAllAuxWindows() {
  try {
    await HideAllAuxiliaryWindows();
    await loadDesktopStatus();
    emit('toast', '已隐藏全部辅助浮窗', 'info');
  } catch (err: any) {
    emit('toast', `操作失败: ${err?.message || err}`, 'error');
  }
}

async function handleResetWindowBounds(name: string) {
  try {
    await ResetDesktopWindowBounds(name);
    await loadDesktopStatus();
    emit('toast', '已重置窗口位置', 'info');
  } catch (err: any) {
    emit('toast', `重置失败: ${err?.message || err}`, 'error');
  }
}

async function handleResetAllWindowBounds() {
  try {
    await ResetAllDesktopWindowBounds();
    await loadDesktopStatus();
    emit('toast', '已清空全部窗口记忆位置并重新居中', 'success');
  } catch (err: any) {
    emit('toast', `批量重置失败: ${err?.message || err}`, 'error');
  }
}

async function handlePauseSchedulerFor(minutes: number) {
  try {
    await PauseSchedulerFor(minutes);
    await loadDesktopStatus();
    emit('toast', minutes >= 60 ? `已定时暂停后台守护 ${minutes / 60} 小时` : `已定时暂停后台守护 ${minutes} 分钟`, 'info');
  } catch (err: any) {
    emit('toast', `定时暂停失败: ${err?.message || err}`, 'error');
  }
}

const schedulerPausedRemainingText = computed(() => {
  const sec = desktopStatus.value?.scheduler?.paused_remaining_sec || 0;
  if (sec <= 0) return '';
  const mins = Math.ceil(sec / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`;
  }
  return `${mins} 分钟`;
});

const nextReminderCountdownText = computed(() => {
  const sec = desktopStatus.value?.scheduler?.next_reminder_in_sec || 0;
  if (sec <= 0) return '';
  const mins = Math.ceil(sec / 60);
  if (mins < 60) return `${mins} 分钟后`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m === 0 ? `${h} 小时后` : `${h} 小时 ${m} 分后`;
  return '';
});

async function handleSendTestDesktopNotification() {
  try {
    await SendDesktopNotification('日程管家通知测试', '系统通知通道工作正常（若开启了免打扰时段则自动静默）。');
    emit('toast', '已触发原生系统通知（免打扰期间会自动静默）', 'info');
  } catch (err: any) {
    emit('toast', `通知发送失败: ${err?.message || err}`, 'error');
  }
}

async function persistDesktopPrefs(patch: Partial<DesktopPreferences>, toastMsg?: string) {
  const next: DesktopPreferences = { ...desktopPrefs.value, ...patch };
  desktopPrefs.value = next;
  try {
    desktopPrefs.value = await SaveDesktopPreferences(next);
    await loadDesktopStatus();
    if (toastMsg) emit('toast', toastMsg, 'info');
  } catch (err: any) {
    emit('toast', `保存桌面设置失败: ${err?.message || err}`, 'error');
  }
}

async function handleToggleAutoStart() {
  if (isUpdatingAutoStart.value) return;
  isUpdatingAutoStart.value = true;
  const target = !desktopStatus.value?.autostart?.enabled;
  try {
    const info = await SetAutoStartEnabled(target);
    await loadDesktopStatus();
    if (info.error) {
      emit('toast', `开机自启配置失败: ${info.error}`, 'error');
    } else {
      emit('toast', info.enabled ? '已开启开机自动启动' : '已关闭开机自动启动', 'success');
    }
  } catch (err: any) {
    emit('toast', `开机自启操作失败: ${err?.message || err}`, 'error');
  } finally {
    isUpdatingAutoStart.value = false;
  }
}

async function handleToggleSchedulerPaused() {
  const next = !desktopStatus.value?.scheduler?.paused;
  try {
    await SetSchedulerPaused(next);
    await loadDesktopStatus();
    emit('toast', next ? '已暂停后台提醒守护' : '已恢复后台提醒守护', 'info');
  } catch (err: any) {
    emit('toast', `切换后台状态失败: ${err?.message || err}`, 'error');
  }
}

async function handleSendMorningBriefingNow() {
  try {
    const summary = await SendMorningBriefingNow();
    await loadDesktopStatus();
    emit('toast', summary || '已推送今日简报系统通知', 'success');
  } catch (err: any) {
    emit('toast', `推送失败: ${err?.message || err}`, 'error');
  }
}

async function handleLaunchWindow(kind: string, param = '') {
  try {
    await OpenDesktopWindow(kind, param);
    await loadDesktopStatus();
  } catch (err: any) {
    emit('toast', `打开窗口失败: ${err?.message || err}`, 'error');
  }
}

async function handleToggleWinAlwaysOnTop(name: string, current: boolean) {
  try {
    await SetDesktopWindowAlwaysOnTop(name, !current);
    await loadDesktopStatus();
  } catch (err: any) {
    emit('toast', `设置置顶失败: ${err?.message || err}`, 'error');
  }
}

function saveDndPreference() {
  localStorage.setItem('agenda_dnd_enabled', String(dndEnabled.value));
  localStorage.setItem('agenda_dnd_start', dndStart.value);
  localStorage.setItem('agenda_dnd_end', dndEnd.value);
  void persistDesktopPrefs({
    dnd_enabled: dndEnabled.value,
    dnd_start: dndStart.value,
    dnd_end: dndEnd.value,
  });
  emit('toast', dndEnabled.value ? `已启用免打扰 (${dndStart.value} - ${dndEnd.value})` : '已关闭免打扰', 'info');
}

function handleToggleDnd() {
  dndEnabled.value = !dndEnabled.value;
  saveDndPreference();
}

const navTabs = computed<Array<{ id: SettingsTabId; label: string; desc: string }>>(() => [
  { id: 'appearance', label: '外观', desc: '主题配色、流转模式与宣纸浓度' },
  { id: 'reminders', label: '提醒', desc: '提前通知、音效音色与免打扰时段' },
  { id: 'desktop', label: '桌面与后台', desc: '多窗口管理、系统托盘、开机自启与守护进程' },
  { id: 'ai', label: 'AI 模型', desc: '配置大模型接口、密钥与默认模型' },
  { id: 'data', label: '数据', desc: '快照备份、导入导出、整理与废纸篓' },
  { id: 'about', label: '关于', desc: '运行内核信息与常用快捷键' },
]);

const activeTabMeta = computed(() => navTabs.value.find((t) => t.id === activeTab.value) || navTabs.value[0]);

function switchTab(id: SettingsTabId) {
  activeTab.value = id;
  if (settingsBodyRef.value) settingsBodyRef.value.scrollTop = 0;
}

function handleKeyDown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
  }
}

function syncExternalThemeState() {
  if (!props.visible) return;
  currentTheme.value = resolveEffectiveThemeId();
  themeAutoMode.value = getThemeAutoMode();
  favoriteThemeIds.value = getFavoriteThemeIds();
  recentThemeIds.value = getRecentThemeIds();
  canvasIntensity.value = getCanvasIntensity();
  customAccent.value = getCustomAccentOverride();
  shanshuiSerif.value = getShanshuiSerifMode();
  highContrast.value = getHighContrastMode();
}

let unsubscribeDesktopStatus: (() => void) | null = null;

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('agenda:theme-change', syncExternalThemeState);
  window.addEventListener('agenda:accent-change', syncExternalThemeState);
  window.addEventListener('agenda:canvas-intensity-change', syncExternalThemeState);
  window.addEventListener('agenda:favorite-themes-change', syncExternalThemeState);
  window.addEventListener('agenda:recent-themes-change', syncExternalThemeState);
  window.addEventListener('agenda:theme-prefs-change', syncExternalThemeState);
  try {
    unsubscribeDesktopStatus = Events.On('desktop-status-updated', () => {
      if (props.visible) void loadDesktopStatus();
    });
  } catch {
    // Ignore outside Wails runtime.
  }
});
onUnmounted(() => {
  restoreThemePreview();
  unsubscribeDesktopStatus?.();
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('agenda:theme-change', syncExternalThemeState);
  window.removeEventListener('agenda:accent-change', syncExternalThemeState);
  window.removeEventListener('agenda:canvas-intensity-change', syncExternalThemeState);
  window.removeEventListener('agenda:favorite-themes-change', syncExternalThemeState);
  window.removeEventListener('agenda:recent-themes-change', syncExternalThemeState);
  window.removeEventListener('agenda:theme-prefs-change', syncExternalThemeState);
});

const shortcutList = [
  { keys: '⌘ K', label: '命令面板' },
  { keys: '⌘ N', label: '新建日程' },
  { keys: '⇧ T', label: '切换明暗' },
  { keys: '{ / }', label: '切换主题' },
  { keys: '1 – 4', label: '切换视图' },
  { keys: '?', label: '快捷键表' },
];
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="settings-shell st-reticle" role="dialog" aria-modal="true" aria-label="设置">
      <!-- Left Category Navigation Rail -->
      <aside class="settings-rail">
        <div class="rail-header">
          <span class="settings-eyebrow">SETTINGS</span>
          <h3 class="rail-title">设置</h3>
        </div>

        <nav class="rail-nav" aria-label="设置分类">
          <button
            v-for="tab in navTabs"
            :key="tab.id"
            type="button"
            class="rail-tab"
            :class="{ active: activeTab === tab.id }"
            @click="switchTab(tab.id)"
          >
            <span class="rail-tab-icon" aria-hidden="true">
              <!-- Palette / Appearance -->
              <svg v-if="tab.id === 'appearance'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <circle cx="13.5" cy="6.5" r="0.8" fill="currentColor" stroke="none" />
                <circle cx="17.5" cy="10.5" r="0.8" fill="currentColor" stroke="none" />
                <circle cx="8.5" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
                <circle cx="6.5" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
              </svg>
              <!-- Bell / Reminders -->
              <svg v-else-if="tab.id === 'reminders'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              <!-- Desktop / Multi-Window & Tray -->
              <svg v-else-if="tab.id === 'desktop'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              <!-- Sparkles / AI -->
              <svg v-else-if="tab.id === 'ai'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />
              </svg>
              <!-- Database / Data -->
              <svg v-else-if="tab.id === 'data'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                <path d="M3 12a9 3 0 0 0 18 0" />
              </svg>
              <!-- Info / About -->
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </span>
            <span class="rail-tab-label">{{ tab.label }}</span>
            <span v-if="tab.id === 'appearance'" class="rail-tab-meta tabular-nums">{{ themes.length }}</span>
            <span v-else-if="tab.id === 'desktop'" class="rail-dot" :class="{ ready: !desktopStatus?.scheduler?.paused }"></span>
            <span v-else-if="tab.id === 'ai'" class="rail-dot" :class="{ ready: aiAPIKey.trim().length > 0 }"></span>
          </button>
        </nav>

        <div class="rail-footer">
          <button
            type="button"
            class="rail-theme-pill"
            title="切换明暗主题 (⇧T)"
            @click="handleToggleThemePolarity"
          >
            <span class="rail-swatch" :style="{ background: activeCustomAccentHex || activeThemeInfo.color }"></span>
            <span class="rail-theme-name">{{ activeThemeInfo.name }}</span>
            <svg v-if="activeThemeInfo.isLight" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13" class="rail-polarity-svg">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13" class="rail-polarity-svg">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          </button>
          <div class="rail-esc-hint">
            <span>{{ activeLanguageLabel }}</span>
            <kbd>Esc</kbd>
          </div>
        </div>
      </aside>

      <!-- Right Focused Workspace Pane -->
      <section class="settings-workspace">
        <header class="workspace-header">
          <div class="workspace-heading">
            <h4>{{ activeTabMeta.label }}</h4>
            <p>{{ activeTabMeta.desc }}</p>
          </div>
          <div class="workspace-actions">
            <button type="button" class="modal-close-btn" title="关闭 (Esc)" aria-label="关闭" @click="$emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        <div ref="settingsBodyRef" class="workspace-body">
          <!-- ==================== 1. APPEARANCE ==================== -->
          <template v-if="activeTab === 'appearance'">
            <!-- Live Theme Hero -->
            <div class="active-theme-hero">
              <div class="active-theme-swatch" aria-label="点击色块可复制 HEX 色值">
                <button type="button" class="hero-swatch-btn" :style="{ background: heroThemeInfo.bgPreview }" :title="`点击复制底色 ${heroThemeInfo.bgPreview}`" @click="copySwatchHex(heroThemeInfo.bgPreview, '背景底')"></button>
                <button type="button" class="hero-swatch-btn" :style="{ background: activeCustomAccentHex || heroThemeInfo.color }" :title="`点击复制主色 ${activeCustomAccentHex || heroThemeInfo.color}`" @click="copySwatchHex(activeCustomAccentHex || heroThemeInfo.color, '主点睛')"></button>
                <button type="button" class="hero-swatch-btn" :style="{ background: heroThemeInfo.secondaryColor || heroThemeInfo.color }" :title="`点击复制辅色 ${heroThemeInfo.secondaryColor || heroThemeInfo.color}`" @click="copySwatchHex(heroThemeInfo.secondaryColor || heroThemeInfo.color, '辅')"></button>
                <button v-if="heroThemeInfo.sealColor" type="button" class="hero-swatch-btn" :style="{ background: heroThemeInfo.sealColor }" :title="`点击复制朱印色 ${heroThemeInfo.sealColor}`" @click="copySwatchHex(heroThemeInfo.sealColor, '朱印')"></button>
              </div>
              <div class="active-theme-copy">
                <div class="active-theme-title-row">
                  <span v-if="heroThemeInfo.sealChar" class="shanshui-seal">{{ heroThemeInfo.sealChar }}</span>
                  <strong>{{ heroThemeInfo.name }}</strong>
                  <span class="meta-pill">{{ heroThemeInfo.isLight ? '浅色' : '深色' }}</span>
                  <span v-if="activeCustomAccentHex" class="meta-pill accent">自定义点睛</span>
                  <span v-if="heroThemeInfo.seasonHint" class="meta-pill">{{ heroThemeInfo.seasonHint }}</span>
                  <span v-if="previewingThemeId" class="meta-pill accent">悬停预览中</span>
                </div>
                <p class="hero-poem">
                  {{ heroThemeInfo.pigment ? `${heroThemeInfo.pigment} · ${heroThemeInfo.poem}` : heroThemeInfo.desc }}
                </p>
              </div>
              <div class="hero-quick-btns">
                <button
                  type="button"
                  class="pill-action-btn"
                  :title="`切换明暗雅配至「${pairedThemeInfo.name}」(⇧T)`"
                  @click="handleToggleThemePolarity"
                >
                  <span class="mini-pair-dot" :style="{ background: pairedThemeInfo.bgPreview, borderColor: pairedThemeInfo.color }"></span>
                  <span>{{ activeThemeInfo.isLight ? '深墨' : '浅宣' }} · {{ pairedThemeInfo.badge || pairedThemeInfo.name.split(' ')[0] }}</span>
                </button>
              </div>
            </div>

            <!-- Lighting, Flow & Canvas Group -->
            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">流转模式</span>
                  <span class="row-desc">{{ THEME_AUTO_MODE_LABELS[themeAutoMode].desc }}</span>
                </div>
                <div class="segmented-control" role="group" aria-label="流转模式">
                  <button
                    v-for="m in autoModeOptions"
                    :key="m.id"
                    type="button"
                    class="seg-btn"
                    :class="{ active: themeAutoMode === m.id }"
                    :title="m.desc"
                    @click="handleThemeModeChange(m.id)"
                  >
                    {{ m.short }}
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">背景浓度</span>
                  <span class="row-desc">{{ CANVAS_INTENSITY_LABELS[canvasIntensity].desc }}</span>
                </div>
                <div class="segmented-control" role="group" aria-label="背景浓度">
                  <button
                    v-for="lvl in canvasIntensityOptions"
                    :key="lvl.id"
                    type="button"
                    class="seg-btn"
                    :class="{ active: canvasIntensity === lvl.id }"
                    :title="lvl.desc"
                    @click="handleCanvasIntensityChange(lvl.id)"
                  >
                    {{ lvl.label }}
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">山水雅宋标题</span>
                  <span class="row-desc">在山水主题中以宋刻衬线字体呈现标题，增添古卷雅意</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="shanshuiSerif"
                  aria-label="山水雅宋标题"
                  class="switch-btn"
                  :class="{ checked: shanshuiSerif }"
                  @click="handleToggleShanshuiSerif"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">高对比护眼</span>
                  <span class="row-desc">强化正文辅助字色与边框线轮廓，适合长时专注阅读</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="highContrast"
                  aria-label="高对比护眼"
                  class="switch-btn"
                  :class="{ checked: highContrast }"
                  @click="handleToggleHighContrast"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">显示语言</span>
                  <span class="row-desc">界面语言 (Language)</span>
                </div>
                <ScrolltideSelect
                  v-model="currentLanguage"
                  :options="languageOptions"
                  compact
                  align="right"
                  aria-label="显示语言"
                  @change="handleLanguageChange"
                />
              </div>
            </div>

            <!-- Mineral Pigment Accent Studio -->
            <div class="studio-card">
              <div class="card-subhead">
                <div class="row-copy">
                  <span class="row-title">
                    点睛色
                    <span class="contrast-badge" :class="accentContrastInfo.grade.toLowerCase()" :title="`与当前背景对比度 ${accentContrastInfo.ratio}:1`">
                      {{ accentContrastInfo.grade }} {{ accentContrastInfo.ratio }}:1
                    </span>
                  </span>
                  <span class="row-desc">自定义高亮强调色，自动适配 WCAG 文字对比度</span>
                </div>
                <div class="accent-header-actions">
                  <button
                    v-if="activeThemeInfo.secondaryColor && activeCustomAccentHex !== activeThemeInfo.secondaryColor.toLowerCase()"
                    type="button"
                    class="pill-action-btn"
                    :title="`取当前主题辅色 ${activeThemeInfo.secondaryColor} 作为点睛色`"
                    @click="handleSelectCustomAccent(activeThemeInfo.secondaryColor)"
                  >
                    <span class="mini-pair-dot" :style="{ background: activeThemeInfo.secondaryColor }"></span>
                    <span>取辅色</span>
                  </button>
                  <label class="custom-color-trigger" title="自定取色">
                    <input
                      type="color"
                      class="native-color-picker"
                      :value="customColorPickerValue"
                      aria-label="自定取色"
                      @input="handleCustomColorInput"
                    />
                    <span>自定</span>
                  </label>
                </div>
              </div>
              <div class="accent-swatch-row" role="group" aria-label="预设点睛色">
                <button
                  v-for="preset in CUSTOM_ACCENT_PRESETS"
                  :key="preset.id"
                  type="button"
                  class="accent-chip"
                  :class="{ active: customAccent === preset.id }"
                  :title="preset.desc || preset.name"
                  @click="handleSelectCustomAccent(preset.id)"
                >
                  <span
                    class="accent-dot"
                    :class="{ 'is-default': !preset.hex }"
                    :style="preset.hex ? { background: preset.hex } : undefined"
                  ></span>
                  <span>{{ preset.name }}</span>
                </button>
                <button
                  v-if="customAccent !== 'default' && !CUSTOM_ACCENT_PRESETS.some((p) => p.id === customAccent)"
                  type="button"
                  class="accent-chip active"
                  title="还原原色"
                  @click="handleSelectCustomAccent('default')"
                >
                  <span class="accent-dot" :style="{ background: customAccent }"></span>
                  <span>{{ customAccent }} ×</span>
                </button>
              </div>
            </div>

            <!-- Recent Themes Strip -->
            <div v-if="recentThemesList.length > 1" class="recent-themes-strip">
              <span class="recent-strip-label">最近使用</span>
              <div class="recent-strip-chips">
                <button
                  v-for="rt in recentThemesList"
                  :key="rt.id"
                  type="button"
                  class="recent-theme-chip"
                  :class="{ active: currentTheme === rt.id }"
                  :title="rt.poem || rt.desc"
                  @mouseenter="previewTheme(rt.id)"
                  @mouseleave="restoreThemePreview"
                  @click="selectTheme(rt.id)"
                >
                  <span class="recent-swatch" :style="{ background: rt.bgPreview, borderColor: rt.color }"></span>
                  <span>{{ rt.badge || rt.name.split(' ')[0] }}</span>
                </button>
              </div>
            </div>

            <!-- Unified 24-Theme Gallery -->
            <div class="gallery-section">
              <div class="gallery-toolbar">
                <div class="segmented-control compact" role="group" aria-label="主题筛选">
                  <button type="button" class="seg-btn" :class="{ active: themeGalleryFilter === 'all' }" @click="themeGalleryFilter = 'all'">
                    全部 {{ themes.length }}
                  </button>
                  <button type="button" class="seg-btn" :class="{ active: themeGalleryFilter === 'curated' }" @click="themeGalleryFilter = 'curated'; themeSeasonFilter = 'all'">
                    经典 {{ curatedThemes.length }}
                  </button>
                  <button type="button" class="seg-btn" :class="{ active: themeGalleryFilter === 'shanshui' }" @click="themeGalleryFilter = 'shanshui'">
                    山水 {{ shanshuiThemes.length }}
                  </button>
                  <button type="button" class="seg-btn" :class="{ active: themeGalleryFilter === 'light' }" @click="themeGalleryFilter = 'light'">
                    浅色 {{ lightThemeCount }}
                  </button>
                  <button type="button" class="seg-btn" :class="{ active: themeGalleryFilter === 'dark' }" @click="themeGalleryFilter = 'dark'">
                    深色 {{ darkThemeCount }}
                  </button>
                  <button type="button" class="seg-btn" :class="{ active: themeGalleryFilter === 'fav' }" @click="themeGalleryFilter = 'fav'">
                    收藏 {{ favoriteThemeIds.length }}
                  </button>
                </div>

                <div class="gallery-right-filters">
                  <div v-if="themeGalleryFilter !== 'curated'" class="segmented-control compact" role="group" aria-label="四季筛选">
                    <button
                      v-for="sf in seasonFilterOptions"
                      :key="sf.id"
                      type="button"
                      class="seg-btn"
                      :class="{ active: themeSeasonFilter === sf.id }"
                      @click="themeSeasonFilter = sf.id"
                    >
                      {{ sf.label }}
                    </button>
                  </div>
                  <input
                    v-model="themeSearchQuery"
                    type="search"
                    class="theme-search-input"
                    placeholder="搜索名称、颜料或诗句..."
                    aria-label="筛选主题"
                  />
                </div>
              </div>

              <div class="gallery-quick-actions">
                <span class="seasonal-tea-note">{{ seasonalAtmo.auraLabel }} · {{ seasonalAtmo.teaSuggestion }}</span>
                <div class="quick-btn-group">
                  <button type="button" class="pill-action-btn" :title="`${seasonalAtmo.auraLabel} · ${seasonalAtmo.teaSuggestion}`" @click="applySeasonalShanshuiTheme">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
                    </svg>
                    <span>四时推荐</span>
                  </button>
                  <button type="button" class="pill-action-btn" title="依十二时辰匹配主题" @click="applyTimeRecommendedShanshuiTheme">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                    <span>时辰推荐</span>
                  </button>
                  <button type="button" class="pill-action-btn" title="随机切换一套山水主题" @click="cycleRandomShanshuiTheme">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
                      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                    </svg>
                    <span>随机</span>
                  </button>
                </div>
              </div>

              <template v-if="visibleCuratedThemes.length">
                <div class="group-caption">经典主题（{{ visibleCuratedThemes.length }}）</div>
                <div class="theme-grid">
                  <button
                    v-for="t in visibleCuratedThemes"
                    :key="t.id"
                    type="button"
                    class="theme-card"
                    :class="{ active: currentTheme === t.id }"
                    @mouseenter="previewTheme(t.id)"
                    @mouseleave="restoreThemePreview"
                    @focus="previewTheme(t.id)"
                    @blur="restoreThemePreview"
                    @click="selectTheme(t.id)"
                  >
                    <div class="theme-preview">
                      <span class="theme-swatch-stack" aria-hidden="true">
                        <i :style="{ background: t.bgPreview }"></i>
                        <i :style="{ background: t.color }"></i>
                        <i :style="{ background: t.secondaryColor || t.color }"></i>
                      </span>
                      <span class="theme-name">{{ t.name }}</span>
                      <span
                        class="card-fav-star"
                        :class="{ active: favoriteThemeIds.includes(t.id) }"
                        :title="favoriteThemeIds.includes(t.id) ? '取消收藏' : '收藏'"
                        @click.stop="handleToggleFavoriteTheme(t.id)"
                      >
                        {{ favoriteThemeIds.includes(t.id) ? '★' : '☆' }}
                      </span>
                      <span class="theme-region-badge">{{ t.isLight ? '浅' : '深' }}</span>
                    </div>
                    <div class="theme-mini-canvas" :class="{ 'is-light-bg': t.isLight }" :style="{ background: t.bgPreview }" aria-hidden="true">
                      <span class="mini-bar" :style="{ background: t.color }"></span>
                      <span class="mini-bar short" :style="{ background: t.secondaryColor || t.color }"></span>
                      <span class="mini-sound-tag" :title="`推荐提示音：${getSoundProfileLabel(t.recommendedSound).label}`">{{ getSoundProfileLabel(t.recommendedSound).short }}</span>
                    </div>
                    <span class="theme-desc">{{ t.desc }}</span>
                  </button>
                </div>
              </template>

              <template v-if="visibleShanshuiThemes.length">
                <div class="group-caption">中国山水（{{ visibleShanshuiThemes.length }}）</div>
                <div class="theme-grid">
                  <button
                    v-for="t in visibleShanshuiThemes"
                    :key="t.id"
                    type="button"
                    class="theme-card shanshui-card"
                    :class="{ active: currentTheme === t.id }"
                    @mouseenter="previewTheme(t.id)"
                    @mouseleave="restoreThemePreview"
                    @focus="previewTheme(t.id)"
                    @blur="restoreThemePreview"
                    @click="selectTheme(t.id)"
                  >
                    <div class="theme-preview">
                      <span v-if="t.sealChar" class="shanshui-seal" :style="{ '--seal-red': t.sealColor || '#e05246' }">{{ t.sealChar }}</span>
                      <span class="theme-swatch-stack" aria-hidden="true">
                        <i :style="{ background: t.bgPreview }"></i>
                        <i :style="{ background: t.color }"></i>
                        <i :style="{ background: t.secondaryColor || t.color }"></i>
                      </span>
                      <span class="theme-name">{{ t.name }}</span>
                      <span
                        class="card-fav-star"
                        :class="{ active: favoriteThemeIds.includes(t.id) }"
                        :title="favoriteThemeIds.includes(t.id) ? '取消收藏' : '收藏'"
                        @click.stop="handleToggleFavoriteTheme(t.id)"
                      >
                        {{ favoriteThemeIds.includes(t.id) ? '★' : '☆' }}
                      </span>
                      <span v-if="t.badge" class="theme-region-badge">{{ t.badge }}</span>
                    </div>
                    <div class="theme-mini-canvas" :class="{ 'is-light-bg': t.isLight }" :style="{ background: t.bgPreview }" aria-hidden="true">
                      <span class="mini-bar" :style="{ background: t.color }"></span>
                      <span class="mini-bar short" :style="{ background: t.secondaryColor || t.color }"></span>
                      <span v-if="t.seasonHint" class="mini-season-tag">{{ t.seasonHint }}</span>
                      <span class="mini-sound-tag" :title="`推荐提示音：${getSoundProfileLabel(t.recommendedSound).label}`">{{ getSoundProfileLabel(t.recommendedSound).short }}</span>
                    </div>
                    <span class="theme-desc">{{ t.pigment ? `${t.pigment} · ${t.poem}` : t.desc }}</span>
                  </button>
                </div>
              </template>

              <div v-if="!filteredThemes.length" class="empty-filter-state">
                未找到匹配当前筛选条件的主题
              </div>
            </div>

            <!-- Theme Config Snapshot -->
            <div class="theme-config-bar">
              <span class="theme-config-hint">外观方案快照（配色、收藏与浓度设定）</span>
              <div class="theme-config-actions">
                <input
                  ref="themeConfigFileInputRef"
                  type="file"
                  accept=".json,application/json"
                  style="display: none"
                  @change="onThemeConfigFileSelected"
                />
                <button type="button" class="pill-action-btn" @click="handleExportThemeConfig">复制快照</button>
                <button type="button" class="pill-action-btn" @click="handleDownloadThemeConfigFile">下载 JSON</button>
                <button type="button" class="pill-action-btn" @click="triggerThemeConfigFileImport">导入文件</button>
                <button type="button" class="pill-action-btn" @click="showThemeConfigPanel = !showThemeConfigPanel">
                  {{ showThemeConfigPanel ? '收起' : '粘贴导入' }}
                </button>
                <button type="button" class="pill-action-btn danger-subtle" @click="handleResetThemeDefaults">重置</button>
              </div>
            </div>
            <div v-if="showThemeConfigPanel" class="theme-import-drawer">
              <textarea
                v-model="themeConfigJSON"
                class="theme-config-textarea"
                rows="4"
                placeholder="在此粘贴主题配置 JSON..."
                aria-label="主题配置 JSON"
              ></textarea>
              <div class="theme-import-actions">
                <button type="button" class="btn-outline" @click="showThemeConfigPanel = false">取消</button>
                <button type="button" class="btn-solid" @click="handleImportThemeConfig">应用配置</button>
              </div>
            </div>
          </template>

          <!-- ==================== 2. REMINDERS & SOUND ==================== -->
          <template v-else-if="activeTab === 'reminders'">
            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">提前提醒</span>
                  <span class="row-desc">新建日程的默认提醒提前量</span>
                </div>
                <div class="segmented-control" role="group" aria-label="提前提醒">
                  <button
                    v-for="opt in leadPresets"
                    :key="opt.value"
                    type="button"
                    class="seg-btn"
                    :class="{ active: defaultLead === opt.value }"
                    @click="handleDefaultLeadChange(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">系统通知</span>
                  <span class="row-desc">向系统通知中心发送一条测试提醒</span>
                </div>
                <button type="button" class="btn-outline" @click="$emit('test-notify')">发送测试</button>
              </div>
            </div>

            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">提示音</span>
                  <span class="row-desc">日程到期时播放提示音效</span>
                </div>
                <div class="row-controls">
                  <button type="button" class="btn-outline audio-test-btn" @click="handleTestAudio">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                    <span>试听</span>
                  </button>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="soundEnabled"
                    aria-label="提示音"
                    class="switch-btn"
                    :class="{ checked: soundEnabled }"
                    @click="handleSoundToggle"
                  >
                    <span class="switch-thumb"></span>
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">随境换音</span>
                  <span class="row-desc">切换主题时自动匹配推荐音色</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="soundFollowTheme"
                  aria-label="随境换音"
                  class="switch-btn"
                  :class="{ checked: soundFollowTheme }"
                  @click="handleToggleSoundFollowTheme"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">音色</span>
                  <span class="row-desc">内置 Web Audio 合成提示音风格</span>
                </div>
                <ScrolltideSelect
                  v-model="currentSoundProfile"
                  :options="soundProfileOptions"
                  compact
                  align="right"
                  aria-label="音色"
                  @change="handleSoundProfileChange"
                />
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">音量</span>
                  <span class="row-desc">调节本地提示音输出响度</span>
                </div>
                <div class="volume-slider-wrap">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    v-model.number="soundVolumePct"
                    class="volume-range-slider"
                    aria-label="音量"
                    @input="handleVolumeChange"
                    @change="playReminderChime()"
                  />
                  <span class="volume-value tabular-nums">{{ soundVolumePct }}%</span>
                </div>
              </div>
            </div>

            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">免打扰</span>
                  <span class="row-desc">指定夜间时段内静默通知，不播放音效</span>
                </div>
                <div class="dnd-controls-row">
                  <input type="time" v-model="dndStart" class="dnd-time-input" aria-label="开始时间" @change="saveDndPreference" />
                  <span class="dnd-sep">至</span>
                  <input type="time" v-model="dndEnd" class="dnd-time-input" aria-label="结束时间" @change="saveDndPreference" />
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="dndEnabled"
                    aria-label="免打扰"
                    class="switch-btn"
                    :class="{ checked: dndEnabled }"
                    @click="handleToggleDnd"
                  >
                    <span class="switch-thumb"></span>
                  </button>
                </div>
              </div>
            </div>

            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">番茄专注节律与目标</span>
                  <span class="row-desc">全局默认单轮专注、短休 / 长休与每日专注目标（分钟）</span>
                </div>
                <div class="dnd-controls-row">
                  <button type="button" class="pill-action-btn" @click="playFocusCompleteChime('focus')">
                    试听专注铃
                  </button>
                  <button
                    type="button"
                    class="pill-action-btn"
                    @click="restoreDefaultFocusPreferences(); emit('toast', '已恢复番茄专注默认参数', 'info')"
                  >
                    恢复默认
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">默认专注 / 短休 / 长休 (分钟)</span>
                  <span class="row-desc">每 {{ focusEngineState.prefs.longBreakInterval }} 轮自动进入长休</span>
                </div>
                <div class="dnd-controls-row">
                  <input
                    type="number"
                    min="1"
                    max="180"
                    class="dnd-time-input tabular-nums"
                    style="width: 60px"
                    :value="focusEngineState.prefs.focusMinutes"
                    aria-label="默认专注时长"
                    @change="updateFocusPreferences({ focusMinutes: Number(($event.target as HTMLInputElement).value) })"
                  />
                  <span class="dnd-sep">/</span>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    class="dnd-time-input tabular-nums"
                    style="width: 54px"
                    :value="focusEngineState.prefs.shortBreakMinutes"
                    aria-label="默认短休时长"
                    @change="updateFocusPreferences({ shortBreakMinutes: Number(($event.target as HTMLInputElement).value) })"
                  />
                  <span class="dnd-sep">/</span>
                  <input
                    type="number"
                    min="5"
                    max="90"
                    class="dnd-time-input tabular-nums"
                    style="width: 54px"
                    :value="focusEngineState.prefs.longBreakMinutes"
                    aria-label="默认长休时长"
                    @change="updateFocusPreferences({ longBreakMinutes: Number(($event.target as HTMLInputElement).value) })"
                  />
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">每日专注目标 (分钟)</span>
                  <span class="row-desc">今日已完成 {{ focusEngineState.stats.todayMinutes }}m（{{ focusEngineState.stats.goalPercent }}%）</span>
                </div>
                <input
                  type="number"
                  min="15"
                  max="720"
                  step="15"
                  class="dnd-time-input tabular-nums"
                  style="width: 78px"
                  :value="focusEngineState.prefs.dailyGoalMinutes"
                  aria-label="每日专注目标分钟"
                  @change="updateFocusPreferences({ dailyGoalMinutes: Number(($event.target as HTMLInputElement).value) })"
                />
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">随当前主题联动声景与粒子特效</span>
                  <span class="row-desc">切换山水 / 极客主题时同步变幻背景氛围与粒子效果</span>
                </div>
                <div class="dnd-controls-row">
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="focusEngineState.prefs.ambientFollowTheme"
                    aria-label="随主题联动声景"
                    class="switch-btn"
                    :class="{ checked: focusEngineState.prefs.ambientFollowTheme }"
                    @click="toggleAmbientFollowTheme()"
                  >
                    <span class="switch-thumb"></span>
                  </button>
                  <span class="dnd-sep">特效</span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="focusEngineState.prefs.fxEnabled"
                    aria-label="专注粒子特效"
                    class="switch-btn"
                    :class="{ checked: focusEngineState.prefs.fxEnabled }"
                    @click="updateFocusPreferences({ fxEnabled: !focusEngineState.prefs.fxEnabled })"
                  >
                    <span class="switch-thumb"></span>
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">自动连播与禅意习惯</span>
                  <span class="row-desc">专注完成自动进入休息 / 自动进入禅意沉浸界面</span>
                </div>
                <div class="dnd-controls-row">
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="focusEngineState.prefs.autoStartBreak"
                    aria-label="自动进入休息"
                    class="switch-btn"
                    :class="{ checked: focusEngineState.prefs.autoStartBreak }"
                    @click="updateFocusPreferences({ autoStartBreak: !focusEngineState.prefs.autoStartBreak })"
                  >
                    <span class="switch-thumb"></span>
                  </button>
                  <span class="dnd-sep">禅意</span>
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="focusEngineState.prefs.zenModeOnRun"
                    aria-label="开始专注自动进入禅意"
                    class="switch-btn"
                    :class="{ checked: focusEngineState.prefs.zenModeOnRun }"
                    @click="updateFocusPreferences({ zenModeOnRun: !focusEngineState.prefs.zenModeOnRun })"
                  >
                    <span class="switch-thumb"></span>
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">默认计时展现形式</span>
                  <span class="row-desc">自由切换全息表盘 / 潮汐液瓶 / 流金沙漏 / 机械翻页 / 心流绽莲</span>
                </div>
                <div class="dnd-controls-row" style="flex-wrap: wrap; gap: 4px;">
                  <button
                    v-for="vf in FOCUS_VIEW_FORMS"
                    :key="vf.id"
                    type="button"
                    class="pill-action-btn"
                    :style="focusEngineState.prefs.viewForm === vf.id ? 'background: var(--accent-soft); border-color: var(--accent-border); color: var(--tide-text);' : ''"
                    @click="setFocusViewForm(vf.id)"
                  >
                    {{ vf.name }}
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- ==================== 2.5 DESKTOP, TRAY & BACKGROUND ==================== -->
          <template v-else-if="activeTab === 'desktop'">
            <!-- Live Background Daemon Banner -->
            <div class="ai-status-banner">
              <div class="ai-status-dot" :class="{ ready: desktopStatus?.scheduler?.running && !desktopStatus?.scheduler?.paused }"></div>
              <div class="row-copy" style="flex: 1; min-width: 0;">
                <span class="row-title">
                  {{
                    desktopStatus?.scheduler?.paused
                      ? (schedulerPausedRemainingText ? `后台提醒守护定时暂停中（剩余 ${schedulerPausedRemainingText}）` : '后台提醒守护已暂停')
                      : '后台守护服务运行中'
                  }}
                  <span v-if="desktopStatus?.scheduler?.dnd_active" class="meta-pill">免打扰中</span>
                </span>
                <span class="row-desc truncate-text">
                  已运行 {{ formatUptime(desktopStatus?.scheduler?.uptime_seconds || 0) }}
                  · 巡检 {{ desktopStatus?.scheduler?.checks_count || 0 }} 次
                  · 已推送 {{ desktopStatus?.scheduler?.notifications_sent || 0 }} 条通知
                  <template v-if="desktopStatus?.scheduler?.next_reminder_title">
                    · 下一项：{{ desktopStatus.scheduler.next_reminder_title }}<template v-if="nextReminderCountdownText"> ({{ nextReminderCountdownText }})</template>
                  </template>
                </span>
              </div>
              <div class="ai-preset-chips">
                <button type="button" class="pill-action-btn" :disabled="isRefreshingDesktop" @click="loadDesktopStatus">刷新</button>
                <button type="button" class="pill-action-btn" @click="handleImmediateDaemonCheck">立即巡检</button>
                <button type="button" class="pill-action-btn" @click="handleSendTestDesktopNotification">测试通知</button>
                <button type="button" class="pill-action-btn" @click="handleSendMorningBriefingNow">发送早报</button>
                <button
                  v-if="!desktopStatus?.scheduler?.paused"
                  type="button"
                  class="pill-action-btn"
                  @click="handlePauseSchedulerFor(30)"
                >
                  暂停 30m
                </button>
                <button
                  v-if="!desktopStatus?.scheduler?.paused"
                  type="button"
                  class="pill-action-btn"
                  @click="handlePauseSchedulerFor(60)"
                >
                  暂停 1h
                </button>
                <button type="button" class="pill-action-btn" @click="handleToggleSchedulerPaused">
                  {{ desktopStatus?.scheduler?.paused ? '恢复守护' : '持续暂停' }}
                </button>
              </div>
            </div>

            <!-- Background Service & Startup -->
            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">开机自动启动</span>
                  <span class="row-desc">
                    系统登录时自动拉起后台提醒守护
                    <template v-if="desktopStatus?.autostart?.strategy">
                      （{{ desktopStatus.autostart.strategy }}）
                    </template>
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="Boolean(desktopStatus?.autostart?.enabled)"
                  :disabled="!desktopStatus?.autostart?.supported || isUpdatingAutoStart"
                  aria-label="开机自动启动"
                  class="switch-btn"
                  :class="{ checked: Boolean(desktopStatus?.autostart?.enabled) }"
                  @click="handleToggleAutoStart"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">启动时静默驻留托盘</span>
                  <span class="row-desc">应用启动或自启时不弹出主窗口，直接在系统托盘后台运行</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="desktopPrefs.start_minimized"
                  aria-label="启动时静默驻留托盘"
                  class="switch-btn"
                  :class="{ checked: desktopPrefs.start_minimized }"
                  @click="persistDesktopPrefs({ start_minimized: !desktopPrefs.start_minimized }, !desktopPrefs.start_minimized ? '已开启静默启动到托盘' : '已关闭静默启动')"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">关闭主窗口时驻留系统托盘</span>
                  <span class="row-desc">点击关闭按钮时隐藏到托盘继续后台定时提醒，仅在退出菜单中彻底关闭</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="desktopPrefs.close_to_tray"
                  aria-label="关闭主窗口时驻留系统托盘"
                  class="switch-btn"
                  :class="{ checked: desktopPrefs.close_to_tray }"
                  @click="persistDesktopPrefs({ close_to_tray: !desktopPrefs.close_to_tray }, !desktopPrefs.close_to_tray ? '关闭主窗口将最小化到托盘' : '关闭主窗口将直接退出应用')"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">每日晨间日程摘要通知</span>
                  <span class="row-desc">后台守护每日按指定时刻推送一次今日待办与逾期汇总</span>
                </div>
                <div class="dnd-controls-row">
                  <input
                    type="time"
                    v-model="desktopPrefs.morning_briefing_time"
                    class="dnd-time-input"
                    aria-label="晨间简报时间"
                    @change="persistDesktopPrefs({ morning_briefing_time: desktopPrefs.morning_briefing_time }, `晨间简报时间已设为 ${desktopPrefs.morning_briefing_time}`)"
                  />
                  <button
                    type="button"
                    role="switch"
                    :aria-checked="desktopPrefs.morning_briefing_enabled"
                    aria-label="每日晨间日程摘要通知"
                    class="switch-btn"
                    :class="{ checked: desktopPrefs.morning_briefing_enabled }"
                    @click="persistDesktopPrefs({ morning_briefing_enabled: !desktopPrefs.morning_briefing_enabled }, !desktopPrefs.morning_briefing_enabled ? '已开启每日晨间简报' : '已关闭每日晨间简报')"
                  >
                    <span class="switch-thumb"></span>
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">免打扰期间允许 P0 紧急提醒穿透</span>
                  <span class="row-desc">开启后即使处于免打扰时段，P0 紧急日程仍会弹出系统通知</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="desktopPrefs.dnd_allow_p0"
                  aria-label="允许 P0 穿透免打扰"
                  class="switch-btn"
                  :class="{ checked: desktopPrefs.dnd_allow_p0 }"
                  @click="persistDesktopPrefs({ dnd_allow_p0: !desktopPrefs.dnd_allow_p0 })"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>
            </div>

            <!-- System Tray Settings -->
            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">托盘图标旁显示实时计数</span>
                  <span class="row-desc">显示今日待办数量或实时番茄专注倒计时</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="desktopPrefs.show_tray_count"
                  aria-label="托盘显示实时计数"
                  class="switch-btn"
                  :class="{ checked: desktopPrefs.show_tray_count }"
                  @click="persistDesktopPrefs({ show_tray_count: !desktopPrefs.show_tray_count })"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">托盘左键点击行为</span>
                  <span class="row-desc">{{ trayClickOptions.find(o => o.id === desktopPrefs.tray_click_action)?.desc }}（右键始终打开菜单）</span>
                </div>
                <div class="segmented-control" role="group" aria-label="托盘左键点击行为">
                  <button
                    v-for="opt in trayClickOptions"
                    :key="opt.id"
                    type="button"
                    class="seg-btn"
                    :class="{ active: desktopPrefs.tray_click_action === opt.id }"
                    @click="persistDesktopPrefs({ tray_click_action: opt.id }, `托盘左键已设为「${opt.label}」`)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Multi-Window & Hotkey -->
            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">全局快捷键 {{ desktopPrefs.quick_add_hotkey || '未设置' }} 唤起方式</span>
                  <span class="row-desc">{{ hotkeyTargetOptions.find(o => o.id === desktopPrefs.hotkey_target)?.desc }}</span>
                </div>
                <div class="segmented-control" role="group" aria-label="全局快捷键唤起方式">
                  <button
                    v-for="opt in hotkeyTargetOptions"
                    :key="opt.id"
                    type="button"
                    class="seg-btn"
                    :class="{ active: desktopPrefs.hotkey_target === opt.id }"
                    @click="persistDesktopPrefs({ hotkey_target: opt.id })"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">快速新建浮窗创建后自动隐藏</span>
                  <span class="row-desc">关闭后可在悬浮窗内连续录入多条日程</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="desktopPrefs.quick_add_auto_hide"
                  aria-label="快速新建自动隐藏"
                  class="switch-btn"
                  :class="{ checked: desktopPrefs.quick_add_auto_hide }"
                  @click="persistDesktopPrefs({ quick_add_auto_hide: !desktopPrefs.quick_add_auto_hide })"
                >
                  <span class="switch-thumb"></span>
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">快速唤起全局热键</span>
                  <span class="row-desc">如 CmdOrCtrl+Alt+A、Ctrl+Shift+Space（留空则禁用）</span>
                </div>
                <div class="dnd-controls-row">
                  <input
                    v-model="desktopPrefs.quick_add_hotkey"
                    type="text"
                    class="dnd-time-input"
                    style="width: 150px"
                    placeholder="CmdOrCtrl+Alt+A"
                    aria-label="快速唤起热键"
                    @change="persistDesktopPrefs({ quick_add_hotkey: desktopPrefs.quick_add_hotkey }, '已更新快速唤起全局快捷键')"
                  />
                </div>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">速览浮窗 / 专注浮窗全局热键</span>
                  <span class="row-desc">可选：为今日速览浮窗与番茄专注浮窗分别绑定全局快捷键</span>
                </div>
                <div class="dnd-controls-row">
                  <input
                    v-model="desktopPrefs.tray_popover_hotkey"
                    type="text"
                    class="dnd-time-input"
                    style="width: 126px"
                    placeholder="速览: 如 Alt+S"
                    aria-label="速览浮窗全局热键"
                    @change="persistDesktopPrefs({ tray_popover_hotkey: desktopPrefs.tray_popover_hotkey }, '已更新速览浮窗热键')"
                  />
                  <input
                    v-model="desktopPrefs.focus_hotkey"
                    type="text"
                    class="dnd-time-input"
                    style="width: 126px"
                    placeholder="专注: 如 Alt+F"
                    aria-label="专注浮窗全局热键"
                    @change="persistDesktopPrefs({ focus_hotkey: desktopPrefs.focus_hotkey }, '已更新专注浮窗热键')"
                  />
                </div>
              </div>

              <div v-if="desktopStatus?.hotkey_error" class="inline-feedback" style="color: var(--danger);">
                热键注册异常: {{ desktopStatus.hotkey_error }}
              </div>

              <div class="card-row card-row-stacked">
                <div class="row-copy">
                  <span class="row-title">多窗口快速启动</span>
                  <span class="row-desc">在独立桌面窗口中并行使用专注计时、AI 副驾驶或独立视图</span>
                </div>
                <div class="export-btns quick-launch-btns">
                  <button type="button" class="btn-outline" @click="handleLaunchWindow('quick-add')">
                    <DesktopIcon name="bolt" :size="13" />
                    <span>快速新建</span>
                  </button>
                  <button type="button" class="btn-outline" @click="handleLaunchWindow('tray-popover')">
                    <DesktopIcon name="popover" :size="13" />
                    <span>今日速览</span>
                  </button>
                  <button type="button" class="btn-outline" @click="handleLaunchWindow('focus')">
                    <DesktopIcon name="timer" :size="13" />
                    <span>专注浮窗</span>
                  </button>
                  <button type="button" class="btn-outline" @click="handleLaunchWindow('ai')">
                    <DesktopIcon name="sparkle" :size="13" />
                    <span>AI 窗口</span>
                  </button>
                  <button type="button" class="btn-outline" @click="handleLaunchWindow('workspace', 'week')">
                    <DesktopIcon name="calendar" :size="13" />
                    <span>周计划窗</span>
                  </button>
                  <button type="button" class="btn-outline" @click="handleLaunchWindow('workspace', 'matrix')">
                    <DesktopIcon name="grid" :size="13" />
                    <span>矩阵窗</span>
                  </button>
                  <button type="button" class="btn-outline" @click="handleHideAllAuxWindows">
                    <DesktopIcon name="windows-hide" :size="13" />
                    <span>隐藏全浮窗</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- Open Windows Live Inspector -->
            <div v-if="desktopStatus?.windows?.length" class="studio-card padded-card">
              <div class="windows-section-head">
                <div class="group-caption" style="margin: 0;">
                  当前窗口实例（{{ desktopStatus.windows.length }} · 已自动记忆各窗口位置与尺寸）
                </div>
                <button type="button" class="pill-action-btn" @click="handleResetAllWindowBounds">
                  重置全部位置
                </button>
              </div>
              <div class="windows-list">
                <div v-for="w in desktopStatus.windows" :key="w.name" class="window-row">
                  <div class="window-row-info">
                    <span class="win-status-dot" :class="{ visible: w.visible }"></span>
                    <strong>{{ w.title }}</strong>
                    <span class="meta-pill">{{ w.visible ? '显示中' : '隐藏后台' }}</span>
                    <span v-if="w.always_on_top" class="meta-pill accent">置顶</span>
                  </div>
                  <div class="window-row-actions">
                    <button type="button" class="pill-action-btn" @click="FocusDesktopWindow(w.name)">聚焦</button>
                    <button type="button" class="pill-action-btn" @click="handleToggleWinAlwaysOnTop(w.name, w.always_on_top)">
                      {{ w.always_on_top ? '取消置顶' : '置顶' }}
                    </button>
                    <button type="button" class="pill-action-btn" title="居中并重置保存的位置" @click="handleResetWindowBounds(w.name)">
                      居中重置
                    </button>
                    <button
                      v-if="w.name !== 'main'"
                      type="button"
                      class="pill-action-btn"
                      @click="CloseDesktopWindow(w.name)"
                    >
                      隐藏/关闭
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Recent Background Delivery Feed -->
            <div class="studio-card padded-card">
              <div class="group-caption" style="margin-bottom: 10px;">
                最近后台守护投递流水（{{ recentDeliveries.length }}）
              </div>
              <div v-if="recentDeliveries.length === 0" class="row-desc">暂无后台投递记录</div>
              <div v-else class="delivery-feed-list">
                <div v-for="rec in recentDeliveries" :key="rec.id" class="delivery-feed-row">
                  <div class="delivery-feed-copy">
                    <strong>{{ rec.reminder_title || rec.reminder_id }}</strong>
                    <span>{{ rec.prompt }}</span>
                  </div>
                  <div class="delivery-feed-meta">
                    <span class="meta-pill" :class="deliveryStatusMeta(rec.status).cls">
                      {{ deliveryStatusMeta(rec.status).label }}
                    </span>
                    <small class="tabular-nums">{{ rec.delivered_at.slice(5, 16).replace('T', ' ') }}</small>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- ==================== 3. AI MODEL CONFIG ==================== -->
          <template v-else-if="activeTab === 'ai'">
            <div class="ai-status-banner">
              <div class="ai-status-dot" :class="{ ready: aiAPIKey.trim().length > 0 }"></div>
              <div class="row-copy" style="flex: 1; min-width: 0;">
                <span class="row-title">{{ aiAPIKey.trim() ? 'AI 已就绪' : '未配置 API Key' }}</span>
                <span class="row-desc truncate-text">{{ aiModel || '未填模型' }} · {{ aiBaseURL || '未填地址' }}</span>
              </div>
              <div class="ai-preset-chips">
                <button
                  v-for="p in aiPresets"
                  :key="p.id"
                  type="button"
                  class="pill-action-btn"
                  :title="`填充 ${p.label} 默认配置`"
                  @click="applyAIPreset(p.url, p.model, p.label)"
                >
                  {{ p.label }}
                </button>
              </div>
            </div>

            <div class="studio-card padded-card">
              <div class="form-stack">
                <div class="form-row">
                  <label class="field-label">接口地址 (Base URL)</label>
                  <input
                    v-model="aiBaseURL"
                    type="text"
                    class="form-input"
                    placeholder="https://api.deepseek.com/v1"
                  />
                </div>

                <div class="form-row">
                  <label class="field-label">API Key</label>
                  <div class="secret-input-wrap">
                    <input
                      v-model="aiAPIKey"
                      :type="showAPIKey ? 'text' : 'password'"
                      class="form-input"
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      class="reveal-key-btn"
                      @click="showAPIKey = !showAPIKey"
                    >
                      {{ showAPIKey ? '隐藏' : '显示' }}
                    </button>
                  </div>
                </div>

                <div class="form-row">
                  <label class="field-label">模型</label>
                  <input
                    v-model="aiModel"
                    type="text"
                    class="form-input"
                    placeholder="deepseek-chat / gpt-4o-mini"
                  />
                </div>

                <div class="ai-actions-row">
                  <button type="button" class="btn-outline" :disabled="isTestingAI" @click="handleTestAI">
                    {{ isTestingAI ? '测试中...' : '测试连接' }}
                  </button>
                  <button type="button" class="btn-solid" @click="handleSaveAI">保存</button>
                </div>

                <div v-if="testResult" class="test-feedback" :class="{ success: testSuccess }">
                  {{ testResult }}
                </div>
              </div>
            </div>
          </template>

          <!-- ==================== 4. DATA & SAFETY ==================== -->
          <template v-else-if="activeTab === 'data'">
            <div class="data-kpi-row">
              <div class="kpi-tile">
                <span class="kpi-label">日程总数</span>
                <strong class="kpi-val tabular-nums">{{ reminders?.length || 0 }} 条</strong>
              </div>
              <div class="kpi-tile">
                <span class="kpi-label">数据库</span>
                <strong class="kpi-val">SQLite WAL</strong>
              </div>
              <div class="kpi-tile">
                <span class="kpi-label">存储路径</span>
                <strong class="kpi-val mono">~/.agenda/agenda.db</strong>
              </div>
            </div>

            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">数据库快照</span>
                  <span class="row-desc">生成带时间戳的 SQLite 物理备份</span>
                </div>
                <button type="button" class="btn-outline" :disabled="isBackingUp" @click="handleBackupDB">
                  {{ isBackingUp ? '备份中...' : '立即备份' }}
                </button>
              </div>
              <div v-if="backupPath" class="inline-feedback success">
                已备份至: {{ backupPath }}
              </div>

              <div class="card-row vertical-mobile">
                <div class="row-copy">
                  <span class="row-title">导入与导出</span>
                  <span class="row-desc">支持 JSON 备份恢复、Markdown 与 CSV</span>
                </div>
                <div class="export-btns">
                  <button type="button" class="btn-outline" @click="handleExportJSON">导出 JSON</button>
                  <button type="button" class="btn-outline" @click="triggerImportJSON">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>恢复 JSON</span>
                  </button>
                  <button type="button" class="btn-outline" @click="handleExportMD">Markdown</button>
                  <button type="button" class="btn-outline" @click="handleExportCSV">CSV</button>
                  <input
                    ref="jsonFileInputRef"
                    type="file"
                    accept=".json,application/json"
                    style="display: none"
                    @change="onJSONFileSelected"
                  />
                </div>
              </div>
            </div>

            <div class="studio-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">数据库整理</span>
                  <span class="row-desc">检查完整性并回收碎片空间</span>
                </div>
                <button type="button" class="btn-outline" :disabled="isOptimizingDB" @click="handleOptimizeDB">
                  {{ isOptimizingDB ? '整理中...' : '开始整理' }}
                </button>
              </div>
              <div v-if="dbOptimizeResult" class="inline-feedback success">
                {{ dbOptimizeResult }}
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">废纸篓</span>
                  <span class="row-desc">查看或恢复已删除的历史日程</span>
                </div>
                <button type="button" class="btn-outline" @click="$emit('open-trash')">打开</button>
              </div>
            </div>

            <div class="studio-card danger-card">
              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">归档旧日程</span>
                  <span class="row-desc">清理 30 天前已结束的日程</span>
                </div>
                <button
                  type="button"
                  class="btn-outline danger-btn"
                  :class="{ armed: destructiveConfirm === 'archive' }"
                  :disabled="isArchiving"
                  @click="handleArchive"
                >
                  {{ isArchiving ? '归档中…' : destructiveConfirm === 'archive' ? '确认清理' : '清理 30 天前' }}
                </button>
              </div>

              <div class="card-row">
                <div class="row-copy">
                  <span class="row-title">清空通知记录</span>
                  <span class="row-desc">清除已保存的投递历史流水</span>
                </div>
                <button
                  type="button"
                  class="btn-outline danger-btn"
                  :class="{ armed: destructiveConfirm === 'history' }"
                  :disabled="isClearingHistory"
                  @click="handleClearHistory"
                >
                  {{ isClearingHistory ? '清空中…' : destructiveConfirm === 'history' ? '确认清空' : '清空记录' }}
                </button>
              </div>
            </div>
          </template>

          <!-- ==================== 5. ABOUT & SHORTCUTS ==================== -->
          <template v-else-if="activeTab === 'about'">
            <div class="about-hero">
              <div class="about-logo-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="21" height="21">
                  <rect x="3" y="4" width="18" height="17" rx="3" />
                  <path d="M8 2v4M16 2v4M3 10h18M9 15l2 2 4-4" />
                </svg>
              </div>
              <div>
                <h4>Agenda Butler AI · 日程管家</h4>
                <p>Wails 3 + Go + SQLite + Vue 3 桌面日程终端</p>
              </div>
            </div>

            <div class="studio-card padded-card">
              <div class="group-caption" style="margin-bottom: 10px;">技术信息</div>
              <div class="tech-grid">
                <div class="tech-item">
                  <span class="tech-label">内核</span>
                  <span class="tech-val">Wails v3.1.0</span>
                </div>
                <div class="tech-item">
                  <span class="tech-label">前端</span>
                  <span class="tech-val">Vue 3 + TypeScript</span>
                </div>
                <div class="tech-item">
                  <span class="tech-label">构建</span>
                  <span class="tech-val">Vite 8</span>
                </div>
                <div class="tech-item">
                  <span class="tech-label">后端</span>
                  <span class="tech-val">Golang 1.27</span>
                </div>
                <div class="tech-item">
                  <span class="tech-label">数据库</span>
                  <span class="tech-val">SQLite (modernc.org)</span>
                </div>
                <div class="tech-item">
                  <span class="tech-label">存储路径</span>
                  <span class="tech-val">~/.agenda/agenda.db</span>
                </div>
              </div>
            </div>

            <div class="studio-card padded-card">
              <div class="group-caption" style="margin-bottom: 10px;">快捷键</div>
              <div class="shortcut-grid">
                <div v-for="sc in shortcutList" :key="sc.keys" class="shortcut-cell">
                  <span class="shortcut-desc">{{ sc.label }}</span>
                  <kbd class="shortcut-kbd">{{ sc.keys }}</kbd>
                </div>
              </div>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-scrim);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-overlay);
  padding: 16px;
}

.settings-shell {
  position: relative;
  width: 860px;
  max-width: 95vw;
  height: min(640px, 88vh);
  border-radius: 18px;
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* ==================== LEFT NAVIGATION RAIL ==================== */
.settings-rail {
  display: flex;
  flex-direction: column;
  padding: 18px 11px 14px;
  border-right: 1px solid var(--border-subtle);
  background:
    radial-gradient(120% 50% at 10% 0%, var(--accent-soft), transparent 70%),
    color-mix(in srgb, var(--surface) 68%, var(--surface-raised));
  min-height: 0;
}

.rail-header {
  padding: 2px 8px 14px;
}

.settings-eyebrow {
  display: block;
  font: 700 9.5px/1.2 var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--tide-text);
  margin-bottom: 3px;
}

.rail-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.rail-nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  overflow-y: auto;
}

.rail-tab {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.rail-tab:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

.rail-tab.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--text-primary);
}

.rail-tab-icon {
  width: 16px;
  height: 16px;
  display: inline-grid;
  place-items: center;
  color: var(--text-tertiary);
  flex: none;
}

.rail-tab.active .rail-tab-icon {
  color: var(--tide-text);
}

.rail-tab-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

.rail-tab-meta {
  font: 600 10.5px/1 var(--font-mono);
  color: var(--text-tertiary);
}

.rail-tab.active .rail-tab-meta {
  color: var(--tide-text);
}

.rail-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning);
  flex: none;
}

.rail-dot.ready {
  background: var(--success);
}

.rail-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rail-theme-pill {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.rail-theme-pill:hover {
  border-color: var(--accent-border);
  background: var(--fill-hover);
}

.rail-swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 0 1px var(--border-strong);
}

.rail-theme-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rail-polarity-svg {
  color: var(--tide-text);
  flex: none;
}

.rail-esc-hint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  font-size: 10.5px;
  color: var(--text-quaternary);
}

.rail-esc-hint kbd {
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  font: 600 10px var(--font-mono);
  color: var(--text-tertiary);
}

/* ==================== RIGHT WORKSPACE ==================== */
.settings-workspace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background:
    radial-gradient(65% 32% at 92% 0%, color-mix(in srgb, var(--tide) 7%, transparent), transparent 70%),
    var(--surface-raised);
}

.workspace-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 24px 13px;
  border-bottom: 1px solid var(--border-subtle);
}

.workspace-heading h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
}

.workspace-heading p {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.workspace-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.workspace-body > * {
  flex: none;
}

/* ==================== GROUPED STUDIO CARDS ==================== */
.studio-card {
  flex: none;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--fill-subtle) 75%, var(--surface-raised));
  overflow: visible;
}

.studio-card.padded-card {
  padding: 14px 16px;
}

.studio-card.danger-card {
  border-color: color-mix(in srgb, var(--danger) 28%, var(--border-subtle));
}

.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
}

.card-row.card-row-stacked {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.card-row + .card-row {
  border-top: 1px solid var(--border-subtle);
}

.card-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 6px;
}

.row-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 140px;
}

.row-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.row-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.truncate-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-controls {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

/* ==================== SEGMENTED CONTROLS & SWITCHES ==================== */
.segmented-control {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  flex: none;
}

.seg-btn {
  height: 24px;
  padding: 0 11px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--motion-fast);
}

.segmented-control.compact .seg-btn {
  height: 22px;
  padding: 0 9px;
  font-size: 10.5px;
}

.seg-btn:hover {
  color: var(--text-primary);
}

.seg-btn.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--tide-text);
}

.switch-btn {
  position: relative;
  width: 38px;
  height: 22px;
  padding: 2px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--fill-subtle);
  cursor: pointer;
  flex: none;
  transition: background var(--motion-fast), border-color var(--motion-fast);
}

.switch-btn.checked {
  background: var(--accent);
  border-color: var(--accent);
}

.switch-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-secondary);
  transition: transform var(--motion-fast), background var(--motion-fast);
}

.switch-btn.checked .switch-thumb {
  transform: translateX(16px);
  background: var(--ink-on-accent, #ffffff);
}

/* ==================== THEME HERO & STUDIO ==================== */
.active-theme-hero {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 15px;
  border-radius: 12px;
  border: 1px solid var(--accent-border);
  background: linear-gradient(112deg, var(--accent-soft), var(--surface-raised) 74%);
}

.active-theme-swatch {
  display: inline-grid;
  grid-auto-flow: column;
  width: 44px;
  height: 30px;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  flex: none;
}

.active-theme-swatch span,
.active-theme-swatch .hero-swatch-btn {
  display: block;
  height: 100%;
  padding: 0;
  border: 0;
  cursor: pointer;
}

.active-theme-swatch .hero-swatch-btn:hover {
  filter: brightness(1.1);
}

.active-theme-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.active-theme-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.active-theme-title-row strong {
  font-size: 13.5px;
  font-weight: 800;
  color: var(--text-primary);
}

.meta-pill {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font: 700 9.5px/1.3 var(--font-mono);
}

.meta-pill.accent {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}

.hero-poem {
  margin: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hero-quick-btns {
  display: flex;
  gap: 6px;
  flex: none;
}

.pill-action-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all var(--motion-fast);
}

.pill-action-btn:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-on-accent);
}

.pill-action-btn.danger-subtle {
  border-color: var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
}

.pill-action-btn.danger-subtle:hover {
  border-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

/* ==================== ACCENT STUDIO ==================== */
.custom-color-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.custom-color-trigger:hover {
  border-color: var(--accent-border);
  color: var(--text-primary);
}

.native-color-picker {
  width: 15px;
  height: 15px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.accent-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 6px 16px 14px;
}

.accent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.accent-chip:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.accent-chip.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}

.accent-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--text-primary) 24%, transparent);
  flex: none;
}

.accent-dot.is-default {
  background: conic-gradient(from 0deg, #2e86de, #2ba87c, #d9483b, #d4941e, #2e86de);
}

/* ==================== THEME GALLERY ==================== */
.gallery-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gallery-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.gallery-quick-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.seasonal-tea-note {
  font-size: 11px;
  color: var(--text-tertiary);
}

.quick-btn-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.theme-search-input {
  height: 28px;
  width: 175px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
}

.theme-search-input:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.group-caption {
  font: 700 10.5px/1.2 var(--font-mono);
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.theme-card {
  padding: 9px 11px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  transition: all var(--motion-fast);
}

.theme-card:hover {
  background: var(--fill-hover);
  border-color: var(--border-strong);
}

.theme-card.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent-border);
}

.theme-preview {
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-swatch-stack {
  display: inline-grid;
  grid-template-columns: repeat(3, 5px);
  height: 11px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  flex-shrink: 0;
}

.theme-swatch-stack i {
  display: block;
  height: 100%;
}

.theme-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-fav-star {
  font-size: 12px;
  color: var(--text-quaternary);
  opacity: 0.45;
  padding: 0 2px;
  margin-left: auto;
  transition: opacity var(--motion-fast), color var(--motion-fast);
}

.theme-card:hover .card-fav-star,
.card-fav-star.active {
  opacity: 1;
}

.card-fav-star.active {
  color: var(--warning);
}

.theme-region-badge {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font: 700 9px var(--font-mono);
  flex: none;
}

.theme-desc {
  font-size: 10.5px;
  color: var(--text-tertiary);
  line-height: 1.35;
}

.mini-pair-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  flex: none;
}

.contrast-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  font: 700 9px/1.3 var(--font-mono);
  vertical-align: middle;
}

.contrast-badge.aaa,
.contrast-badge.aa {
  border-color: color-mix(in srgb, var(--success) 38%, transparent);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

.accent-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.recent-themes-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 7px 11px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
}

.recent-strip-label {
  font: 700 9.5px var(--font-mono);
  color: var(--text-quaternary);
  flex: none;
}

.recent-strip-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.recent-theme-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.recent-theme-chip:hover {
  border-color: var(--accent-border);
  color: var(--text-primary);
}

.recent-theme-chip.active {
  border-color: var(--tide);
  background: var(--accent-soft);
  color: var(--tide-text);
}

.recent-swatch {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  flex: none;
}

.gallery-right-filters {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.theme-mini-canvas {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 16px;
  padding: 0 7px;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
}

.mini-bar {
  width: 24px;
  height: 4px;
  border-radius: 999px;
}

.mini-bar.short {
  width: 14px;
  opacity: 0.85;
}

.mini-season-tag,
.mini-sound-tag {
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.2);
  color: rgba(255, 255, 255, 0.88);
  font: 700 8.5px/1.35 var(--font-mono);
}

.mini-season-tag {
  margin-left: auto;
}

.mini-sound-tag:first-of-type {
  margin-left: auto;
}

.mini-season-tag + .mini-sound-tag {
  margin-left: 0;
}

.theme-mini-canvas.is-light-bg .mini-season-tag,
.theme-mini-canvas.is-light-bg .mini-sound-tag {
  background: rgba(20, 24, 30, 0.1);
  color: #1f242c;
}

.empty-filter-state {
  padding: 20px;
  border-radius: 10px;
  border: 1px dashed var(--border-subtle);
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
}

.theme-config-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px dashed var(--border-subtle);
  background: var(--fill-subtle);
}

.theme-config-hint {
  font-size: 11px;
  color: var(--text-tertiary);
}

.theme-config-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.theme-import-drawer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
}

.theme-config-textarea {
  width: 100%;
  min-height: 82px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  color: var(--text-primary);
  font: 11px/1.45 var(--font-mono);
  resize: vertical;
  outline: none;
}

.theme-config-textarea:focus {
  border-color: var(--accent-border);
}

.theme-import-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ==================== BUTTONS & INPUTS ==================== */
.btn-outline {
  height: 28px;
  padding: 0 11px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  color: var(--text-primary);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all var(--motion-fast);
}

.btn-outline:hover:not(:disabled) {
  border-color: var(--accent-border);
  background: var(--fill-hover);
}

.btn-outline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-outline.danger-btn {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
}

.btn-outline.danger-btn:hover:not(:disabled),
.btn-outline.danger-btn.armed {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  border-color: var(--danger);
}

.btn-solid {
  height: 30px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--accent);
  color: var(--ink-on-accent);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--motion-fast);
}

.btn-solid:hover {
  background: var(--accent-hover);
}

/* ==================== SOUND & DND ==================== */
.volume-slider-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.volume-range-slider {
  width: 136px;
  height: 5px;
  accent-color: var(--accent);
  cursor: pointer;
}

.volume-value {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  min-width: 34px;
  text-align: right;
}

.dnd-controls-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  flex: 0 1 auto;
}

.dnd-time-input {
  background: var(--input-bg);
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  color: var(--text-primary);
  padding: 3px 8px;
  font: 600 11px var(--font-mono);
}

.dnd-sep {
  font-size: 11px;
  color: var(--text-tertiary);
}

/* ==================== AI TAB ==================== */
.ai-status-banner {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 15px;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
}

.ai-status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--warning);
  flex: none;
}

.ai-status-dot.ready {
  background: var(--success);
  box-shadow: 0 0 8px color-mix(in srgb, var(--success) 65%, transparent);
}

.ai-preset-chips {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 11.5px;
  color: var(--text-secondary);
  font-weight: 600;
}

.form-input {
  width: 100%;
  height: 34px;
  padding: 0 11px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 12.5px;
  outline: none;
  transition: all var(--motion-fast);
}

.form-input:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.secret-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.secret-input-wrap .form-input {
  padding-right: 54px;
}

.reveal-key-btn {
  position: absolute;
  right: 6px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 10.5px;
  cursor: pointer;
}

.reveal-key-btn:hover {
  color: var(--text-primary);
}

.ai-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
}

.test-feedback,
.inline-feedback {
  font-size: 11.5px;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  color: var(--danger);
  word-break: break-all;
  line-height: 1.4;
}

.inline-feedback {
  margin: 0 16px 12px;
}

.test-feedback.success,
.inline-feedback.success {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
  color: var(--success);
}

/* ==================== DATA & ABOUT ==================== */
.data-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.kpi-tile {
  padding: 11px 13px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-label {
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.kpi-val {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-val.mono {
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.export-btns {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.export-btns.quick-launch-btns {
  justify-content: flex-start;
  width: 100%;
  gap: 8px;
}

.about-hero {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--accent-border);
  background: linear-gradient(110deg, var(--accent-soft), var(--surface-raised) 70%);
}

.about-logo-badge {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: var(--accent);
  color: var(--ink-on-accent);
  display: grid;
  place-items: center;
  flex: none;
}

.about-hero h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: var(--text-primary);
}

.about-hero p {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.tech-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.tech-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tech-label {
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.tech-val {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
}

.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
}

.shortcut-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
}

.shortcut-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
}

.shortcut-kbd {
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  background: var(--surface-raised);
  font: 700 10.5px var(--font-mono);
  color: var(--tide-text);
}

/* ==================== RESPONSIVE FALLBACK ==================== */
@media (max-width: 720px) {
  .settings-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
    height: min(720px, 92vh);
  }
  .settings-rail {
    border-right: 0;
    border-bottom: 1px solid var(--border-subtle);
    padding: 12px;
  }
  .rail-header,
  .rail-footer {
    display: none;
  }
  .rail-nav {
    flex-direction: row;
    overflow-x: auto;
  }
  .rail-tab {
    width: auto;
    flex: none;
  }
  .theme-grid,
  .data-kpi-row,
  .shortcut-grid {
    grid-template-columns: 1fr;
  }
  .card-row {
    flex-direction: column;
    align-items: flex-start;
  }
  .export-btns {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}

.windows-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.windows-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.window-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
}

.window-row-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.window-row-info strong {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-primary);
}

.win-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-quaternary);
  flex-shrink: 0;
}

.win-status-dot.visible {
  background: var(--success);
  box-shadow: 0 0 8px color-mix(in srgb, var(--success) 55%, transparent);
}

.window-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.delivery-feed-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.delivery-feed-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 9px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
}

.delivery-feed-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.delivery-feed-copy strong {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delivery-feed-copy span {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delivery-feed-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  flex-shrink: 0;
}

.delivery-feed-meta small {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-quaternary);
}

.meta-pill.ok {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
}

.meta-pill.info {
  color: var(--tide-text);
  border-color: var(--accent-border);
}

.meta-pill.warn {
  color: var(--warning);
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
}
</style>
