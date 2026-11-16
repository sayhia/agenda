<script setup lang="ts">
import { computed } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import type { AgendaView, StatsData } from '../types/ui';
import { parseReminderTags } from '../domain/reminder';
import {
  getApproxSolarTerm,
  getChineseShichen,
  getNextSolarTerm,
  getSeasonalAtmosphere,
} from '../utils/shanshui';
import {
  focusDisplayClock,
  focusEngineState,
  hasLiveFocusActivity,
} from '../utils/focusEngine';

const props = withDefaults(defineProps<{
  currentView: AgendaView;
  activeFilter: string;
  filterOverdueOnly: boolean;
  selectedTag: string | null;
  selectedTags?: string[];
  tagFilterMode?: 'and' | 'or';
  selectedDate: string | null;
  reminders: Reminder[];
  stats: StatsData;
  overdueCount: number;
  trashCount?: number;
  isCollapsed?: boolean;
  isFullscreen?: boolean;
  isSoundEnabled?: boolean;
}>(), {
  selectedTags: () => [],
  tagFilterMode: 'and',
  trashCount: 0,
  isCollapsed: false,
  isFullscreen: false,
  isSoundEnabled: true,
});

const emit = defineEmits<{
  (e: 'change-view', view: AgendaView): void;
  (e: 'select-filter', filter: string): void;
  (e: 'toggle-overdue'): void;
  (e: 'filter-tag', tag: string | null): void;
  (e: 'toggle-tag-mode'): void;
  (e: 'clear-date-filter'): void;
  (e: 'open-create'): void;
  (e: 'open-ai'): void;
  (e: 'open-stats'): void;
  (e: 'open-focus'): void;
  (e: 'open-briefing'): void;
  (e: 'open-trash'): void;
  (e: 'open-settings'): void;
  (e: 'open-shortcuts'): void;
  (e: 'open-solar-terms'): void;
  (e: 'toggle-collapse'): void;
  (e: 'toggle-sound'): void;
  (e: 'refresh-data'): void;
}>();

