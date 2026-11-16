<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime, formatDateLabel } from '../utils/format';
import { parseReminderTags } from '../domain/reminder';
import { fuzzyMatchPinyin } from '../utils/pinyin';
import { parseNaturalReminder, type ParsedReminder } from '../utils/nlp';
import { CUSTOM_ACCENT_PRESETS, THEME_AUTO_MODE_LABELS, THEME_DEFINITIONS, getCustomAccentOverride, getHighContrastMode, getShanshuiSerifMode, getShanshuiThemes, getThemeAutoMode, normalizeThemeId, type ThemeAutoMode } from '../utils/themes';
import {
  getRecommendedShanshuiThemeForTime,
  getSeasonalShanshuiRecommendation,
} from '../utils/shanshui';
import {
  focusDisplayClock,
  focusEngineState,
  hasLiveFocusActivity,
  resetFocusTimer,
  toggleFocusTimer,
} from '../utils/focusEngine';
import { exportFocusHistoryMarkdown } from '../utils/focus';
import { triggerFileDownload } from '../utils/export';

interface CommandItem {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  icon: string;
  themeColor?: string;
  themeSecondaryColor?: string;
  themeSealChar?: string;
  themeToneLabel?: string;
  isActiveTheme?: boolean;
  shortcut?: string;
  action: () => void;
}

