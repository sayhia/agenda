<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime, formatDateLabel } from '../utils/format';
import { parseReminderTags } from '../domain/reminder';

interface CommandItem {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

const props = defineProps<{
  visible: boolean;
  reminders: Reminder[];
  currentView: string;
  isSidebarCollapsed: boolean;
  isCompactMode: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-create'): void;
  (e: 'open-ai'): void;
  (e: 'open-stats'): void;
  (e: 'open-focus', reminder?: Reminder): void;
  (e: 'open-briefing'): void;
  (e: 'open-trash'): void;
  (e: 'open-settings'): void;
  (e: 'open-shortcuts'): void;
  (e: 'change-view', view: 'list' | 'week' | 'month' | 'matrix'): void;
  (e: 'select-filter', filter: string): void;
  (e: 'toggle-overdue'): void;
  (e: 'toggle-sidebar'): void;
  (e: 'toggle-compact'): void;
  (e: 'export-ics'): void;
  (e: 'export-csv'): void;
  (e: 'edit-reminder', reminder: Reminder): void;
}>();

const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const selectedIndex = ref(0);
const activeDescendant = computed(() => {
  const item = filteredCommands.value[selectedIndex.value];
  return item ? `agenda-command-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}` : undefined;
});

const staticCommands = computed<CommandItem[]>(() => [
  {
    id: 'act-create',
    category: '常用指令',
    title: '新建日程...',
    subtitle: '创建一条新的提醒或排期任务',
    icon: '＋',
    shortcut: '⌘N',
    action: () => emit('open-create'),
  },
  {
    id: 'act-ai',
    category: '常用指令',
    title: '唤起 AI 智能副驾驶',
    subtitle: '智能拆解任务、排期分析与日程早报',
    icon: '✦',
    shortcut: '⌘J',
    action: () => emit('open-ai'),
  },
  {
    id: 'act-focus',
    category: '常用指令',
    title: '启动 25 分钟番茄专注模式',
    subtitle: '进入沉浸无干扰工作状态',
    icon: '◉',
    shortcut: 'P',
    action: () => emit('open-focus'),
  },
  {
    id: 'act-briefing',
    category: '常用指令',
    title: '生成每日早报',
    subtitle: '概览今日全部日程与关键要点',
    icon: '☷',
    action: () => emit('open-briefing'),
  },
  {
    id: 'act-stats',
    category: '常用指令',
    title: '打开生产力数据看板',
    subtitle: '查看完成率、标签分布与数据库体检',
    icon: '⌁',
    action: () => emit('open-stats'),
  },
  {
    id: 'act-trash',
    category: '常用指令',
    title: '打开废纸篓',
    subtitle: '查看并恢复已删除的日程事项',
    icon: '⌫',
    action: () => emit('open-trash'),
  },
  {
    id: 'act-settings',
    category: '常用指令',
    title: '系统偏好设置...',
    subtitle: '个性化主题、提示音、提前提醒与 API 设置',
    icon: '⌘',
    action: () => emit('open-settings'),
  },
  {
    id: 'act-shortcuts',
    category: '常用指令',
    title: '键盘快捷键速查表',
    subtitle: '掌握全部 Vim 风格与全局快捷键',
    icon: '?',
    shortcut: '?',
    action: () => emit('open-shortcuts'),
  },
  {
    id: 'act-sidebar',
    category: '界面控制',
    title: props.isSidebarCollapsed ? '展开左侧导航侧边栏' : '折叠左侧导航侧边栏',
    subtitle: '切换全宽或极简图标侧栏',
    icon: '▣',
    shortcut: '⌘B',
    action: () => emit('toggle-sidebar'),
  },
  {
    id: 'act-compact',
    category: '界面控制',
    title: props.isCompactMode ? '退出紧凑小窗模式' : '进入紧凑迷你小窗模式',
    subtitle: '适应小屏或桌面浮窗摆放',
    icon: '↔',
    action: () => emit('toggle-compact'),
  },
  {
    id: 'act-export-ics',
    category: '数据出入',
    title: '导出 iCalendar (.ics) 日历文件',
    subtitle: '同步至 Apple 日历、Google Calendar 等系统',
    icon: '□',
    action: () => emit('export-ics'),
  },
  {
    id: 'act-export-csv',
    category: '数据出入',
    title: '导出 Excel / CSV 标准表格',
    subtitle: '带 UTF-8 BOM 编码，Excel 直接打开不乱码',
    icon: '⌁',
    action: () => emit('export-csv'),
  },
  {
    id: 'view-list',
    category: '视图导航',
    title: '切换至「任务列表视图」',
    subtitle: '高效清单、分组排序与批量处理',
    icon: '≡',
    shortcut: '1',
    action: () => emit('change-view', 'list'),
  },
  {
    id: 'view-week',
    category: '视图导航',
    title: '切换至「7 天周时间线视图」',
    subtitle: '横跨全周的直观排期与时间槽冲突排查',
    icon: '□',
    shortcut: '2',
    action: () => emit('change-view', 'week'),
  },
  {
    id: 'view-month',
    category: '视图导航',
    title: '切换至「全景月历视图」',
    subtitle: '月度密度分布与宏观日历规划',
    icon: '□',
    shortcut: '3',
    action: () => emit('change-view', 'month'),
  },
  {
    id: 'view-matrix',
    category: '视图导航',
    title: '切换至「四象限分析矩阵」',
    subtitle: '重要与紧急维度的艾森豪威尔法则管理',
    icon: '⌗',
    shortcut: '4',
    action: () => emit('change-view', 'matrix'),
  },
  {
    id: 'filter-overdue',
    category: '视图导航',
    title: '聚焦「已逾期提醒」',
    subtitle: '快速筛选所有超期未完成事项',
    icon: '!',
    action: () => emit('toggle-overdue'),
  },
  {
    id: 'filter-today',
    category: '视图导航',
    title: '聚焦「今日待办事项」',
    subtitle: '专注解决今天的全部核心日程',
    icon: '○',
    action: () => {
      emit('change-view', 'list');
      emit('select-filter', 'today');
    },
  },
]);

// Filtered items based on query
const filteredCommands = computed<CommandItem[]>(() => {
  const rawQ = query.value.trim();
  if (!rawQ) return staticCommands.value;

  const matches: CommandItem[] = [];
  const isActionOnly = rawQ.startsWith('>') || rawQ.startsWith(':');
  const isReminderOnly = rawQ.startsWith('@');
  const isTagOnly = rawQ.startsWith('#');

  const cleanQ = (isActionOnly || isReminderOnly || isTagOnly ? rawQ.slice(1) : rawQ).trim().toLowerCase();

  // 1. Static action matches (if not in reminder-only or tag-only mode)
  if (!isReminderOnly && !isTagOnly) {
    for (const cmd of staticCommands.value) {
      if (
        !cleanQ ||
        cmd.title.toLowerCase().includes(cleanQ) ||
        (cmd.subtitle && cmd.subtitle.toLowerCase().includes(cleanQ)) ||
        cmd.category.toLowerCase().includes(cleanQ)
      ) {
        matches.push(cmd);
      }
    }
  }

  // 2. Dynamic reminder matches (if not in action-only mode)
  if (!isActionOnly) {
    let reminderPool = props.reminders.filter((r) => r.status !== 'ended');
    if (isTagOnly) {
      reminderPool = reminderPool.filter((reminder) =>
        parseReminderTags(reminder.tags).some((tag) => tag.toLowerCase().includes(cleanQ))
      );
    } else if (cleanQ) {
      reminderPool = reminderPool.filter(
        (r) =>
          r.title.toLowerCase().includes(cleanQ) ||
          r.notes?.toLowerCase().includes(cleanQ) ||
          r.tags?.toLowerCase().includes(cleanQ)
      );
    }
    const reminderMatches = reminderPool.slice(0, 8);

    for (const r of reminderMatches) {
      const d = formatDateLabel(r.scheduled_at);
      const t = formatTime(r.scheduled_at);
      matches.push({
        id: `rem-${r.id}`,
        category: '匹配日程',
        title: r.title,
        subtitle: `${d.label} ${t} · ${r.priority ? r.priority.toUpperCase() : 'P2'}${r.tags ? ' · #' + r.tags : ''}`,
        icon: r.priority === 'p0' ? '!' : '•',
        action: () => emit('edit-reminder', r),
      });
    }
  }

  return matches;
});

// Group filtered commands by category
const groupedCommands = computed(() => {
  const map = new Map<string, CommandItem[]>();
  for (const item of filteredCommands.value) {
    const list = map.get(item.category) || [];
    list.push(item);
    map.set(item.category, list);
  }
  return Array.from(map.entries()).map(([category, items]) => ({
    category,
    items,
  }));
});

watch(
  () => props.visible,
  (val) => {
    if (val) {
      query.value = '';
      selectedIndex.value = 0;
      nextTick(() => {
        inputRef.value?.focus();
      });
    }
  }
);

watch(query, () => {
  selectedIndex.value = 0;
});

watch(selectedIndex, async () => {
  await nextTick();
  listRef.value?.querySelector<HTMLElement>('.palette-item.active')?.scrollIntoView({ block: 'nearest' });
});

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
    return;
  }

  const total = filteredCommands.value.length;
  if (total === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % total;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = (selectedIndex.value - 1 + total) % total;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = filteredCommands.value[selectedIndex.value];
    if (item) {
      item.action();
      emit('close');
    }
  }
}

