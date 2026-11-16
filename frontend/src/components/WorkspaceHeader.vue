<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Events } from '@wailsio/runtime';
import {
  CloseDesktopWindow,
  FocusDesktopWindow,
  GetDesktopRuntimeStatus,
  HideAllAuxiliaryWindows,
  PauseSchedulerFor,
  ResetAllDesktopWindowBounds,
  SetDesktopWindowAlwaysOnTop,
  SetSchedulerPaused,
} from '../../bindings/agenda/internal/agenda/agendaservice';
import type { DesktopRuntimeStatus } from '../../bindings/agenda/internal/agenda/models';
import type { AgendaView } from '../types/ui';
import {
  CANVAS_INTENSITY_LABELS,
  THEME_AUTO_MODE_LABELS,
  THEME_DEFINITIONS,
  applyThemeToDocument,
  cycleCanvasIntensity,
  filterThemes,
  getCanvasIntensity,
  getFavoriteThemeIds,
  getRecentThemeIds,
  getShanshuiThemes,
  getThemeDefinition,
  normalizeThemeId,
  toggleFavoriteThemeId,
  type CanvasIntensity,
  type ThemeAutoMode,
  type ThemeFilterCategory,
} from '../utils/themes';
import {
  getApproxSolarTerm,
  getChineseShichen,
  getRecommendedShanshuiThemeForTime,
  getSeasonalAtmosphere,
  getSeasonalShanshuiRecommendation,
} from '../utils/shanshui';
import DesktopIcon from './DesktopIcon.vue';
import GlassTabs, { type GlassTabItem } from './GlassTabs.vue';
import {
  focusDisplayClock,
  focusEngineState,
  hasLiveFocusActivity,
  toggleFocusTimer,
} from '../utils/focusEngine';

const props = defineProps<{
  currentView: AgendaView;
  activeFilter: string;
  filterOverdueOnly: boolean;
  selectedTag: string | null;
  selectedDate: string | null;
  searchQuery: string;
  itemCount: number;
  isCompactMode: boolean;
  isSidebarCollapsed?: boolean;
  isMac?: boolean;
  isFullscreen?: boolean;
  currentTheme?: string;
  themeMode?: ThemeAutoMode;
  isSecondaryWorkspace?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:searchQuery', val: string): void;
  (e: 'change-view', view: AgendaView): void;
  (e: 'export-ics'): void;
  (e: 'import-ics', content: string): void;
  (e: 'export-csv'): void;
  (e: 'import-csv', content: string): void;
  (e: 'test-notify'): void;
  (e: 'toggle-compact'): void;
  (e: 'open-create'): void;
  (e: 'clear-date-filter'): void;
  (e: 'clear-tag-filter'): void;
  (e: 'open-palette'): void;
  (e: 'toggle-sidebar'): void;
  (e: 'refresh-data'): void;
  (e: 'select-theme', themeId: string): void;
  (e: 'set-theme-mode', mode: ThemeAutoMode): void;
  (e: 'toggle-theme-polarity'): void;
  (e: 'cycle-theme', direction: 1 | -1): void;
  (e: 'open-solar-terms'): void;
  (e: 'open-focus'): void;
  (e: 'open-window', kind: string, param?: string): void;
  (e: 'open-desktop-settings'): void;
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const showActionMenu = ref(false);
const showThemeMenu = ref(false);
const showWindowMenu = ref(false);
const desktopRuntime = ref<DesktopRuntimeStatus | null>(null);
let unsubscribeDesktopEvt: (() => void) | null = null;

async function refreshDesktopRuntime() {
  try {
    desktopRuntime.value = await GetDesktopRuntimeStatus();
  } catch {
    // Ignore outside Wails runtime.
  }
}

const visibleAuxCount = computed(() =>
  (desktopRuntime.value?.windows || []).filter((w) => w.name !== 'main' && w.visible).length,
);

async function toggleHeaderSchedulerPaused() {
  const paused = Boolean(desktopRuntime.value?.scheduler?.paused);
  try {
    await SetSchedulerPaused(!paused);
    await refreshDesktopRuntime();
  } catch {
    // Ignore errors.
  }
}

async function pauseHeaderSchedulerFor(minutes: number) {
  try {
    await PauseSchedulerFor(minutes);
    await refreshDesktopRuntime();
  } catch {
    // Ignore errors.
  }
}

async function handleResetAllWindowBoundsFromHub() {
  try {
    await ResetAllDesktopWindowBounds();
    await refreshDesktopRuntime();
  } catch {
    // Ignore errors.
  }
}

const headerPausedRemainingText = computed(() => {
  const sec = desktopRuntime.value?.scheduler?.paused_remaining_sec || 0;
  if (sec <= 0) return '';
  const mins = Math.ceil(sec / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  return `${mins}m`;
});

async function handleHideAllAux() {
  try {
    await HideAllAuxiliaryWindows();
    await refreshDesktopRuntime();
    showWindowMenu.value = false;
  } catch {
    // Ignore errors.
  }
}

watch(showWindowMenu, (open) => {
  if (open) void refreshDesktopRuntime();
});
const themeMenuFilter = ref<ThemeFilterCategory>('all');
const themeMenuSearch = ref('');
const favoriteThemeIds = ref<string[]>(getFavoriteThemeIds());
const recentThemeIds = ref<string[]>(getRecentThemeIds());
const canvasIntensity = ref<CanvasIntensity>(getCanvasIntensity());
const isPreviewActive = ref(false);
const menuHighlightIdx = ref(0);
const themeListScrollRef = ref<HTMLElement | null>(null);

const allThemes = THEME_DEFINITIONS;
const shanshuiThemes = getShanshuiThemes();
const normalizedTheme = computed(() => normalizeThemeId(props.currentTheme));
const activeThemeDef = computed(() => getThemeDefinition(normalizedTheme.value));
const activeModeKey = computed<ThemeAutoMode>(() => props.themeMode || 'manual');
const activeModeLabel = computed(() => THEME_AUTO_MODE_LABELS[activeModeKey.value]);
const recentMenuThemes = computed(() =>
  recentThemeIds.value
    .map((id) => getThemeDefinition(id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t)),
);

const filteredMenuThemes = computed(() =>
  filterThemes({
    category: themeMenuFilter.value,
    query: themeMenuSearch.value,
    favoriteIds: favoriteThemeIds.value,
  }),
);

const themeFilterTabs: Array<{ id: ThemeFilterCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'shanshui', label: '山水' },
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'fav', label: '收藏' },
];