const props = defineProps<{
  visible: boolean;
  reminders: Reminder[];
  currentView: string;
  isSidebarCollapsed: boolean;
  isCompactMode: boolean;
  currentTheme?: string;
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
  (e: 'open-solar-terms'): void;
  (e: 'change-view', view: 'list' | 'week' | 'month' | 'matrix'): void;
  (e: 'select-filter', filter: string): void;
  (e: 'toggle-overdue'): void;
  (e: 'toggle-sidebar'): void;
  (e: 'toggle-compact'): void;
  (e: 'export-ics'): void;
  (e: 'export-csv'): void;
  (e: 'select-theme', theme: string): void;
  (e: 'set-theme-mode', mode: ThemeAutoMode): void;
  (e: 'toggle-theme-polarity'): void;
  (e: 'cycle-theme', direction: 1 | -1): void;
  (e: 'cycle-canvas-intensity'): void;
  (e: 'select-custom-accent', accentId: string): void;
  (e: 'reset-custom-accent'): void;
  (e: 'toggle-high-contrast'): void;
  (e: 'toggle-shanshui-serif'): void;
  (e: 'edit-reminder', reminder: Reminder): void;
  (e: 'copy-markdown'): void;
  (e: 'optimize-db'): void;
  (e: 'quick-create', parsed: ParsedReminder): void;
  (e: 'open-window', kind: string, param?: string): void;
  (e: 'open-desktop-settings'): void;
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
    icon: 'plus',
    shortcut: '⌘N',
    action: () => emit('open-create'),
  },
  {
    id: 'act-ai',
    category: '常用指令',
    title: '唤起 AI 智能副驾驶',
    subtitle: '智能拆解任务、排期分析与日程早报',
    icon: 'sparkle',
    shortcut: '⌘J',
    action: () => emit('open-ai'),
  },
  {
    id: 'act-focus',
    category: '常用指令',
    title: hasLiveFocusActivity.value
      ? `打开专注计时窗口（${focusEngineState.isRunning ? '运行中 ' : '已暂停 '}${focusDisplayClock.value}）`
      : `启动 ${focusEngineState.prefs.focusMinutes} 分钟番茄专注模式`,
    subtitle: focusEngineState.reminderTitle
      ? `当前任务：${focusEngineState.reminderTitle} · 今日已专注 ${focusEngineState.stats.todayMinutes} 分钟`
      : '进入沉浸无干扰工作状态，支持白噪与长短休循环',
    icon: 'timer',
    shortcut: 'P',
    action: () => emit('open-focus'),
  },
  ...(hasLiveFocusActivity.value
    ? [
        {
          id: 'act-focus-toggle',
          category: '专注控制',
          title: focusEngineState.isRunning ? '暂停当前专注计时' : '继续当前专注计时',
          subtitle: `剩余 ${focusDisplayClock.value}${focusEngineState.reminderTitle ? ' · ' + focusEngineState.reminderTitle : ''}`,
          icon: 'timer',
          action: () => toggleFocusTimer(),
        },
        {
          id: 'act-focus-reset',
          category: '专注控制',
          title: '重置当前专注阶段计时',
          subtitle: '恢复到本阶段完整时长',
          icon: 'timer',
          action: () => resetFocusTimer(),
        },
      ]
    : []),
  {
    id: 'act-export-focus-md',
    category: '专注控制',
    title: '导出番茄专注效能报告 (Markdown)',
    subtitle: `包含今日目标、7 日趋势与最近记录（累计 ${focusEngineState.stats.totalSessions} 轮）`,
    icon: 'file-text',
    action: () => {
      const md = exportFocusHistoryMarkdown();
      triggerFileDownload(md, `agenda-focus-report-${new Date().toISOString().slice(0, 10)}.md`, 'text/markdown;charset=utf-8');
    },
  },
  {
    id: 'act-briefing',
    category: '常用指令',
    title: '生成每日早报',
    subtitle: '概览今日全部日程与关键要点',
    icon: 'file-text',
    action: () => emit('open-briefing'),
  },
  {
    id: 'act-solar-terms',
    category: '常用指令',
    title: '打开二十四节气与四季图鉴',
    subtitle: '查看全年 24 节气交节日期、七十二候三候物候与四时起居建议',
    icon: 'compass',
    action: () => emit('open-solar-terms'),
  },
  {
    id: 'act-stats',
    category: '常用指令',
    title: '打开生产力数据看板',
    subtitle: '查看完成率、标签分布与数据库体检',
    icon: 'bar-chart',
    action: () => emit('open-stats'),
  },
  {
    id: 'act-trash',
    category: '常用指令',
    title: '打开废纸篓',
    subtitle: '查看并恢复已删除的日程事项',
    icon: 'trash',
    action: () => emit('open-trash'),
  },
  {
    id: 'act-settings',
    category: '常用指令',
    title: '系统偏好设置...',
    subtitle: '个性化主题、提示音、提前提醒与 API 设置',
    icon: 'settings',
    action: () => emit('open-settings'),
  },
  {
    id: 'act-desktop-settings',
    category: '多窗口与后台',
    title: '桌面、托盘与后台守护设置...',
    subtitle: '管理多窗口实例、系统托盘行为、开机自启与静默驻留',
    icon: 'settings',
    action: () => emit('open-desktop-settings'),
  },
  {
    id: 'win-quick-add',
    category: '多窗口与后台',
    title: '打开快速新建悬浮窗',
    subtitle: '置顶轻量自然语言捕获窗',
    icon: 'plus',
    shortcut: '⌘⌥A',
    action: () => emit('open-window', 'quick-add'),
  },
  {
    id: 'win-tray-popover',
    category: '多窗口与后台',
    title: '打开今日速览浮窗',
    subtitle: '迷你托盘控制台：逾期、今日待办与快捷顺延',
    icon: 'compass',
    action: () => emit('open-window', 'tray-popover'),
  },
  {
    id: 'win-focus',
    category: '多窗口与后台',
    title: '弹出独立番茄专注浮窗',
    subtitle: '置顶独立计时窗，跨应用保持倒计时同步',
    icon: 'timer',
    action: () => emit('open-window', 'focus'),
  },
  {
    id: 'win-ai',
    category: '多窗口与后台',
    title: '打开独立 AI 副驾驶窗口',
    subtitle: '将 AI 智能助理停靠在主工作台一侧并行使用',
    icon: 'sparkle',
    action: () => emit('open-window', 'ai'),
  },
  {
    id: 'win-workspace-week',
    category: '多窗口与后台',
    title: '新开独立周计划视图窗口',
    subtitle: '双屏或分屏并行查看周时间线',
    icon: 'compass',
    action: () => emit('open-window', 'workspace', 'week'),
  },
  {
    id: 'win-workspace-matrix',
    category: '多窗口与后台',
    title: '新开独立四象限矩阵窗口',
    subtitle: '双屏或分屏并行拖拽优先级象限',
    icon: 'compass',
    action: () => emit('open-window', 'workspace', 'matrix'),
  },
  {
    id: 'act-shortcuts',
    category: '常用指令',
    title: '键盘快捷键速查表',
    subtitle: '掌握全部 Vim 风格与全局快捷键',
    icon: 'keyboard',
    shortcut: '?',
    action: () => emit('open-shortcuts'),
  },
  {
    id: 'act-sidebar',
    category: '界面控制',
    title: props.isSidebarCollapsed ? '展开左侧导航侧边栏' : '折叠左侧导航侧边栏',
    subtitle: '切换全宽或极简图标侧栏',
    icon: 'sidebar',
    shortcut: '⌘B',
    action: () => emit('toggle-sidebar'),
  },
  {
    id: 'act-compact',
    category: '界面控制',
    title: props.isCompactMode ? '退出紧凑小窗模式' : '进入紧凑迷你小窗模式',
    subtitle: '适应小屏或桌面浮窗摆放',
    icon: 'maximize',
    action: () => emit('toggle-compact'),
  },
  {
    id: 'act-export-ics',
    category: '数据出入',
    title: '导出 iCalendar (.ics) 日历文件',
    subtitle: '同步至 Apple 日历、Google Calendar 等系统',
    icon: 'download',
    action: () => emit('export-ics'),
  },
  {
    id: 'act-export-csv',
    category: '数据出入',
    title: '导出 Excel / CSV 标准表格',
    subtitle: '带 UTF-8 BOM 编码，Excel 直接打开不乱码',
    icon: 'download',
    action: () => emit('export-csv'),
  },
  {
    id: 'view-list',
    category: '视图导航',
    title: '切换至「任务列表视图」',
    subtitle: '高效清单、分组排序与批量处理',
    icon: 'list',
    shortcut: '1',
    action: () => emit('change-view', 'list'),
  },
  {
    id: 'view-week',
    category: '视图导航',
    title: '切换至「7 天周时间线视图」',
    subtitle: '横跨全周的直观排期与时间槽冲突排查',
    icon: 'columns',
    shortcut: '2',
    action: () => emit('change-view', 'week'),
  },
  {
    id: 'view-month',
    category: '视图导航',
    title: '切换至「全景月历视图」',
    subtitle: '月度密度分布与宏观日历规划',
    icon: 'calendar',
    shortcut: '3',
    action: () => emit('change-view', 'month'),
  },
  {
    id: 'view-matrix',
    category: '视图导航',
    title: '切换至「四象限分析矩阵」',
    subtitle: '重要与紧急维度的艾森豪威尔法则管理',
    icon: 'grid',
    shortcut: '4',
    action: () => emit('change-view', 'matrix'),
  },
  {
    id: 'filter-overdue',
    category: '视图导航',
    title: '聚焦「已逾期提醒」',
    subtitle: '快速筛选所有超期未完成事项',
    icon: 'alert',
    action: () => emit('toggle-overdue'),
  },
  {
    id: 'filter-today',
    category: '视图导航',
    title: '聚焦「今日待办事项」',
    subtitle: '专注解决今天的全部核心日程',
    icon: 'sun',
    action: () => {
      emit('change-view', 'list');
      emit('select-filter', 'today');
    },
  },
  {
    id: 'theme-polarity-toggle',
    category: '个性化主题',
    title: '明暗雅配一键互换（深墨夜 ⇄ 浅宣纸）',
    subtitle: '瞬间切换至当前主题对应的日间浅色 / 夜间深色配对主题',
    icon: 'contrast',
    shortcut: '⇧T',
    action: () => emit('toggle-theme-polarity'),
  },
  {
    id: 'theme-cycle-next',
    category: '个性化主题',
    title: '切换至下一套美学主题',
    subtitle: '依次品鉴经典工作台与二十四境美学主题',
    icon: 'arrow-right',
    shortcut: '}',
    action: () => emit('cycle-theme', 1),
  },
  {
    id: 'theme-cycle-prev',
    category: '个性化主题',
    title: '切换至上一套美学主题',
    subtitle: '向后轮换上一套工作台或山水美学配色',
    icon: 'arrow-left',
    shortcut: '{',
    action: () => emit('cycle-theme', -1),
  },
  {
    id: 'theme-canvas-intensity',
    category: '个性化主题',
    title: '循环切换背景意境画布浓度',
    subtitle: '在「素净关 / 微澜淡 / 雅致宜 / 泼墨浓」四档宣纸水墨浓度间切换',
    icon: 'droplet',
    action: () => emit('cycle-canvas-intensity'),
  },
  {
    id: 'theme-reset-accent',
    category: '个性化主题',
    title: '还原原境默认点睛色',
    subtitle: '清除自定义矿物颜料覆盖，恢复当前主题原配点睛色',
    icon: 'palette',
    action: () => emit('reset-custom-accent'),
  },
  {
    id: 'theme-toggle-high-contrast',
    category: '个性化主题',
    title: '切换高对比护眼模式',
    subtitle: '增强次级文本与面板轮廓线，适应强光或长时专注阅读',
    icon: 'contrast',
    isActiveTheme: Boolean(props.visible && getHighContrastMode()),
    action: () => emit('toggle-high-contrast'),
  },
  {
    id: 'theme-toggle-shanshui-serif',
    category: '个性化主题',
    title: '切换山水雅宋标题字体',
    subtitle: '在山水主题中启用宋刻衬线标题排版，提升书卷气韵',
    icon: 'file-text',
    isActiveTheme: Boolean(props.visible && getShanshuiSerifMode()),
    action: () => emit('toggle-shanshui-serif'),
  },
  ...(Object.entries(THEME_AUTO_MODE_LABELS) as Array<[ThemeAutoMode, { label: string; short: string; desc: string }]>).map(([mode, info]) => ({
    id: `theme-mode-${mode}`,
    category: '个性化主题',
    title: `主题模式：${info.label}`,
    subtitle: info.desc,
    icon: mode === 'seasonal' ? 'leaf' : mode === 'circadian' ? 'clock' : mode === 'system' ? 'settings' : 'layers',
    isActiveTheme: Boolean(props.visible && getThemeAutoMode() === mode),
    action: () => emit('set-theme-mode', mode),
  })),
  {
    id: 'theme-auto-shanshui',
    category: '个性化主题',
    title: '随晨昏光影自动切换山水主题',
    subtitle: '依据当前十二时辰自动匹配最宜人的中国山水配色',
    icon: 'mountain',
    action: () => emit('select-theme', getRecommendedShanshuiThemeForTime(new Date())),
  },
  {
    id: 'theme-seasonal-shanshui',
    category: '个性化主题',
    title: '依四时物候入画中国山水',
    subtitle: '结合春夏秋冬节气物候与昼夜自动择取山水印境',
    icon: 'mountain',
    action: () => emit('select-theme', getSeasonalShanshuiRecommendation(new Date())),
  },
  {
    id: 'theme-random-shanshui',
    category: '个性化主题',
    title: '随机邂逅一境中国山水',
    subtitle: '从十九境历代山水丹青中随机切换另一境风物',
    icon: 'mountain',
    action: () => {
      const current = normalizeThemeId(props.currentTheme);
      const pool = getShanshuiThemes().filter((t) => t.id !== current);
      const pick = pool[Math.floor(Math.random() * pool.length)] || getShanshuiThemes()[0];
      if (pick) emit('select-theme', pick.id);
    },
  },
  ...CUSTOM_ACCENT_PRESETS.filter((p) => p.hex).map((p) => ({
    id: `accent-preset-${p.id}`,
    category: '个性化主题',
    title: `叠加矿物点睛色：${p.name} (${p.hex})`,
    subtitle: p.desc || `将全局高亮与交互点睛色切换为传统矿物「${p.name}」`,
    icon: 'theme-swatch',
    themeColor: p.hex,
    themeSecondaryColor: p.hex,
    themeSealChar: p.badge,
    isActiveTheme: Boolean(props.visible && getCustomAccentOverride() === p.id),
    action: () => emit('select-custom-accent', p.id),
  })),
  ...THEME_DEFINITIONS.map((t) => {
    const isActive = normalizeThemeId(props.currentTheme) === t.id;
    return {
      id: `theme-${t.id}`,
      category: '个性化主题',
      title: `切换主题：${t.name}${t.badge ? ` (${t.badge})` : ''}`,
      subtitle: `${t.pigment ? `[${t.pigment}] ` : ''}${t.poem ? `${t.poem} · ` : ''}${t.desc}`,
      icon: 'theme-swatch',
      themeColor: t.color,
      themeSecondaryColor: t.secondaryColor || t.sealColor || t.color,
      themeSealChar: t.sealChar,
      themeToneLabel: t.isLight ? '浅' : '深',
      isActiveTheme: isActive,
      action: () => emit('select-theme', t.id),
    };
  }),
  {
    id: 'export-markdown',
    category: '数据与维护',
    title: '导出待办清单为 Markdown (复制)',
    subtitle: '一键将当前待办排期导出并写入系统剪贴板',
    icon: 'copy',
    action: () => emit('copy-markdown'),
  },
  {
    id: 'db-optimize',
    category: '数据与维护',
    title: '数据库体检与整理 (VACUUM)',
    subtitle: '检测 SQLite 完整性并回收碎片空间',
    icon: 'zap',
    action: () => emit('optimize-db'),
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
  const isQuickAddPrefix = rawQ.startsWith('+');

  const cleanQ = (isActionOnly || isReminderOnly || isTagOnly || isQuickAddPrefix ? rawQ.slice(1) : rawQ).trim().toLowerCase();

  if (isQuickAddPrefix && cleanQ) {
    const parsed = parseNaturalReminder(rawQ.slice(1).trim());
    const d = formatDateLabel(parsed.scheduledAt);
    const t = formatTime(parsed.scheduledAt);
    matches.push({
      id: 'nlp-quick-create',
      category: '自然语言速建',
      title: `快速创建：「${parsed.title}」`,
      subtitle: `${d.label} ${t} · ${(parsed.priority || 'p2').toUpperCase()}${parsed.tags ? ' · #' + parsed.tags : ''}`,
      icon: 'zap',
      shortcut: '↵',
      action: () => emit('quick-create', parsed),
    });
  }

  // 1. Static action matches (if not in reminder-only or tag-only mode)
  if (!isReminderOnly && !isTagOnly) {
    for (const cmd of staticCommands.value) {
      if (
        !cleanQ ||
        fuzzyMatchPinyin(cmd.title, cleanQ) ||
        (cmd.subtitle && fuzzyMatchPinyin(cmd.subtitle, cleanQ)) ||
        fuzzyMatchPinyin(cmd.category, cleanQ)
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
        parseReminderTags(reminder.tags).some((tag) => fuzzyMatchPinyin(tag, cleanQ))
      );
    } else if (cleanQ) {
      reminderPool = reminderPool.filter(
        (r) =>
          fuzzyMatchPinyin(r.title, cleanQ) ||
          (r.notes && fuzzyMatchPinyin(r.notes, cleanQ)) ||
          (r.tags && fuzzyMatchPinyin(r.tags, cleanQ))
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
        icon: r.priority === 'p0' ? 'alert' : 'bell',
        action: () => emit('edit-reminder', r),
      });
    }
  }

  if (!isQuickAddPrefix && !isActionOnly && !isReminderOnly && !isTagOnly && rawQ.length >= 2) {
    const parsed = parseNaturalReminder(rawQ);
    const d = formatDateLabel(parsed.scheduledAt);
    const t = formatTime(parsed.scheduledAt);
    matches.push({
      id: 'nlp-fallback-create',
      category: '自然语言速建',
      title: `直接新建日程：「${parsed.title}」`,
      subtitle: `${d.label} ${t} · ${(parsed.priority || 'p2').toUpperCase()}${parsed.tags ? ' · #' + parsed.tags : ''}`,
      icon: 'zap',
      action: () => emit('quick-create', parsed),
    });
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

function setQueryPrefix(prefix: string) {
  query.value = prefix;
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function clearPaletteQuery() {
  query.value = '';
  nextTick(() => {
    inputRef.value?.focus();
  });
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="command-palette-overlay" @click.self="$emit('close')">
      <div class="command-palette-card glass-panel bg-crosshair-grid" role="dialog" aria-modal="true" aria-label="命令面板">
        <!-- Search Input Area -->
        <div class="palette-input-wrap">
          <svg class="palette-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="18" height="18" aria-hidden="true">
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

          <button v-if="query" type="button" class="palette-clear-btn" title="清空关键词" aria-label="清空关键词" @click="clearPaletteQuery">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <kbd class="palette-esc-kbd" title="退出" @click="$emit('close')">ESC</kbd>
        </div>

        <!-- Command List Scroll Area -->
        <div id="agenda-command-list" ref="listRef" class="palette-scroll-area" role="listbox" aria-label="命令和日程结果">
          <div v-if="filteredCommands.length === 0" class="palette-empty">
            <span class="empty-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
                <line x1="8.5" y1="11" x2="13.5" y2="11" />
              </svg>
            </span>
            <span class="empty-text">未找到匹配的指令或日程：“{{ query }}”</span>
            <button type="button" class="palette-reset-btn" @click="clearPaletteQuery">清空筛选查看全部指令</button>
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
                  <span class="item-icon" aria-hidden="true">
                    <span
                      v-if="item.icon === 'theme-swatch'"
                      class="cmd-theme-swatch"
                      :style="{
                        background: item.themeColor || 'var(--tide)',
                        boxShadow: `inset -6px 0 0 ${item.themeSecondaryColor || item.themeColor || 'var(--tide)'}`,
                      }"
                    ></span>
                    <svg v-else-if="item.icon === 'plus'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                    <svg v-else-if="item.icon === 'sparkle'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
                    <svg v-else-if="item.icon === 'timer'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 1.5" /><path d="M9 2h6" /></svg>
                    <svg v-else-if="item.icon === 'file-text'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
                    <svg v-else-if="item.icon === 'compass'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
                    <svg v-else-if="item.icon === 'bar-chart'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                    <svg v-else-if="item.icon === 'trash'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    <svg v-else-if="item.icon === 'settings'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.4.55.72 1 .84.17.05.34.07.51.07H21a2 2 0 0 1 0 4h-.09c-.17 0-.34.02-.51.07-.45.12-.8.44-1 .84z" /></svg>
                    <svg v-else-if="item.icon === 'keyboard'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10" /></svg>
                    <svg v-else-if="item.icon === 'sidebar'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /></svg>
                    <svg v-else-if="item.icon === 'maximize'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></svg>
                    <svg v-else-if="item.icon === 'download'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    <svg v-else-if="item.icon === 'list'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
                    <svg v-else-if="item.icon === 'columns'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /><line x1="15" y1="4" x2="15" y2="20" /></svg>
                    <svg v-else-if="item.icon === 'calendar'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    <svg v-else-if="item.icon === 'grid'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>
                    <svg v-else-if="item.icon === 'alert'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12.5" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                    <svg v-else-if="item.icon === 'sun'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
                    <svg v-else-if="item.icon === 'contrast'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" stroke="none" /></svg>
                    <svg v-else-if="item.icon === 'arrow-right'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                    <svg v-else-if="item.icon === 'arrow-left'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
                    <svg v-else-if="item.icon === 'droplet'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" /></svg>
                    <svg v-else-if="item.icon === 'palette'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" /></svg>
                    <svg v-else-if="item.icon === 'leaf'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></svg>
                    <svg v-else-if="item.icon === 'clock'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>
                    <svg v-else-if="item.icon === 'layers'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
                    <svg v-else-if="item.icon === 'mountain'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z" /></svg>
                    <svg v-else-if="item.icon === 'copy'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    <svg v-else-if="item.icon === 'zap'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                  </span>
                  <div class="item-text-wrap">
                    <span class="item-title">{{ item.title }}</span>
                    <span v-if="item.subtitle" class="item-subtitle">{{ item.subtitle }}</span>
                  </div>
                </div>

                <div class="item-right">
                  <span v-if="item.themeSealChar" class="cmd-seal-chip">{{ item.themeSealChar }}</span>
                  <span v-if="item.themeToneLabel" class="cmd-tone-chip">{{ item.themeToneLabel }}</span>
                  <span v-if="item.isActiveTheme" class="cmd-active-pill">当前</span>
                  <kbd v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</kbd>
                  <span v-if="filteredCommands[selectedIndex]?.id === item.id" class="item-enter-hint" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 10 4 15 9 20" />
                      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Palette Footer Hint Bar -->
      <div class="palette-footer">
        <div class="footer-tips">
          <button type="button" class="tip-item tip-btn" title="快速过滤日程" @click="setQueryPrefix('@')"><kbd class="kbd-mini">@</kbd> 搜日程</button>
          <button type="button" class="tip-item tip-btn" title="快速过滤动作" @click="setQueryPrefix('>')"><kbd class="kbd-mini">&gt;</kbd> 搜动作</button>
          <button type="button" class="tip-item tip-btn" title="快速过滤标签" @click="setQueryPrefix('#')"><kbd class="kbd-mini">#</kbd> 搜标签</button>
          <span class="tip-item"><kbd class="kbd-mini">↑↓</kbd> 导航</span>
          <span class="tip-item"><kbd class="kbd-mini">↵</kbd> 执行</span>
          <span class="tip-item"><kbd class="kbd-mini">Esc</kbd> 退出</span>
        </div>
        <span class="footer-brand">Agenda Butler Spotlight</span>
      </div>
    </div>
  </div>
  </Transition>
</template>

<style scoped>
.command-palette-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-scrim);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  z-index: var(--z-command);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10.5vh;
}

