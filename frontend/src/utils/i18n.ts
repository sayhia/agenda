import { ref } from 'vue';

export type Language = 'zh-CN' | 'en-US';

const STORAGE_KEY = 'agenda_app_language';

const currentLang = ref<Language>(
  (typeof localStorage !== 'undefined' && (localStorage.getItem(STORAGE_KEY) as Language)) || 'zh-CN'
);

const translations: Record<Language, Record<string, string>> = {
  'zh-CN': {
    'app.title': '日程管家',
    'nav.all': '全部日程',
    'nav.today': '今日待办',
    'nav.upcoming': '近期安排',
    'nav.archive': '历史归档',
    'nav.trash': '废纸篓',
    'action.create': '新建日程',
    'action.quick_add': '闪电速记',
    'action.ai_assistant': 'AI 助理',
    'action.settings': '偏好设置',
    'action.export': '导出待办',
    'status.active': '待推进',
    'status.ended': '已完结',
    'status.paused': '已暂缓',
    'priority.p0': 'P0 极紧急',
    'priority.p1': 'P1 重要',
    'priority.p2': 'P2 普通',
    'priority.p3': 'P3 低优先级',
    'next_up': '下一个日程',
    'snooze': '推迟顺延',
    'snooze.15m': '+15 分钟',
    'snooze.60m': '+1 小时',
    'snooze.tomorrow': '明天 09:00',
    'snooze.weekend': '本周末 (周六)',
    'snooze.monday': '下周一 09:00',
    'duplicate': '复刻日程',
    'duplicate.tomorrow': '排期至明天 (+1天)',
    'duplicate.nextweek': '克隆为下周同时间 (+7天)',
    'tag.and': '且 AND (全部匹配)',
    'tag.or': '或 OR (任一匹配)',
    'focus.start': '开启专注',
    'focus.break': '小憩休整',
    'focus.sprint': '15m 极速冲刺',
    'focus.classic': '25m 经典专注',
    'focus.deep': '50m 深度工作',
    'ai.breakdown': '5步里程碑',
    'ai.timebox': '今日时间箱',
    'ai.conflict': '排查冲突',
    'ai.verbs': '强动词提炼',
  },
  'en-US': {
    'app.title': 'Agenda Butler',
    'nav.all': 'All Reminders',
    'nav.today': 'Today',
    'nav.upcoming': 'Upcoming',
    'nav.archive': 'Archive',
    'nav.trash': 'Trash',
    'action.create': 'New Reminder',
    'action.quick_add': 'Quick Add',
    'action.ai_assistant': 'AI Assistant',
    'action.settings': 'Settings',
    'action.export': 'Export Tasks',
    'status.active': 'Active',
    'status.ended': 'Completed',
    'status.paused': 'Paused',
    'priority.p0': 'P0 Critical',
    'priority.p1': 'P1 High',
    'priority.p2': 'P2 Medium',
    'priority.p3': 'P3 Low',
    'next_up': 'Next Up',
    'snooze': 'Snooze',
    'snooze.15m': '+15 min',
    'snooze.60m': '+1 hour',
    'snooze.tomorrow': 'Tomorrow 09:00',
    'snooze.weekend': 'This Weekend',
    'snooze.monday': 'Next Monday 09:00',
    'duplicate': 'Duplicate',
    'duplicate.tomorrow': 'Postpone to tomorrow (+1d)',
    'duplicate.nextweek': 'Clone to next week (+7d)',
    'tag.and': 'AND (All tags)',
    'tag.or': 'OR (Any tag)',
    'focus.start': 'Start Focus',
    'focus.break': 'Take a Break',
    'focus.sprint': '15m Sprint',
    'focus.classic': '25m Classic',
    'focus.deep': '50m Deep Work',
    'ai.breakdown': '5-Step Breakdown',
    'ai.timebox': 'Timebox Schedule',
    'ai.conflict': 'Deconflict',
    'ai.verbs': 'Action Verbs',
  },
};

export function getLanguage(): Language {
  return currentLang.value;
}

export function setLanguage(lang: Language): void {
  currentLang.value = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
}

export function t(key: string, fallback?: string): string {
  const dict = translations[currentLang.value];
  if (dict && dict[key]) {
    return dict[key];
  }
  return fallback || key;
}
