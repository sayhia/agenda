<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { AgendaView } from '../types/ui';
import GlassTabs, { type GlassTabItem } from './GlassTabs.vue';

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
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const showActionMenu = ref(false);

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
  if (event.key === 'Escape' && showActionMenu.value) {
    event.preventDefault();
    showActionMenu.value = false;
    return;
  }
  if (event.key === '/' && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') {
    event.preventDefault();
    searchInputRef.value?.focus();
  }
}

function handlePointerDown(event: MouseEvent) {
  if (!(event.target as HTMLElement | null)?.closest('.header-more-wrap')) showActionMenu.value = false;
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('mousedown', handlePointerDown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('mousedown', handlePointerDown);
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
      <GlassTabs
        :modelValue="currentView"
        :items="views"
        size="md"
        aria-label="切换视图"
        @update:modelValue="handleViewSelect"
      />
      <button class="command-button" type="button" title="命令面板 (⌘K)" @click="$emit('open-palette')"><span>命令</span><kbd>⌘K</kbd></button>
      <button class="header-create-button" type="button" title="新建日程 (⌘N)" @click="$emit('open-create')"><span>＋</span> 新建</button>
      <div class="header-more-wrap">
        <button class="more-button" type="button" aria-label="更多操作" title="更多操作" :aria-expanded="showActionMenu" @click="showActionMenu = !showActionMenu">•••</button>
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
              <i v-if="currentView === view.id">✓</i>
            </button>
            <div class="menu-separator"></div>
          </div>
          <button type="button" @click="fileInputRef?.click(); showActionMenu = false">导入 ICS / CSV</button>
          <button type="button" @click="$emit('export-ics'); showActionMenu = false">导出 iCalendar</button>
          <button type="button" @click="$emit('export-csv'); showActionMenu = false">导出 CSV</button>
          <div class="menu-separator"></div>
          <button type="button" @click="$emit('test-notify'); showActionMenu = false">测试系统通知</button>
          <button type="button" @click="$emit('toggle-compact'); showActionMenu = false">{{ isCompactMode ? '使用标准密度' : '使用紧凑密度' }}</button>
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
.active-filter { padding: 3px 8px; border: 1px solid var(--accent-border); border-radius: 999px; background: var(--accent-soft); color: var(--accent-text); font-size: 10px; cursor: pointer; flex: none; }
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
.header-create-button { padding: 0 14px; border: 1px solid transparent; background: var(--cta-bg); color: var(--cta-ink); font-size: 11.5px; font-weight: 700; letter-spacing: -0.01em; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28); }
.header-create-button:hover { background: var(--cta-bg-hover); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.34), 0 0 14px var(--accent-soft); }
.header-more-wrap { position: relative; }
.more-button { width: 34px; border: 1px solid var(--border-subtle); background: transparent; color: var(--text-tertiary); letter-spacing: 1px; }
.more-button:hover { color: var(--text-primary); border-color: var(--border-strong); background: var(--fill-hover); }
.header-menu { position: absolute; top: 41px; right: 0; z-index: var(--z-float); width: 196px; display: grid; gap: 2px; padding: 6px; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--surface-overlay); box-shadow: var(--shadow-lg); backdrop-filter: blur(20px); }
.header-menu button { min-height: 31px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: var(--text-secondary); font-size: 11.5px; text-align: left; cursor: pointer; }
.header-menu button:hover { background: var(--fill-hover); color: var(--text-primary); }
.header-menu button.is-active-view { background: var(--accent-soft); color: var(--tide-text); font-weight: 650; }
.header-menu button i { font-style: normal; font-size: 10.5px; color: var(--tide-text); }
.mobile-views-group { display: none; }
.menu-separator { height: 1px; margin: 4px; background: var(--border-subtle); }
@media (max-width: 1180px) { .workspace-header { grid-template-columns: minmax(170px, .85fr) minmax(180px, 1fr) auto; gap: 10px; } .titlebar-brand-label, .command-button span { display: none; } .command-button { gap: 0; padding: 0 9px; } }
@media (max-width: 980px) { :deep(.glass-tabs-track) { display: none; } .mobile-views-group { display: grid; gap: 2px; } .workspace-header { grid-template-columns: minmax(150px, .8fr) minmax(170px, 1fr) auto; } }
</style>