const tagList = computed(() => {
  const counts = new Map<string, number>();
  for (const reminder of props.reminders) {
    if (reminder.status === 'ended' || !reminder.tags) continue;
    for (const tag of parseReminderTags(reminder.tags)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
});

function selectCollection(filter: string) {
  emit('change-view', 'list');
  emit('select-filter', filter);
}

function selectAll() {
  selectCollection('all');
}

const seasonalStamp = computed(() => {
  const now = new Date();
  const solar = getApproxSolarTerm(now);
  const shichen = getChineseShichen(now);
  const atmo = getSeasonalAtmosphere(now);
  const next = getNextSolarTerm(now);
  return {
    sealChar: solar.sealChar,
    label: `${solar.season}令 · ${solar.name} · ${next.daysRemaining}日后${next.term.name}`,
    tip: `${solar.verse}｜${shichen.branch}时${shichen.alias}｜${atmo.teaSuggestion}（点击打开廿四节气与四季图鉴）`,
  };
});
</script>

<template>
  <aside class="nav-sidebar" :class="{ 'is-collapsed': isCollapsed }">

    <div class="sidebar-primary-actions">
      <button class="create-button" type="button" title="新建日程 (⌘N)" @click="$emit('open-create')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M12 5v14M5 12h14" /></svg>
        <span v-if="!isCollapsed">新建日程</span>
        <kbd v-if="!isCollapsed">⌘N</kbd>
      </button>
      <button class="assistant-button" type="button" title="AI 助手 (⌘J)" @click="$emit('open-ai')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"/><path d="m18 15 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z"/></svg>
        <span v-if="!isCollapsed">AI 助手</span>
        <kbd v-if="!isCollapsed">⌘J</kbd>
      </button>
    </div>

    <div class="sidebar-scroll-area">
      <section class="nav-section">
        <h2 v-if="!isCollapsed">01 · INBOX</h2>
        <nav aria-label="日程筛选">
          <button class="nav-item" :class="{ active: currentView === 'list' && activeFilter === 'all' && !filterOverdueOnly && !selectedTag && !selectedDate }" type="button" title="全部日程" @click="selectAll">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">全部日程</span><span v-if="!isCollapsed || stats.total > 0" class="nav-count">{{ stats.total }}</span>
          </button>
          <button class="nav-item" :class="{ active: currentView === 'list' && activeFilter === 'today' && !filterOverdueOnly }" type="button" title="今天" @click="selectCollection('today')">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">今天</span><span v-if="!isCollapsed || stats.today > 0" class="nav-count">{{ stats.today }}</span>
          </button>
          <button class="nav-item" :class="{ active: currentView === 'list' && activeFilter === 'near' && !filterOverdueOnly }" type="button" title="15 分钟内到期" @click="selectCollection('near')">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 14" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">即将到期</span><span v-if="!isCollapsed || stats.nearDue > 0" class="nav-count">{{ stats.nearDue }}</span>
          </button>
          <button class="nav-item danger-item" :class="{ active: filterOverdueOnly }" type="button" title="逾期日程" @click="$emit('toggle-overdue')">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="8" x2="12" y2="12.5" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">已逾期</span><span v-if="!isCollapsed || overdueCount > 0" class="nav-count" :class="{ alert: overdueCount > 0 }">{{ overdueCount }}</span>
          </button>
          <button class="nav-item" :class="{ active: currentView === 'list' && activeFilter === 'paused' && !filterOverdueOnly }" type="button" title="已暂停" @click="selectCollection('paused')">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <line x1="10" y1="9" x2="10" y2="15" />
                <line x1="14" y1="9" x2="14" y2="15" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">已暂停</span><span v-if="!isCollapsed || stats.paused > 0" class="nav-count">{{ stats.paused }}</span>
          </button>
        </nav>
      </section>

      <section class="nav-section">
        <h2 v-if="!isCollapsed">02 · VIEWS</h2>
        <nav aria-label="日程视图">
          <button class="nav-item" :class="{ active: currentView === 'list' && !filterOverdueOnly && activeFilter === 'all' && !selectedTag }" type="button" title="列表视图 (1)" @click="selectAll">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">列表</span><kbd v-if="!isCollapsed">1</kbd>
          </button>
          <button class="nav-item" :class="{ active: currentView === 'week' }" type="button" title="周视图 (2)" @click="$emit('change-view', 'week')">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
                <line x1="15" y1="4" x2="15" y2="20" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">周计划</span><kbd v-if="!isCollapsed">2</kbd>
          </button>
          <button class="nav-item" :class="{ active: currentView === 'month' }" type="button" title="月历 (3)" @click="$emit('change-view', 'month')">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">月历</span><kbd v-if="!isCollapsed">3</kbd>
          </button>
          <button class="nav-item" :class="{ active: currentView === 'matrix' }" type="button" title="优先级矩阵 (4)" @click="$emit('change-view', 'matrix')">
            <span class="nav-symbol">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
                <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
                <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
                <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
              </svg>
            </span>
            <span v-if="!isCollapsed" class="nav-label">优先级矩阵</span><kbd v-if="!isCollapsed">4</kbd>
          </button>
        </nav>
      </section>

      <section v-if="tagList.length" class="nav-section tags-section">
        <div v-if="!isCollapsed" class="section-heading-row">
          <h2>03 · TAGS</h2>
          <div class="tag-actions">
            <button
              v-if="selectedTags && selectedTags.length > 1"
              type="button"
              class="tag-mode-btn"
              :title="tagFilterMode === 'and' ? '当前模式：且 AND（需同时满足全部选中标签）' : '当前模式：或 OR（满足任一标签即可）'"
              @click="$emit('toggle-tag-mode')"
            >
              {{ tagFilterMode === 'and' ? 'AND 且' : 'OR 或' }}
            </button>
            <button v-if="selectedTag || (selectedTags && selectedTags.length)" type="button" @click="$emit('filter-tag', null)">清除</button>
          </div>
        </div>
        <div class="tag-list">
          <button
            v-for="tag in tagList"
            :key="tag.name"
            class="tag-nav-item"
            :class="{ active: (selectedTags && selectedTags.includes(tag.name)) || selectedTag === tag.name }"
            type="button"
            :title="`#${tag.name} · ${tag.count} 项`"
            @click="$emit('filter-tag', tag.name)"
          >
            <span class="tag-hash">#</span><span v-if="!isCollapsed" class="tag-name">{{ tag.name }}</span><span v-if="!isCollapsed" class="tag-count">{{ tag.count }}</span>
          </button>
        </div>
      </section>
    </div>

    <div class="sidebar-tools">
      <button type="button" title="数据看板" @click="$emit('open-stats')">
        <span class="tool-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </span>
        <small v-if="!isCollapsed">看板</small>
      </button>
      <button
        type="button"
        :title="hasLiveFocusActivity ? `专注计时运行中 (${focusDisplayClock}) · 按 P 打开` : `专注计时 (P) · 今日已完成 ${focusEngineState.stats.todayMinutes} 分钟`"
        @click="$emit('open-focus')"
      >
        <span class="tool-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 1.5" />
            <path d="M9 2h6" />
            <path d="M12 2v3" />
          </svg>
        </span>
        <small v-if="!isCollapsed">{{ hasLiveFocusActivity ? focusDisplayClock : '专注' }}</small>
        <em v-if="!hasLiveFocusActivity && focusEngineState.stats.todaySessions > 0" class="tool-badge">{{ focusEngineState.stats.todaySessions }}</em>
      </button>
      <button type="button" title="每日简报" @click="$emit('open-briefing')">
        <span class="tool-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="13" y2="17" />
          </svg>
        </span>
        <small v-if="!isCollapsed">简报</small>
      </button>
      <button type="button" :title="trashCount ? `废纸篓 (${trashCount})` : '废纸篓'" @click="$emit('open-trash')">
        <span class="tool-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </span>
        <small v-if="!isCollapsed">废纸篓</small>
        <em v-if="trashCount && trashCount > 0" class="tool-badge">{{ trashCount > 99 ? '99+' : trashCount }}</em>
      </button>
    </div>

    <button
      v-if="!isCollapsed"
      type="button"
      class="sidebar-shanshui-note"
      :title="seasonalStamp.tip"
      @click="$emit('open-solar-terms')"
    >
      <span class="shanshui-seal">{{ seasonalStamp.sealChar }}</span>
      <span class="note-label">{{ seasonalStamp.label }}</span>
      <span class="note-arrow">四时 ›</span>
    </button>

    <div class="sidebar-footer">
      <button type="button" :title="isSoundEnabled ? '关闭提示音' : '开启提示音'" @click="$emit('toggle-sound')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path v-if="isSoundEnabled" d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <line v-else x1="22" y1="9" x2="16" y2="15" />
        </svg>
        <span v-if="!isCollapsed">{{ isSoundEnabled ? '提示音已开' : '提示音静音' }}</span>
      </button>
      <button type="button" title="设置" @click="$emit('open-settings')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span v-if="!isCollapsed">设置</span>
      </button>
      <button v-if="!isCollapsed" class="shortcuts-link" type="button" title="键盘快捷键" @click="$emit('open-shortcuts')">?</button>
    </div>
  </aside>
</template>

<style scoped>
.nav-sidebar {
  width: 224px;
  min-width: 224px;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-subtle);
  transition: width var(--motion-normal), min-width var(--motion-normal);
  position: relative;
  z-index: var(--z-sidebar);
}
.nav-sidebar.is-collapsed { width: 60px; min-width: 60px; }

.sidebar-primary-actions { display: grid; gap: 8px; padding: 14px 12px 16px; }
.sidebar-primary-actions button { height: 37px; display: flex; align-items: center; gap: 9px; padding: 0 13px; border-radius: 999px; cursor: pointer; font-size: 12px; font-weight: 700; letter-spacing: -0.01em; transition: background var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast), box-shadow var(--motion-fast); }
.sidebar-primary-actions svg { width: 15px; height: 15px; flex: none; }
.sidebar-primary-actions kbd { margin-left: auto; color: currentColor; opacity: .55; font-size: 9.5px; }
.create-button { color: var(--cta-ink); background: var(--cta-bg); border: 1px solid transparent; box-shadow: var(--cta-shadow); }
.create-button:hover { background: var(--cta-bg-hover); transform: translateY(-1px); box-shadow: var(--cta-shadow), 0 0 16px var(--accent-soft); }
.assistant-button { color: var(--text-secondary); background: var(--fill-subtle); border: 1px solid var(--border-subtle); }
.assistant-button:hover { color: var(--text-primary); background: var(--fill-hover); border-color: var(--accent-border); }
.is-collapsed .sidebar-primary-actions { padding: 14px 10px 16px; }
.is-collapsed .sidebar-primary-actions button { justify-content: center; padding: 0; }