const autoModeItems: Array<{ id: ThemeAutoMode; short: string; title: string }> = [
  { id: 'manual', short: '固定', title: THEME_AUTO_MODE_LABELS.manual.desc },
  { id: 'circadian', short: '昼夜', title: THEME_AUTO_MODE_LABELS.circadian.desc },
  { id: 'seasonal', short: '四时', title: THEME_AUTO_MODE_LABELS.seasonal.desc },
  { id: 'system', short: '系统', title: THEME_AUTO_MODE_LABELS.system.desc },
];

function previewTheme(themeId: string) {
  isPreviewActive.value = true;
  applyThemeToDocument(themeId, { animate: false });
}

function restoreThemePreview() {
  if (!isPreviewActive.value) return;
  isPreviewActive.value = false;
  applyThemeToDocument(normalizedTheme.value, { animate: false });
}

function handleToggleFavoriteTheme(themeId: string) {
  favoriteThemeIds.value = toggleFavoriteThemeId(themeId);
}

function commitSelectTheme(themeId: string) {
  isPreviewActive.value = false;
  showThemeMenu.value = false;
  emit('select-theme', themeId);
}

function commitFirstFilteredTheme() {
  const list = filteredMenuThemes.value;
  const target = list[menuHighlightIdx.value] || list[0];
  if (target) commitSelectTheme(target.id);
}

function handleThemeSearchKeydown(event: KeyboardEvent) {
  const list = filteredMenuThemes.value;
  if (!list.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    menuHighlightIdx.value = (menuHighlightIdx.value + 1) % list.length;
    previewTheme(list[menuHighlightIdx.value].id);
    themeListScrollRef.value?.children[menuHighlightIdx.value]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    menuHighlightIdx.value = (menuHighlightIdx.value - 1 + list.length) % list.length;
    previewTheme(list[menuHighlightIdx.value].id);
    themeListScrollRef.value?.children[menuHighlightIdx.value]?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter') {
    event.preventDefault();
    commitFirstFilteredTheme();
  }
}

function pickRandomMenuTheme() {
  const pool = filteredMenuThemes.value.filter((t) => t.id !== normalizedTheme.value);
  const candidates = pool.length ? pool : allThemes.filter((t) => t.id !== normalizedTheme.value);
  const pick = candidates[Math.floor(Math.random() * candidates.length)] || allThemes[0];
  if (pick) commitSelectTheme(pick.id);
}

function handleCycleMenuCanvasIntensity() {
  canvasIntensity.value = cycleCanvasIntensity();
}

watch(filteredMenuThemes, () => {
  menuHighlightIdx.value = 0;
});

watch(showThemeMenu, (open) => {
  if (open) {
    favoriteThemeIds.value = getFavoriteThemeIds();
    recentThemeIds.value = getRecentThemeIds();
    canvasIntensity.value = getCanvasIntensity();
    menuHighlightIdx.value = 0;
  } else {
    restoreThemePreview();
    themeMenuSearch.value = '';
  }
});

const currentMoment = computed(() => {
  // 随主题或菜单显隐刷新当前节气与十二时辰意境
  showThemeMenu.value;
  const now = new Date();
  return {
    solar: getApproxSolarTerm(now),
    shichen: getChineseShichen(now),
    seasonal: getSeasonalAtmosphere(now),
  };
});

function selectAutoShanshuiTheme() {
  isPreviewActive.value = false;
  const recommended = getRecommendedShanshuiThemeForTime(new Date());
  emit('select-theme', recommended);
  showThemeMenu.value = false;
}

function selectSeasonalShanshuiTheme() {
  isPreviewActive.value = false;
  const recommended = getSeasonalShanshuiRecommendation(new Date());
  emit('select-theme', recommended);
  showThemeMenu.value = false;
}

const viewInfo = computed(() => {
  if (props.filterOverdueOnly) return { title: '已逾期', description: '需要重新安排或立即处理的日程' };
  if (props.selectedTag) return { title: `#${props.selectedTag}`, description: '标签筛选结果' };
  if (props.selectedDate) return { title: props.selectedDate, description: '指定日期的日程' };
  if (props.currentView === 'week') return { title: '周计划', description: '按时间安排未来七天' };
  if (props.currentView === 'month') return { title: '月历', description: '查看整月排期与密度' };
  if (props.currentView === 'matrix') return { title: '优先级矩阵', description: '按重要与紧急程度安排工作' };
  if (props.activeFilter === 'today') return { title: '今天', description: '今天需要推进的日程' };
  if (props.activeFilter === 'near') return { title: '即将到期', description: '未来 15 分钟内到期的日程' };
  if (props.activeFilter === 'paused') return { title: '已暂停', description: '暂时停止提醒的日程' };
  return { title: '全部日程', description: '计划、提醒与待办' };
});

const dateText = computed(() => new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', weekday: 'short',
}).format(new Date()));

const views: GlassTabItem[] = [
  { id: 'list', label: '列表', title: '列表视图 (1)' },
  { id: 'week', label: '周', title: '周计划视图 (2)' },
  { id: 'month', label: '月', title: '全景月历视图 (3)' },
  { id: 'matrix', label: '矩阵', title: '四象限矩阵 (4)' },
];