function selectAndExecute(item: CommandItem) {
  item.action();
  emit('close');
}
</script>

<template>
  <div v-if="visible" class="command-palette-overlay" @click.self="$emit('close')">
    <div class="command-palette-card glass-panel bg-crosshair-grid" role="dialog" aria-modal="true" aria-label="命令面板">
      <!-- Search Input Area -->
      <div class="palette-input-wrap">
        <svg class="palette-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        <input
          ref="inputRef"
          v-model="query"
          type="text"
          class="palette-input"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="agenda-command-list"
          :aria-expanded="visible"
          :aria-activedescendant="activeDescendant"
          placeholder="搜索指令、日程、标签 (输入 @ 搜日程，> 搜动作，# 搜标签)..."
          @keydown="handleKeydown"
        />

        <kbd class="palette-esc-kbd" title="退出" @click="$emit('close')">ESC</kbd>
      </div>

      <!-- Command List Scroll Area -->
      <div id="agenda-command-list" ref="listRef" class="palette-scroll-area" role="listbox" aria-label="命令和日程结果">
        <div v-if="filteredCommands.length === 0" class="palette-empty">
          <span class="empty-icon">—</span>
          <span class="empty-text">未找到匹配的指令或日程：“{{ query }}”</span>
        </div>

        <div v-else class="palette-categories">
          <div v-for="grp in groupedCommands" :key="grp.category" class="palette-group">
            <div class="palette-group-title">{{ grp.category }}</div>
            <div class="palette-items-list">
              <div
                v-for="item in grp.items"
                :key="item.id"
                class="palette-item"
                role="option"
                :id="`agenda-command-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`"
                :aria-selected="filteredCommands[selectedIndex]?.id === item.id"
                :class="{ active: filteredCommands[selectedIndex]?.id === item.id }"
                @click="selectAndExecute(item)"
                @mouseenter="selectedIndex = filteredCommands.findIndex((c) => c.id === item.id)"
              >
                <div class="item-left">
                  <span class="item-icon">{{ item.icon }}</span>
                  <div class="item-text-wrap">
                    <span class="item-title">{{ item.title }}</span>
                    <span v-if="item.subtitle" class="item-subtitle">{{ item.subtitle }}</span>
                  </div>
                </div>

                <div class="item-right">
                  <kbd v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</kbd>
                  <span v-if="filteredCommands[selectedIndex]?.id === item.id" class="item-enter-hint">⏎</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Palette Footer Hint Bar -->
      <div class="palette-footer">
        <div class="footer-tips">
          <span class="tip-item"><kbd class="kbd-mini">@</kbd> 搜日程</span>
          <span class="tip-item"><kbd class="kbd-mini">&gt;</kbd> 搜动作</span>
          <span class="tip-item"><kbd class="kbd-mini">#</kbd> 搜标签</span>
          <span class="tip-item"><kbd class="kbd-mini">↑↓</kbd> 导航</span>
          <span class="tip-item"><kbd class="kbd-mini">↵</kbd> 执行</span>
          <span class="tip-item"><kbd class="kbd-mini">Esc</kbd> 退出</span>
        </div>
        <span class="footer-brand">Agenda Butler Spotlight</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.command-palette-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  z-index: 300;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}