.command-palette-card {
  width: 620px;
  max-width: 92vw;
  max-height: 72vh;
  border-radius: 18px;
  border: 1px solid var(--accent-border);
  background: color-mix(in oklab, var(--surface-raised) 95%, transparent);
  box-shadow: var(--shadow-lg), 0 0 0 1px var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.palette-clear-btn {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  background: var(--fill-hover);
  color: var(--text-tertiary);
  cursor: pointer;
  flex: none;
  transition: color var(--motion-fast), background var(--motion-fast);
}

.palette-clear-btn:hover {
  color: var(--text-primary);
  background: var(--border-subtle);
}

.palette-reset-btn {
  margin-top: 4px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--tide-text);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}

.palette-reset-btn:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
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
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.palette-item.active .item-icon {
  border-color: var(--accent-border);
  background: var(--surface-raised);
  color: var(--tide-text);
}
.cmd-theme-swatch {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--text-primary) 26%, transparent);
}
.cmd-seal-chip {
  min-width: 17px;
  height: 17px;
  display: inline-grid;
  place-items: center;
  padding: 0 3px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--seal-red, #e05246) 60%, transparent);
  background: color-mix(in srgb, var(--seal-red, #e05246) 14%, transparent);
  color: var(--seal-red, #e05246);
  font-family: "Songti SC", "STSong", "Noto Serif SC", serif;
  font-size: 9.5px;
  font-weight: 700;
}
.cmd-tone-chip {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  font: 700 9px var(--font-mono);
}
.cmd-active-pill {
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font: 700 9.5px var(--font-mono);
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

.tip-btn {
  padding: 2px 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  transition: color var(--motion-fast), background var(--motion-fast);
}

.tip-btn:hover {
  color: var(--text-primary);
  background: var(--fill-hover);
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