function handleViewSelect(viewId: string) {
  emit('change-view', viewId as AgendaView);
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ({ target }) => {
    const text = String(target?.result || '');
    if (text) {
      if (file.name.toLowerCase().endsWith('.csv')) emit('import-csv', text);
      else emit('import-ics', text);
    }
    input.value = '';
  };
  reader.readAsText(file);
}

function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (event.key === 'Escape' && (showActionMenu.value || showThemeMenu.value || showWindowMenu.value)) {
    event.preventDefault();
    event.stopPropagation();
    showActionMenu.value = false;
    showThemeMenu.value = false;
    showWindowMenu.value = false;
    return;
  }
  const isEditing =
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.tagName === 'SELECT' ||
    target?.isContentEditable;
  if (
    event.key === '/' &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !isEditing &&
    !document.querySelector('[role="dialog"]')
  ) {
    event.preventDefault();
    searchInputRef.value?.focus();
  }
}

function handlePointerDown(event: MouseEvent) {
  const el = event.target as HTMLElement | null;
  if (!el?.closest('.header-more-wrap')) showActionMenu.value = false;
  if (!el?.closest('.header-theme-wrap')) showThemeMenu.value = false;
  if (!el?.closest('.header-window-wrap')) showWindowMenu.value = false;
}

function syncHeaderThemeExtras() {
  favoriteThemeIds.value = getFavoriteThemeIds();
  recentThemeIds.value = getRecentThemeIds();
  canvasIntensity.value = getCanvasIntensity();
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('mousedown', handlePointerDown);
  window.addEventListener('agenda:favorite-themes-change', syncHeaderThemeExtras);
  window.addEventListener('agenda:recent-themes-change', syncHeaderThemeExtras);
  window.addEventListener('agenda:canvas-intensity-change', syncHeaderThemeExtras);
  void refreshDesktopRuntime();
  try {
    unsubscribeDesktopEvt = Events.On('desktop-status-updated', () => {
      void refreshDesktopRuntime();
    });
  } catch {
    // Ignore outside Wails runtime.
  }
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('mousedown', handlePointerDown);
  window.removeEventListener('agenda:favorite-themes-change', syncHeaderThemeExtras);
  window.removeEventListener('agenda:recent-themes-change', syncHeaderThemeExtras);
  window.removeEventListener('agenda:canvas-intensity-change', syncHeaderThemeExtras);
  unsubscribeDesktopEvt?.();
});

defineExpose({ focusSearch: () => searchInputRef.value?.focus() });
</script>