.command-palette-card {
  width: 620px;
  max-width: 92vw;
  max-height: 72vh;
  border-radius: 16px;
  border: 1px solid var(--accent-border);
  background: color-mix(in oklab, var(--surface-raised) 95%, transparent);
  box-shadow: var(--shadow-lg), 0 0 0 1px var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slide-up 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-up {
  from { transform: translateY(-16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Input */
.palette-input-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-l1);
  background: var(--fill-subtle);
}

.palette-search-icon {
  color: var(--brand-light);
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;
}

.palette-input::placeholder {
  color: var(--text-muted);
  font-size: 13.5px;
}

.palette-esc-kbd {
  font: 700 10px var(--font-mono);
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  color: var(--text-tertiary);
  cursor: pointer;
}

/* Scroll Area */
.palette-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.palette-empty {
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 13px;
}

.empty-icon {
  font-size: 24px;
}

.palette-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-group-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 6px 10px 4px;
  letter-spacing: 0.5px;
}

.palette-items-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.12s ease;
  user-select: none;
}

.palette-item:hover {
  background: var(--fill-hover);
}

.palette-item.active {
  background: var(--accent-soft);
  color: var(--text-primary);
  box-shadow: inset 2.5px 0 0 var(--tide);
}

.item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.item-icon {
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.item-text-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.item-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item.active .item-title {
  color: var(--text-primary);
}

.item-subtitle {
  font-size: 11.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.palette-item.active .item-subtitle {
  color: var(--accent-text);
}

.item-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.item-shortcut {
  font: 700 10.5px var(--font-mono);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  padding: 2px 6px;
  border-radius: 5px;
  color: var(--text-secondary);
}

.item-enter-hint {
  font-size: 12px;
  color: var(--tide-text);
  font-weight: 700;
}

/* Footer */
.palette-footer {
  padding: 10px 18px;
  border-top: 1px solid var(--border-l1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--fill-subtle);
}

.footer-tips {
  display: flex;
  align-items: center;
  gap: 14px;
}

.tip-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.kbd-mini {
  font: 700 9.5px var(--font-mono);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--text-secondary);
}

.footer-brand {
  font: 600 10.5px var(--font-mono);
  color: var(--text-muted);
}
</style>