.sidebar-scroll-area {
  flex: 1;
  overflow: auto;
  padding: 0 9px 18px;
  scrollbar-width: none;
  mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 14px), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, #000 0, #000 calc(100% - 14px), transparent 100%);
}
.sidebar-scroll-area::-webkit-scrollbar { display: none; }
.nav-section + .nav-section { margin-top: 20px; }
.nav-section h2 { margin: 0 9px 7px; color: var(--text-quaternary); font: 700 9px var(--font-mono); letter-spacing: .16em; text-transform: uppercase; }
.nav-section nav { display: grid; gap: 2px; }
.nav-item { position: relative; width: 100%; height: 34px; display: flex; align-items: center; gap: 10px; padding: 0 9px; border: 0; border-radius: 9px; background: transparent; color: var(--text-secondary); cursor: pointer; text-align: left; transition: background var(--motion-fast), color var(--motion-fast); }
.nav-item:hover { color: var(--text-primary); background: var(--fill-hover); }
.nav-item.active { color: var(--text-primary); background: var(--fill-active); box-shadow: inset 2.5px 0 0 var(--tide); }
.nav-symbol { width: 17px; height: 17px; flex: 0 0 17px; display: inline-grid; place-items: center; color: var(--text-tertiary); transition: color var(--motion-fast); }
.nav-item:hover .nav-symbol { color: var(--text-primary); }
.nav-item.active .nav-symbol { color: var(--tide-text, var(--accent-text)); }
.nav-label { min-width: 0; flex: 1; font-size: 12.5px; font-weight: 550; }
.nav-count { min-width: 20px; color: var(--text-quaternary); font: 600 10px/1 var(--font-mono); text-align: right; }
.nav-count.alert { color: var(--danger); }
.nav-item kbd { color: var(--text-quaternary); font-size: 10px; }
.is-collapsed .nav-item { justify-content: center; padding: 0; }
.is-collapsed .nav-symbol { width: auto; flex: none; }
.is-collapsed .nav-count { position: absolute; top: 2px; left: calc(50% + 3px); margin: 0; min-width: 15px; padding: 2px 4px; border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--surface-raised); color: var(--text-primary); box-shadow: var(--shadow-xs); font-size: 8px; line-height: 1; text-align: center; pointer-events: none; z-index: 1; }
.section-heading-row { display: flex; align-items: center; justify-content: space-between; }
.section-heading-row button { border: 0; background: transparent; color: var(--accent-text); font-size: 10px; cursor: pointer; }
.tag-actions { display: flex; align-items: center; gap: 6px; }
.tag-mode-btn { border: 1px solid var(--accent-border, rgba(255, 255, 255, 0.12)) !important; border-radius: 4px; padding: 1px 5px !important; background: var(--accent-soft, rgba(255, 255, 255, 0.06)) !important; color: var(--accent-text) !important; font-size: 9px !important; font-weight: 700; transition: all 0.12s ease; }
.tag-mode-btn:hover { background: var(--accent) !important; color: var(--ink-on-accent, #ffffff) !important; }
.tag-list { display: grid; gap: 2px; }
.tag-nav-item { height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 9px; border: 0; border-radius: 7px; color: var(--text-tertiary); background: transparent; cursor: pointer; text-align: left; }
.tag-nav-item:hover, .tag-nav-item.active { color: var(--text-primary); background: var(--fill-hover); }
.tag-hash { color: var(--accent-text); font-weight: 700; }
.tag-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
.tag-count { font: 10px var(--font-mono); }
.is-collapsed .tag-nav-item { justify-content: center; padding: 0; }

.sidebar-tools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; padding: 10px; border-top: 1px solid var(--border-subtle); }
.sidebar-tools button { position: relative; min-width: 0; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast); }
.sidebar-tools button:hover { color: var(--text-primary); background: var(--fill-hover); }
.sidebar-tools .tool-icon { display: inline-grid; place-items: center; width: 16px; height: 16px; }
.sidebar-tools small { font-size: 9.5px; line-height: 1; }
.tool-badge { position: absolute; top: 3px; right: 5px; min-width: 14px; height: 14px; padding: 0 3.5px; border-radius: 999px; background: var(--surface-raised); border: 1px solid var(--border-subtle); color: var(--text-secondary); font: 700 8px/12px var(--font-mono); font-style: normal; text-align: center; }
.is-collapsed .sidebar-tools { grid-template-columns: 1fr; padding: 8px 10px; }
.is-collapsed .sidebar-tools button { height: 31px; }
.is-collapsed .tool-badge { top: 1px; left: calc(50% + 3px); right: auto; pointer-events: none; }
.sidebar-shanshui-note {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 10px 8px;
  padding: 5px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  font-size: 10.5px;
  cursor: pointer;
  transition: border-color var(--motion-fast), background var(--motion-fast), color var(--motion-fast);
}
.sidebar-shanshui-note:hover {
  border-color: var(--accent-border);
  background: var(--fill-hover);
  color: var(--text-primary);
}
.sidebar-shanshui-note .note-label { flex: 1; text-align: left; font-weight: 550; }
.sidebar-shanshui-note .note-arrow { font-size: 9.5px; color: var(--tide-text); opacity: 0.85; }
.sidebar-footer { min-height: 48px; display: flex; align-items: center; gap: 3px; padding: 8px 10px; border-top: 1px solid var(--border-subtle); }
.sidebar-footer button { height: 31px; display: flex; align-items: center; gap: 7px; padding: 0 8px; border: 0; border-radius: 7px; background: transparent; color: var(--text-tertiary); font-size: 10.5px; cursor: pointer; }
.sidebar-footer button:hover { color: var(--text-primary); background: var(--fill-hover); }
.shortcuts-link { margin-left: auto; width: 28px; justify-content: center; }
.is-collapsed .sidebar-footer { flex-direction: column; }
.is-collapsed .sidebar-footer button { width: 100%; justify-content: center; }
</style>