<template>
  <header class="workspace-header" :class="{ 'is-mac-windowed': isMac && !isFullscreen }">
    <div class="workspace-context">
      <button
        class="header-sidebar-toggle"
        type="button"
        :title="isSidebarCollapsed ? '展开侧栏 (⌘B)' : '收起侧栏 (⌘B)'"
        :aria-label="isSidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        @click="$emit('toggle-sidebar')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M9 4v16" />
        </svg>
      </button>

      <button class="titlebar-brand" type="button" title="刷新日程" @click="$emit('refresh-data')">
        <span class="titlebar-brand-mark" aria-hidden="true">
          <img src="/icon.svg" alt="" />
        </span>
        <span class="titlebar-brand-label">Agenda</span>
      </button>

      <span class="titlebar-sep" aria-hidden="true"></span>

      <div class="context-copy">
        <div class="context-title-row">
          <h1 :title="`${viewInfo.description} · ${dateText}`">{{ viewInfo.title }}</h1>
          <span class="item-count">{{ itemCount }}</span>
          <button
            v-if="isSecondaryWorkspace"
            type="button"
            class="active-filter"
            title="回到主工作台窗口"
            @click="$emit('open-window', 'main')"
          >
            <span>独立视图 · 主窗口</span>
            <DesktopIcon name="popout" :size="11" />
          </button>
          <button v-if="selectedDate" class="active-filter" type="button" @click="$emit('clear-date-filter')">{{ selectedDate }} <span>×</span></button>
          <button v-if="selectedTag" class="active-filter" type="button" @click="$emit('clear-tag-filter')">#{{ selectedTag }} <span>×</span></button>
        </div>
      </div>
    </div>

    <div class="header-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input ref="searchInputRef" type="search" :value="searchQuery" placeholder="搜索标题、备注、标签" aria-label="搜索日程" @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)" />
      <kbd v-if="!searchQuery">/</kbd>
      <button v-else type="button" title="清空搜索" aria-label="清空搜索" @click="$emit('update:searchQuery', '')">×</button>
    </div>

    <div class="header-actions">
      <button
        v-if="hasLiveFocusActivity"
        type="button"
        class="header-focus-pill"
        :class="{
          running: focusEngineState.isRunning,
          break: focusEngineState.mode !== 'focus',
        }"
        :title="`${focusEngineState.mode === 'focus' ? '专注中' : '休息中'}${focusEngineState.reminderTitle ? ' · ' + focusEngineState.reminderTitle : ''}（点击展开番茄专注窗口）`"
        @click="$emit('open-focus')"
      >
        <span class="focus-pill-dot" aria-hidden="true"></span>
        <span class="focus-pill-clock tabular-nums">{{ focusDisplayClock }}</span>
        <span
          class="focus-pill-toggle"
          role="button"
          tabindex="0"
          :title="focusEngineState.isRunning ? '暂停专注' : '继续专注'"
          :aria-label="focusEngineState.isRunning ? '暂停专注' : '继续专注'"
          @click.stop="toggleFocusTimer"
          @keydown.enter.stop.prevent="toggleFocusTimer"
        >
          <DesktopIcon :name="focusEngineState.isRunning ? 'pause' : 'play'" :size="10" :strokeWidth="2.1" />
        </span>
      </button>
      <GlassTabs
        :modelValue="currentView"
        :items="views"
        size="md"
        aria-label="切换视图"
        @update:modelValue="handleViewSelect"
      />
      <div class="header-theme-wrap">
        <button
          class="shanshui-picker-btn"
          type="button"
          :title="activeThemeDef?.poem ? `${activeThemeDef.name} · ${activeThemeDef.poem}（快捷键 ⇧T 昼夜互换 / { } 轮换）` : `${activeThemeDef?.name || '主题'}（快捷键 ⇧T 昼夜互换 / { } 轮换）`"
          :aria-expanded="showThemeMenu"
          @click="showThemeMenu = !showThemeMenu; showActionMenu = false"
        >
          <span v-if="activeThemeDef?.sealChar" class="shanshui-seal">{{ activeThemeDef.sealChar }}</span>
          <span v-else class="shanshui-swatch-trigger" :style="{ background: activeThemeDef?.color }"></span>
          <span class="shanshui-btn-label">{{ activeThemeDef?.group === 'shanshui' ? activeThemeDef.badge : (activeThemeDef?.isLight ? '晴石' : '主题') }}</span>
          <em v-if="activeModeKey !== 'manual'" class="theme-mode-badge">{{ activeModeLabel.short }}</em>
        </button>
        <div v-if="showThemeMenu" class="header-menu header-theme-menu">
          <div class="theme-menu-head">
            <span>主题美学 · {{ allThemes.length }} 境</span>
            <span class="theme-menu-moment" :title="`${currentMoment.solar.verse} · ${currentMoment.seasonal.teaSuggestion}`">
              {{ currentMoment.solar.name }} · {{ currentMoment.shichen.branch }}时
            </span>
          </div>

          <div class="theme-quick-toolbar">
            <button
              type="button"
              class="theme-quick-btn"
              title="一键明暗雅配互换 (快捷键 ⇧T)"
              @click="isPreviewActive = false; $emit('toggle-theme-polarity')"
            >
              <svg v-if="activeThemeDef?.isLight" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
              <span>{{ activeThemeDef?.isLight ? '深墨' : '浅宣' }}</span>
            </button>
            <button
              type="button"
              class="theme-quick-btn"
              :title="`循环背景意境浓度（当前：${CANVAS_INTENSITY_LABELS[canvasIntensity].label}）`"
              @click="handleCycleMenuCanvasIntensity"
            >
              <span>{{ CANVAS_INTENSITY_LABELS[canvasIntensity].label }}</span>
            </button>
            <button
              type="button"
              class="theme-quick-btn"
              title="随机切换主题"
              @click="pickRandomMenuTheme"
            >
              <span>随机</span>
            </button>
            <button
              type="button"
              class="theme-quick-btn"
              title="上一套主题 ({)"
              @click="isPreviewActive = false; $emit('cycle-theme', -1)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              class="theme-quick-btn"
              title="下一套主题 (})"
              @click="isPreviewActive = false; $emit('cycle-theme', 1)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div v-if="recentMenuThemes.length > 1" class="theme-recent-row" aria-label="最近使用主题">
            <span class="recent-row-label">最近</span>
            <button
              v-for="rt in recentMenuThemes"
              :key="rt.id"
              type="button"
              class="recent-dot-btn"
              :class="{ active: normalizedTheme === rt.id }"
              :title="rt.name"
              @mouseenter="previewTheme(rt.id)"
              @mouseleave="restoreThemePreview"
              @click="commitSelectTheme(rt.id)"
            >
              <span class="recent-dot-swatch" :style="{ background: rt.bgPreview, borderColor: rt.color }"></span>
              <span>{{ rt.sealChar || (rt.isLight ? '晴' : '夜') }}</span>
            </button>
          </div>

          <div class="theme-mode-row" role="group" aria-label="主题自适应模式">
            <button
              v-for="m in autoModeItems"
              :key="m.id"
              type="button"
              class="theme-mode-chip"
              :class="{ active: activeModeKey === m.id }"
              :title="m.title"
              @click="isPreviewActive = false; $emit('set-theme-mode', m.id)"
            >
              {{ m.short }}
            </button>
          </div>

          <div class="theme-filter-bar" role="tablist" aria-label="筛选主题分类">
            <button
              v-for="tab in themeFilterTabs"
              :key="tab.id"
              type="button"
              class="theme-filter-tab"
              :class="{ active: themeMenuFilter === tab.id }"
              @click="themeMenuFilter = tab.id"
            >
              {{ tab.id === 'fav' && favoriteThemeIds.length ? `${tab.label} ${favoriteThemeIds.length}` : tab.label }}
            </button>
          </div>

          <input
            v-model="themeMenuSearch"
            type="search"
            class="theme-menu-search"
            placeholder="搜山河、颜料、拼音或 ↑↓ 回车直选..."
            aria-label="搜索主题"
            @keydown="handleThemeSearchKeydown"
          />

          <div ref="themeListScrollRef" class="theme-list-scroll" @mouseleave="restoreThemePreview">
            <button
              v-for="(t, idx) in filteredMenuThemes"
              :key="t.id"
              type="button"
              class="theme-option-row"
              :class="{ 'is-active-view': normalizedTheme === t.id, 'is-kb-focus': idx === menuHighlightIdx }"
              :title="t.pigment ? `${t.pigment} · ${t.poem}` : t.desc"
              @mouseenter="menuHighlightIdx = idx; previewTheme(t.id)"
              @focus="menuHighlightIdx = idx; previewTheme(t.id)"
              @blur="restoreThemePreview"
              @click="commitSelectTheme(t.id)"
            >
              <span class="theme-menu-left">
                <span class="theme-tri-swatch" aria-hidden="true">
                  <i :style="{ background: t.bgPreview }"></i>
                  <i :style="{ background: t.color }"></i>
                  <i :style="{ background: t.secondaryColor || t.sealColor || t.color }"></i>
                </span>
                <span class="theme-option-name">{{ t.name }}</span>
                <em v-if="t.isLight" class="theme-tone-pill">浅</em>
              </span>
              <span class="theme-option-right">
                <span
                  class="theme-fav-dot"
                  :class="{ active: favoriteThemeIds.includes(t.id) }"
                  :title="favoriteThemeIds.includes(t.id) ? '取消收藏' : '收藏此主题'"
                  @click.stop="handleToggleFavoriteTheme(t.id)"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" :fill="favoriteThemeIds.includes(t.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </span>
                <span v-if="t.sealChar" class="shanshui-seal">{{ t.sealChar }}</span>
                <i v-else-if="normalizedTheme === t.id" class="theme-active-check">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </i>
              </span>
            </button>
            <div v-if="filteredMenuThemes.length === 0" class="theme-menu-empty">
              暂无匹配主题
            </div>
          </div>

          <div class="menu-separator"></div>
          <button
            type="button"
            class="theme-footer-action"
            :title="`${currentMoment.shichen.poeticHint} — 自动匹配当下晨昏光影`"
            @click="selectAutoShanshuiTheme"
          >
            <span class="menu-action-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
              <span>随晨昏光影换境</span>
            </span>
            <i>{{ currentMoment.shichen.alias }}</i>
          </button>
          <button
            type="button"
            class="theme-footer-action"
            :title="`${currentMoment.seasonal.auraLabel} · ${currentMoment.seasonal.teaSuggestion}`"
            @click="selectSeasonalShanshuiTheme"
          >
            <span class="menu-action-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
              </svg>
              <span>依四时物候入画</span>
            </span>
            <i>{{ currentMoment.solar.season }}季</i>
          </button>
          <button
            type="button"
            class="theme-footer-action"
            title="浏览四季流转与二十四节气天文交节、三候物候"
            @click="isPreviewActive = false; $emit('open-solar-terms'); showThemeMenu = false"
          >
            <span class="menu-action-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
              </svg>
              <span>廿四节气与四季图鉴</span>
            </span>
            <i>{{ currentMoment.solar.name }}</i>
          </button>
        </div>
      </div>
      <button class="command-button" type="button" title="命令面板 (⌘K)" @click="$emit('open-palette')"><span>命令</span><kbd>⌘K</kbd></button>

      <!-- Multi-Window & Background Daemon Popover -->
      <div class="header-window-wrap">
        <button
          class="window-hub-button"
          type="button"
          :class="{ paused: desktopRuntime?.scheduler?.paused, hasAux: visibleAuxCount > 0 }"
          title="多窗口与后台守护中心"
          :aria-expanded="showWindowMenu"
          @click="showWindowMenu = !showWindowMenu; showThemeMenu = false; showActionMenu = false"
        >
          <span class="hub-status-dot" aria-hidden="true"></span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <path d="M7 20h12a2 2 0 0 0 2-2V8" />
          </svg>
          <span v-if="visibleAuxCount > 0" class="hub-aux-count tabular-nums">{{ visibleAuxCount }}</span>
        </button>

        <div v-if="showWindowMenu" class="header-menu header-window-menu">
          <div class="win-hub-head">
            <div class="win-hub-status" :class="{ paused: desktopRuntime?.scheduler?.paused }">
              <i class="hub-led"></i>
              <span>
                {{
                  desktopRuntime?.scheduler?.paused
                    ? (headerPausedRemainingText ? `守护暂停 · ${headerPausedRemainingText}` : '后台守护已暂停')
                    : '后台守护运行中'
                }}
              </span>
              <em v-if="desktopRuntime?.scheduler?.dnd_active" class="hub-dnd-tag">免打扰</em>
            </div>
            <div class="win-hub-pause-ops">
              <button
                v-if="!desktopRuntime?.scheduler?.paused"
                type="button"
                class="hub-toggle-btn"
                title="暂停后台提醒 30 分钟"
                @click="pauseHeaderSchedulerFor(30)"
              >
                30m
              </button>
              <button type="button" class="hub-toggle-btn" @click="toggleHeaderSchedulerPaused">
                {{ desktopRuntime?.scheduler?.paused ? '恢复' : '暂停' }}
              </button>
            </div>
          </div>

          <div class="menu-separator"></div>
          <div class="win-hub-section-title">浮窗与独立工作区</div>
          <div class="win-launch-grid">
            <button type="button" class="win-launch-tile" @click="$emit('open-window', 'quick-add'); showWindowMenu = false">
              <DesktopIcon name="bolt" :size="13" /><span>快速新建</span>
            </button>
            <button type="button" class="win-launch-tile" @click="$emit('open-window', 'tray-popover'); showWindowMenu = false">
              <DesktopIcon name="popover" :size="13" /><span>今日速览</span>
            </button>
            <button type="button" class="win-launch-tile" @click="$emit('open-window', 'focus'); showWindowMenu = false">
              <DesktopIcon name="timer" :size="13" /><span>专注浮窗</span>
            </button>
            <button type="button" class="win-launch-tile" @click="$emit('open-window', 'ai'); showWindowMenu = false">
              <DesktopIcon name="sparkle" :size="13" /><span>AI 副驾驶</span>
            </button>
          </div>

          <div class="win-views-row">
            <button type="button" class="win-view-pill" @click="$emit('open-window', 'workspace', 'week'); showWindowMenu = false">周计划窗</button>
            <button type="button" class="win-view-pill" @click="$emit('open-window', 'workspace', 'month'); showWindowMenu = false">月历窗</button>
            <button type="button" class="win-view-pill" @click="$emit('open-window', 'workspace', 'matrix'); showWindowMenu = false">矩阵窗</button>
          </div>

          <template v-if="desktopRuntime?.windows?.length">
            <div class="menu-separator"></div>
            <div class="win-hub-section-title">活跃窗口（{{ desktopRuntime.windows.length }}）</div>
            <div class="win-active-list">
              <div v-for="w in desktopRuntime.windows" :key="w.name" class="win-active-row">
                <button type="button" class="win-active-focus" @click="FocusDesktopWindow(w.name); showWindowMenu = false">
                  <span class="win-dot" :class="{ on: w.visible }"></span>
                  <span>{{ w.title }}</span>
                </button>
                <div class="win-active-ops">
                  <button
                    type="button"
                    class="win-op-btn"
                    :class="{ on: w.always_on_top }"
                    title="切换置顶"
                    @click="SetDesktopWindowAlwaysOnTop(w.name, !w.always_on_top)"
                  >
                    <DesktopIcon name="pin" :size="11" />
                  </button>
                  <button
                    v-if="w.name !== 'main' && w.visible"
                    type="button"
                    class="win-op-btn"
                    title="隐藏/关闭"
                    @click="CloseDesktopWindow(w.name)"
                  >
                    <DesktopIcon name="close" :size="11" />
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div class="menu-separator"></div>
          <div class="win-hub-footer">
            <button v-if="visibleAuxCount > 0" type="button" @click="handleHideAllAux">隐藏全部浮窗</button>
            <button type="button" @click="handleResetAllWindowBoundsFromHub">重置全部窗口位置</button>
            <button type="button" @click="$emit('open-desktop-settings'); showWindowMenu = false">桌面与后台设置...</button>
          </div>
        </div>
      </div>

      <button class="header-create-button" type="button" title="新建日程 (⌘N)" @click="$emit('open-create')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>新建</span>
      </button>
      <div class="header-more-wrap">
        <button class="more-button" type="button" aria-label="更多操作" title="更多操作" :aria-expanded="showActionMenu" @click="showActionMenu = !showActionMenu">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>
        <div v-if="showActionMenu" class="header-menu">
          <div class="mobile-views-group" role="group" aria-label="切换视图">
            <button
              v-for="view in views"
              :key="view.id"
              type="button"
              :class="{ 'is-active-view': currentView === view.id }"
              @click="handleViewSelect(view.id); showActionMenu = false"
            >
              <span>{{ view.title }}</span>
              <i v-if="currentView === view.id">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </i>
            </button>
            <div class="menu-separator"></div>
          </div>
          <button type="button" @click="fileInputRef?.click(); showActionMenu = false">导入 ICS / CSV</button>
          <button type="button" @click="$emit('export-ics'); showActionMenu = false">导出 iCalendar</button>
          <button type="button" @click="$emit('export-csv'); showActionMenu = false">导出 CSV</button>
          <div class="menu-separator"></div>
          <button type="button" @click="$emit('test-notify'); showActionMenu = false">测试系统通知</button>
          <button type="button" @click="$emit('toggle-compact'); showActionMenu = false">{{ isCompactMode ? '使用标准密度' : '使用紧凑密度' }}</button>
          <div class="menu-separator"></div>
          <button type="button" @click="$emit('open-window', 'quick-add'); showActionMenu = false">
            <span class="menu-action-label"><DesktopIcon name="bolt" :size="13" /><span>快速新建浮窗 (⌘⌥A)</span></span>
          </button>
          <button type="button" @click="$emit('open-window', 'tray-popover'); showActionMenu = false">
            <span class="menu-action-label"><DesktopIcon name="popover" :size="13" /><span>今日速览浮窗</span></span>
          </button>
          <button type="button" @click="$emit('open-window', 'focus'); showActionMenu = false">
            <span class="menu-action-label"><DesktopIcon name="timer" :size="13" /><span>独立番茄专注浮窗</span></span>
          </button>
          <button type="button" @click="$emit('open-window', 'ai'); showActionMenu = false">
            <span class="menu-action-label"><DesktopIcon name="sparkle" :size="13" /><span>独立 AI 助手窗口</span></span>
          </button>
          <button type="button" @click="$emit('open-window', 'workspace', 'week'); showActionMenu = false">
            <span class="menu-action-label"><DesktopIcon name="calendar" :size="13" /><span>新开周计划窗口</span></span>
          </button>
          <button type="button" @click="$emit('open-window', 'workspace', 'matrix'); showActionMenu = false">
            <span class="menu-action-label"><DesktopIcon name="grid" :size="13" /><span>新开四象限矩阵窗口</span></span>
          </button>
        </div>
      </div>
      <input ref="fileInputRef" type="file" accept=".ics,.csv,text/calendar,text/csv" hidden @change="handleFileChange" />
    </div>
  </header>
</template>

<style scoped>
.workspace-header {
  width: 100%;
  height: 50px;
  min-height: 50px;
  flex: none;
  display: grid;
  grid-template-columns: minmax(210px, 1fr) minmax(200px, 340px) auto;
  align-items: center;
  gap: 14px;
  padding: 0 18px 0 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--app-bg) 86%, transparent);
  backdrop-filter: blur(22px) saturate(155%);
  -webkit-backdrop-filter: blur(22px) saturate(155%);
  position: relative;
  z-index: var(--z-header);
  --wails-draggable: drag;
  -webkit-app-region: drag;
}
.workspace-header.is-mac-windowed { padding-left: 80px; }
.workspace-context { min-width: 0; display: flex; align-items: center; gap: 8px; }
.context-copy { min-width: 0; flex: 1; }
.header-sidebar-toggle, .titlebar-brand, .active-filter {
  --wails-draggable: no-drag;
  -webkit-app-region: no-drag;
}
.header-sidebar-toggle {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}
.header-sidebar-toggle:hover {
  color: var(--text-primary);
  background: var(--fill-hover);
  border-color: var(--border-subtle);
}
.header-sidebar-toggle svg { width: 15px; height: 15px; }
.titlebar-brand {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 6px 3px 3px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--motion-fast);
}
.titlebar-brand:hover { background: var(--fill-hover); }
.titlebar-brand-mark {
  width: 22px;
  height: 22px;
  flex: 0 0 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(13, 82, 156, 0.16);
}
.titlebar-brand-mark img { width: 22px; height: 22px; display: block; object-fit: cover; transform: scale(1.06); }
.titlebar-brand-label { font-size: 13px; font-weight: 750; letter-spacing: -0.025em; }
.titlebar-sep { width: 1px; height: 14px; flex: none; background: var(--border-strong); margin: 0 2px; }
.context-title-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
h1 { overflow: hidden; margin: 0; color: var(--text-secondary); font-size: 13px; font-weight: 650; letter-spacing: -.015em; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.item-count { min-width: 22px; padding: 2.5px 7px; border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--fill-subtle); color: var(--text-tertiary); font: 700 9.5px/1 var(--font-mono); text-align: center; }
.active-filter { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--accent-border); border-radius: 999px; background: var(--accent-soft); color: var(--accent-text); font-size: 10px; cursor: pointer; flex: none; }
.header-search, .header-actions, .header-search *, .header-actions * { --wails-draggable: no-drag; -webkit-app-region: no-drag; }
.header-search { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--input-bg); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08); transition: border-color var(--motion-fast), box-shadow var(--motion-fast); }
.header-search:focus-within { border-color: var(--accent-border); box-shadow: 0 0 0 3px var(--accent-soft); }
.header-search svg { width: 14px; color: var(--text-quaternary); }
.header-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-size: 12px; }
.header-search input::-webkit-search-cancel-button { display: none; }
.header-search input::placeholder { color: var(--text-quaternary); }
.header-search kbd { padding: 2px 6px; border: 1px solid var(--border-subtle); border-radius: 999px; color: var(--text-quaternary); font-size: 9.5px; }
.header-search button { border: 0; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: 16px; }
.header-actions { display: flex; align-items: center; gap: 8px; }
.command-button, .header-create-button, .more-button { height: 31px; border-radius: 999px; cursor: pointer; transition: all var(--motion-fast); }
.command-button { display: flex; align-items: center; gap: 7px; padding: 0 11px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-tertiary); font-size: 10.5px; }
.command-button:hover { color: var(--text-primary); border-color: var(--border-strong); background: var(--fill-hover); }
.command-button kbd { color: var(--text-quaternary); font-size: 9.5px; }
.header-create-button { display: inline-flex; align-items: center; gap: 5px; padding: 0 14px; border: 1px solid transparent; background: var(--cta-bg); color: var(--cta-ink); font-size: 11.5px; font-weight: 700; letter-spacing: -0.01em; box-shadow: var(--cta-shadow); }
.header-create-button:hover { background: var(--cta-bg-hover); transform: translateY(-1px); box-shadow: var(--cta-shadow), 0 0 14px var(--accent-soft); }
.header-more-wrap,
.header-theme-wrap { position: relative; }
.header-focus-pill {
  height: 27px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 5px 0 8px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--motion-fast);
}
.header-focus-pill.break {
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
  background: color-mix(in srgb, var(--success) 13%, transparent);
  color: var(--success);
}
.header-focus-pill:hover {
  filter: brightness(1.06);
}
.focus-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.65;
}
.header-focus-pill.running .focus-pill-dot {
  opacity: 1;
  box-shadow: 0 0 6px currentColor;
}
.header-focus-pill.running {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--tide) 36%, transparent),
    0 0 14px -4px color-mix(in srgb, var(--tide) 48%, transparent);
}
.header-focus-pill.running.break {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--success) 38%, transparent),
    0 0 14px -4px color-mix(in srgb, var(--success) 45%, transparent);
}
.focus-pill-clock {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.02em;
}
.focus-pill-toggle {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.shanshui-picker-btn {
  height: 31px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 10.5px;
  cursor: pointer;
  transition: all var(--motion-fast);
}
.shanshui-picker-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-border);
  background: var(--fill-hover);
}
.shanshui-swatch-trigger {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary) 26%, transparent);
  flex: none;
}
.theme-recent-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 3px;
}
.recent-row-label {
  font: 700 9px var(--font-mono);
  color: var(--text-quaternary);
  margin-right: 2px;
  flex: none;
}
.header-theme-menu .recent-dot-btn {
  min-height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 10px;
  gap: 4px;
}
.header-theme-menu .recent-dot-btn:hover,
.header-theme-menu .recent-dot-btn.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}
.recent-dot-swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  flex: none;
}
.theme-mode-badge {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--tide-text);
  font-style: normal;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 1.4;
}
.header-theme-menu {
  width: 304px;
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
}
.theme-menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 4px 6px;
  font: 700 9.5px var(--font-mono);
  letter-spacing: 0.05em;
  color: var(--text-quaternary);
  border-bottom: 1px solid var(--border-subtle);
}
.theme-menu-moment {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--tide-text);
  font-size: 9px;
}
.theme-quick-toolbar {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.header-theme-menu .theme-quick-btn {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0 5px;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.header-theme-menu .theme-quick-btn svg {
  flex: none;
}
.header-theme-menu .theme-quick-btn:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--text-primary);
}
.theme-mode-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  padding: 2px;
  border-radius: 8px;
  background: var(--glass-track-bg);
  border: 1px solid var(--border-subtle);
}
.header-theme-menu .theme-mode-chip {
  min-height: 22px;
  justify-content: center;
  padding: 0 4px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.header-theme-menu .theme-mode-chip.active {
  background: var(--accent-soft);
  color: var(--tide-text);
  font-weight: 700;
  box-shadow: var(--glass-lens-shadow);
}
.theme-filter-bar {
  display: flex;
  gap: 3px;
}
.header-theme-menu .theme-filter-tab {
  flex: 1;
  min-height: 22px;
  justify-content: center;
  padding: 0 4px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 9.5px;
  white-space: nowrap;
  color: var(--text-tertiary);
}
.header-theme-menu .theme-filter-tab.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font-weight: 700;
}
.theme-menu-search {
  width: 100%;
  height: 27px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
}
.theme-menu-search:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.theme-list-scroll {
  max-height: 256px;
  overflow-y: auto;
  display: grid;
  gap: 2px;
  padding-right: 2px;
}
.header-theme-menu .theme-option-row {
  min-height: 30px;
  padding: 0 7px;
}
.header-theme-menu .theme-option-row.is-kb-focus:not(.is-active-view) {
  background: var(--fill-hover);
}
.theme-menu-left { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.theme-option-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme-tri-swatch {
  display: inline-grid;
  grid-template-columns: repeat(3, 5px);
  height: 12px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  flex: none;
}
.theme-tri-swatch i { display: block; height: 100%; }
.theme-tone-pill { padding: 0 3px; border-radius: 3px; border: 1px solid var(--accent-border); background: var(--accent-soft); color: var(--tide-text); font-style: normal; font-size: 8px; line-height: 1.3; flex: none; }
.theme-option-right { display: inline-flex; align-items: center; gap: 5px; flex: none; }
.theme-fav-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-quaternary);
  opacity: 0.45;
  padding: 2px;
  transition: opacity var(--motion-fast), color var(--motion-fast);
}
.theme-option-row:hover .theme-fav-dot,
.theme-fav-dot.active { opacity: 1; }
.theme-fav-dot.active { color: var(--warning); }
.theme-active-check { display: inline-flex; align-items: center; color: var(--tide-text); }
.menu-action-label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.menu-action-label svg { flex: none; color: var(--text-tertiary); }
.theme-menu-empty { padding: 14px 8px; text-align: center; font-size: 11px; color: var(--text-quaternary); }
.header-theme-menu .theme-footer-action { min-height: 27px; padding: 0 8px; font-size: 11px; }
.more-button { width: 34px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-tertiary); }
.more-button:hover { color: var(--text-primary); border-color: var(--border-strong); background: var(--fill-hover); }
.header-menu { position: absolute; top: 41px; right: 0; z-index: var(--z-float); width: 196px; display: grid; gap: 2px; padding: 6px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--surface-overlay); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); }
.header-menu button { min-height: 31px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary); font-size: 11.5px; text-align: left; cursor: pointer; }
.header-menu button:hover { background: var(--fill-hover); color: var(--text-primary); }
.header-menu button.is-active-view { background: var(--accent-soft); color: var(--tide-text); font-weight: 650; }
.header-menu button i { font-style: normal; font-size: 10.5px; color: var(--tide-text); }
.mobile-views-group { display: none; }
.menu-separator { height: 1px; margin: 4px; background: var(--border-subtle); }
.header-window-wrap { position: relative; }
.window-hub-button {
  height: 31px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: all var(--motion-fast);
}
.window-hub-button:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
  background: var(--fill-hover);
}
.window-hub-button.hasAux {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}
.hub-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
}
.window-hub-button.paused .hub-status-dot {
  background: var(--warning);
}
.hub-aux-count {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}
.header-window-menu {
  width: 268px;
  padding: 8px;
  gap: 5px;
}
.win-hub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 4px;
}
.win-hub-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 650;
  color: var(--success);
}
.win-hub-status.paused { color: var(--warning); }
.hub-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.hub-dnd-tag {
  font-style: normal;
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
}
.header-window-menu .win-hub-pause-ops {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.header-window-menu .hub-toggle-btn {
  min-height: 22px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  font-size: 10.5px;
}
.win-hub-section-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-quaternary);
  padding: 0 4px;
}
.win-launch-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.header-window-menu .win-launch-tile {
  min-height: 30px;
  justify-content: flex-start;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  font-size: 11px;
}
.header-window-menu .win-launch-tile:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}
.win-views-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}
.header-window-menu .win-view-pill {
  min-height: 25px;
  justify-content: center;
  padding: 0 6px;
  border: 1px solid var(--border-subtle);
  font-size: 10.5px;
}
.win-active-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 140px;
  overflow-y: auto;
}
.win-active-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.header-window-menu .win-active-focus {
  flex: 1;
  min-width: 0;
  min-height: 26px;
  justify-content: flex-start;
  gap: 6px;
  padding: 0 6px;
  font-size: 11px;
}
.win-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-quaternary);
  flex-shrink: 0;
}
.win-dot.on { background: var(--success); }
.win-active-ops {
  display: flex;
  align-items: center;
  gap: 2px;
}
.header-window-menu .win-op-btn {
  min-height: 22px;
  height: 22px;
  width: 22px;
  padding: 0;
  justify-content: center;
  font-size: 10.5px;
}
.header-window-menu .win-op-btn.on {
  background: var(--accent-soft);
  color: var(--tide-text);
}
.win-hub-footer {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
@media (max-width: 1180px) { .workspace-header { grid-template-columns: minmax(170px, .85fr) minmax(180px, 1fr) auto; gap: 10px; } .titlebar-brand-label, .command-button span { display: none; } .command-button { gap: 0; padding: 0 9px; } }
@media (max-width: 980px) { :deep(.glass-tabs-track) { display: none; } .mobile-views-group { display: grid; gap: 2px; } .workspace-header { grid-template-columns: minmax(150px, .8fr) minmax(170px, 1fr) auto; } }
</style>
