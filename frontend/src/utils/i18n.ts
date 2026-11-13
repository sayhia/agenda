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
