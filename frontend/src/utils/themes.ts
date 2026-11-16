import { getSeasonalShanshuiRecommendation } from './shanshui.ts';
import type { SoundProfile } from './audio.ts';

export type ThemeAutoMode = 'manual' | 'circadian' | 'seasonal' | 'system';
export type CanvasIntensity = 'off' | 'subtle' | 'balanced' | 'vivid';

export interface CustomAccentPreset {
  id: string;
  name: string;
  badge: string;
  hex: string;
  desc?: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  color: string;
  secondaryColor?: string;
  bgPreview: string;
  sealColor?: string;
  sealChar?: string;
  badge?: string;
  pigment?: string;
  poem?: string;
  isLight?: boolean;
  group: 'curated' | 'shanshui';
  counterpartId: string;
  seasonHint?: '春' | '夏' | '秋' | '冬';
  recommendedSound?: SoundProfile;
  desc: string;
  icon: string;
}

export const THEME_STORAGE_KEY = 'agenda_theme';
export const THEME_MODE_STORAGE_KEY = 'agenda_theme_mode';
export const THEME_FAVORITES_STORAGE_KEY = 'agenda_favorite_themes';
export const THEME_RECENTS_STORAGE_KEY = 'agenda_recent_themes';
export const SOUND_FOLLOW_THEME_KEY = 'agenda_sound_follow_theme';
export const CANVAS_INTENSITY_STORAGE_KEY = 'agenda_canvas_intensity';
export const CUSTOM_ACCENT_STORAGE_KEY = 'agenda_custom_accent';
export const SHANSHUI_SERIF_STORAGE_KEY = 'agenda_shanshui_serif';
export const HIGH_CONTRAST_STORAGE_KEY = 'agenda_high_contrast';

export const CANVAS_INTENSITY_LABELS: Record<CanvasIntensity, { label: string; desc: string }> = {
  off: { label: '关闭', desc: '关闭山岚流云动效与底纹，纯享极简聚焦空间' },
  subtle: { label: '淡雅', desc: '轻墨淡岚与微弱宣纸纹路（约 55% 浓度）' },
  balanced: { label: '适中', desc: '兼顾层次与正文阅读清晰度的平衡浓度（默认）' },
  vivid: { label: '浓郁', desc: '浓墨重彩的山岚流云与光晕质感（约 145% 浓度）' },
};

export const CUSTOM_ACCENT_PRESETS: CustomAccentPreset[] = [
  { id: 'default', name: '原色', badge: '原', hex: '', desc: '保留当前主题原配矿物或潮汐点睛色' },
  { id: 'shiqing', name: '石青', badge: '青', hex: '#2e86de', desc: '北宋矿青，沉稳澄净' },
  { id: 'shilv', name: '石绿', badge: '绿', hex: '#2ba87c', desc: '青绿山水主色，温润养眼' },
  { id: 'zhusha', name: '朱砂', badge: '朱', hex: '#d9483b', desc: '印章丹砂，醒目提神' },
  { id: 'tenghuang', name: '藤黄', badge: '黄', hex: '#d4941e', desc: '秋林银杏，暖金明快' },
  { id: 'huaqing', name: '花青', badge: '靛', hex: '#3b6ea5', desc: '江南靛蓝，清雅含蓄' },
  { id: 'xionghuang', name: '雄黄', badge: '橙', hex: '#d9822b', desc: '敦煌砂岩暖橙，朝霞入画' },
  { id: 'zitan', name: '紫檀', badge: '檀', hex: '#8b5cf6', desc: '紫矿幽兰，灵动深邃' },
  { id: 'tianlan', name: '霁蓝', badge: '蓝', hex: '#00a3ff', desc: '晴空潮汐，极客利落' },
];

export const THEME_AUTO_MODE_LABELS: Record<ThemeAutoMode, { label: string; short: string; desc: string }> = {
  manual: { label: '固定自选', short: '固定', desc: '始终保持您手动选定的当前主题' },
  circadian: { label: '昼夜流转', short: '昼夜', desc: '06:30–18:30 自动使用对应浅色系，入夜切换深墨夜配色' },
  seasonal: { label: '四时入画', short: '四时', desc: '依二十四节气、四季物候与十二时辰自动甄选山水印境' },
  system: { label: '跟随系统', short: '系统', desc: '响应系统浅色 / 深色外观，自动在雅配明暗主题间切换' },
};

export const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    id: 'midnight',
    name: 'Scrolltide 曜石',
    color: '#46b7ff',
    secondaryColor: '#d9ff54',
    bgPreview: '#07080a',
    group: 'curated',
    counterpartId: 'daylight',
    recommendedSound: 'crystal',
    desc: '深海曜石黑配潮汐蓝与青柠高反差（默认）',
    icon: '●',
  },
  {
    id: 'daylight',
    name: 'Roadmap 晴石',
    color: '#0086d1',
    secondaryColor: '#d9ff54',
    bgPreview: '#f3f4ef',
    isLight: true,
    group: 'curated',
    counterpartId: 'midnight',
    recommendedSound: 'crystal',
    desc: 'Scrolltide /ui 同款暖白编排工作台（浅色）',
    icon: '○',
  },
  {
    id: 'cyber',
    name: 'Midwater 碧潮',
    color: '#00d2ef',
    secondaryColor: '#00d294',
    bgPreview: '#070b0e',
    group: 'curated',
    counterpartId: 'daylight',
    recommendedSound: 'cyber',
    desc: '深海电光青与澄净高对比光影',
    icon: '◇',
  },
  {
    id: 'amber',
    name: 'Ember 琥珀',
    color: '#ff8b1a',
    secondaryColor: '#46b7ff',
    bgPreview: '#0b0806',
    group: 'curated',
    counterpartId: 'shanshui-dunhuang',
    recommendedSound: 'crystal',
    desc: '余晖暖金与深邃曜石双地平线',
    icon: '◈',
  },
  {
    id: 'aurora',
    name: 'Orchid 幻紫',
    color: '#a685ff',
    secondaryColor: '#ec6cff',
    bgPreview: '#09070d',
    group: 'curated',
    counterpartId: 'shanshui-tianqing',
    recommendedSound: 'zen',
    desc: '幽兰紫韵漩涡强调色',
    icon: '✦',
  },
  {
    id: 'shanshui-jiangshan',
    name: '千里江山 · 宋韵宣纸',
    color: '#156a7a',
    secondaryColor: '#2e8b66',
    bgPreview: '#f4efe4',
    sealColor: '#c83c32',
    sealChar: '江',
    badge: '宣纸浅色',
    pigment: '石青 · 石绿 · 古宣纸',
    poem: '青绿千里写丹青，留白宣纸见山川',
    isLight: true,
    group: 'shanshui',
    counterpartId: 'shanshui-huangshan',
    seasonHint: '夏',
    recommendedSound: 'guqin',
    desc: '北宋青绿设色配暖古熟宣纸，日间温润护眼（浅色）',
    icon: '⛰',
  },
  {
    id: 'shanshui-huangshan',
    name: '黄山 · 云海松墨',
    color: '#4cd98b',
    secondaryColor: '#dbeafe',
    bgPreview: '#080c0a',
    sealColor: '#f87171',
    sealChar: '松',
    badge: '黄山',
    pigment: '松烟墨 · 石绿 · 云白',
    poem: '五岳归来不看山，云海青松立翠微',
    group: 'shanshui',
    counterpartId: 'shanshui-jiangshan',
    seasonHint: '夏',
    recommendedSound: 'qing',
    desc: '徽墨玄夜铺底，迎客松绿配漫天云海月白',
    icon: '⛰',
  },
  {
    id: 'shanshui-potala',
    name: '布达拉 · 松烟翠微',
    color: '#27cc93',
    secondaryColor: '#f0cf65',
    bgPreview: '#07100c',
    sealColor: '#f26d5b',
    sealChar: '雪',
    badge: '雪域',
    pigment: '孔雀石绿 · 泥金 · 松墨',
    poem: '雪域高原松烟色，金顶微茫映翠微',
    group: 'shanshui',
    counterpartId: 'shanshui-changbai',
    seasonHint: '冬',
    recommendedSound: 'qing',
    desc: '松烟苍翠绿配雪域金晖，清冽松墨底色',
    icon: '⛰',
  },
  {
    id: 'shanshui-guilin',
    name: '桂林漓江 · 烟雨赭岚',
    color: '#ee8c52',
    secondaryColor: '#63dfc0',
    bgPreview: '#110c08',
    sealColor: '#e85d56',
    sealChar: '岚',
    badge: '漓江',
    pigment: '赭石 · 螺青 · 沉香墨',
    poem: '江作青罗带，山如碧玉篸',
    group: 'shanshui',
    counterpartId: 'shanshui-jiangnan',
    seasonHint: '秋',
    recommendedSound: 'droplet',
    desc: '山水赭茶暖棕配漓江翠青，沉香檀木底色',
    icon: '⛰',
  },
  {
    id: 'shanshui-sanxia',
    name: '长江三峡 · 夔门靛蓝',
    color: '#529bff',
    secondaryColor: '#7ce8ff',
    bgPreview: '#070b14',
    sealColor: '#f06a6a',
    sealChar: '峡',
    badge: '三峡',
    pigment: '花青 · 靛蓝 · 银涛灰',
    poem: '朝辞白帝彩云间，千里江陵一日还',
    group: 'shanshui',
    counterpartId: 'shanshui-changbai',
    seasonHint: '夏',
    recommendedSound: 'droplet',
    desc: '青花靛蓝配江涛银辉，夜江深蓝底色',
    icon: '⛰',
  },
  {
    id: 'shanshui-taishan',
    name: '东岳泰山 · 日出绛紫',
    color: '#bc7ef2',
    secondaryColor: '#f5bf6b',
    bgPreview: '#0d0912',
    sealColor: '#f46b78',
    sealChar: '岳',
    badge: '泰山',
    pigment: '紫矿 · 雄黄金 · 绛墨',
    poem: '会当凌绝顶，一览众山小',
    group: 'shanshui',
    counterpartId: 'shanshui-qixia',
    seasonHint: '秋',
    recommendedSound: 'qing',
    desc: '玉兰紫薇配东岳晨曦金，紫檀暮色底色',
    icon: '⛰',
  },
  {
    id: 'shanshui-xihu',
    name: '杭州西湖 · 三潭苔绿',
    color: '#9ec938',
    secondaryColor: '#5ce0c4',
    bgPreview: '#0b0e08',
    sealColor: '#ef6f6c',
    sealChar: '湖',
    badge: '西湖',
    pigment: '藤黄柳绿 · 蟹壳青 · 竹墨',
    poem: '水光潋滟晴方好，山色空蒙雨亦奇',
    group: 'shanshui',
    counterpartId: 'shanshui-suzhou',
    seasonHint: '春',
    recommendedSound: 'guqin',
    desc: '柳青橄榄苔绿配西湖碧波，竹影青墨底色',
    icon: '⛰',
  },
  {
    id: 'shanshui-lushan',
    name: '庐山 · 飞瀑苍崖',
    color: '#38d2e6',
    secondaryColor: '#7be078',
    bgPreview: '#060c10',
    sealColor: '#ee6352',
    sealChar: '瀑',
    badge: '匡庐',
    pigment: '苍崖石青 · 飞瀑银练 · 蕨苔绿',
    poem: '飞流直下三千尺，疑是银河落九天',
    group: 'shanshui',
    counterpartId: 'shanshui-tianqing',
    seasonHint: '夏',
    recommendedSound: 'droplet',
    desc: '幽涧苍崖墨底配飞瀑银蓝，云岚清冽通透',
    icon: '⛰',
  },
  {
    id: 'shanshui-jiangnan',
    name: '江南 · 烟雨徽宣',
    color: '#2a7b6f',
    secondaryColor: '#8c4a5e',
    bgPreview: '#eef1ed',
    sealColor: '#c44138',
    sealChar: '徽',
    badge: '烟雨浅色',
    pigment: '粉墙黛瓦 · 翠竹青黛 · 梅渍褐',
    poem: '春水碧于天，画船听雨眠',
    isLight: true,
    group: 'shanshui',
    counterpartId: 'shanshui-xihu',
    seasonHint: '春',
    recommendedSound: 'guqin',
    desc: '粉墙徽宣浅色系，清雅竹青与梅褐留白',
    icon: '☀',
  },
  {
    id: 'shanshui-emei',
    name: '峨眉 · 金顶云海',
    color: '#eab354',
    secondaryColor: '#4dd4b0',
    bgPreview: '#080d0c',
    sealColor: '#eb6752',
    sealChar: '峨',
    badge: '金顶',
    pigment: '佛光金碧 · 峨眉冷翠 · 云岫玄青',
    poem: '青冥倚天开，彩翠如可掬',
    group: 'shanshui',
    counterpartId: 'shanshui-dunhuang',
    seasonHint: '冬',
    recommendedSound: 'qing',
    desc: '云岫深黛底色配金顶佛光金与冷翠松碧',
    icon: '⛰',
  },
  {
    id: 'shanshui-dunhuang',
    name: '敦煌 · 鸣沙霁宣',
    color: '#267a6b',
    secondaryColor: '#b84a39',
    bgPreview: '#f5efe2',
    sealColor: '#c44634',
    sealChar: '敦',
    badge: '鸣沙浅色',
    pigment: '大漠素宣 · 莫高石绿 · 丹砂赭红',
    poem: '大漠孤烟直，长河落日圆',
    isLight: true,
    group: 'shanshui',
    counterpartId: 'shanshui-zhangjiajie',
    seasonHint: '秋',
    recommendedSound: 'zen',
    desc: '鸣沙暖宣浅色系，石绿与赭砂点染莫高古韵',
    icon: '☀',
  },
  {
    id: 'shanshui-jiuzhaigou',
    name: '九寨 · 彩池碧琉',
    color: '#2cd4c4',
    secondaryColor: '#f2c96d',
    bgPreview: '#070d10',
    sealColor: '#ee6a59',
    sealChar: '九',
    badge: '九寨',
    pigment: '孔雀石绿 · 钙华鎏金 · 渊潭墨',
    poem: '九寨归来不看水，瑶池叠翠映秋林',
    group: 'shanshui',
    counterpartId: 'shanshui-tianqing',
    seasonHint: '夏',
    recommendedSound: 'droplet',
    desc: '深幽海子墨底配五花池碧琉璃与钙华金',
    icon: '⛰',
  },
  {
    id: 'shanshui-suzhou',
    name: '姑苏 · 竹影月洞',
    color: '#236e56',
    secondaryColor: '#566c80',
    bgPreview: '#f1f4ee',
    sealColor: '#c13e34',
    sealChar: '园',
    badge: '姑苏浅色',
    pigment: '姑苏素宣 · 墨竹苍翠 · 太湖石青',
    poem: '竹径通幽处，禅房花木深',
    isLight: true,
    group: 'shanshui',
    counterpartId: 'shanshui-qingcheng',
    seasonHint: '春',
    recommendedSound: 'guqin',
    desc: '园林月洞粉墙浅色，青竹黛瓦移步换景',
    icon: '☀',
  },
  {
    id: 'shanshui-zhangjiajie',
    name: '武陵 · 丹崖云柱',
    color: '#e57c4b',
    secondaryColor: '#5bc8ba',
    bgPreview: '#0c0a0b',
    sealColor: '#ee6055',
    sealChar: '陵',
    badge: '武陵',
    pigment: '砂岩赤赭 · 云海石青 · 玄崖墨',
    poem: '奇峰三千拔地起，云涛万里绕丹崖',
    group: 'shanshui',
    counterpartId: 'shanshui-qixia',
    seasonHint: '秋',
    recommendedSound: 'qing',
    desc: '玄崖深墨托举丹崖赤赭与松林云青',
    icon: '⛰',
  },
  {
    id: 'shanshui-changbai',
    name: '长白 · 天池雪霁',
    color: '#1b5fa8',
    secondaryColor: '#3b9b8e',
    bgPreview: '#eff3f8',
    sealColor: '#c8423a',
    sealChar: '池',
    badge: '天池浅色',
    pigment: '霁雪生宣 · 天池钴蓝 · 玄武青灰',
    poem: '千峰雪霁连天碧，一鉴寒潭照玉京',
    isLight: true,
    group: 'shanshui',
    counterpartId: 'shanshui-erhai',
    seasonHint: '冬',
    recommendedSound: 'qing',
    desc: '长白霜雪冷白生宣配天池钴蓝与玄武灰',
    icon: '☀',
  },
  {
    id: 'shanshui-tianqing',
    name: '汝窑 · 雨过天青宣',
    color: '#2d7e8a',
    secondaryColor: '#489d86',
    bgPreview: '#ebf2f1',
    sealColor: '#c64838',
    sealChar: '汝',
    badge: '天青浅色',
    pigment: '天青瓷釉 · 卵青素宣 · 玛瑙微红',
    poem: '雨过天青云破处，这般颜色做将来',
    isLight: true,
    group: 'shanshui',
    counterpartId: 'shanshui-erhai',
    seasonHint: '春',
    recommendedSound: 'droplet',
    desc: '宋代汝窑雨过天青釉色配素雅湿润青瓷宣纸（浅色）',
    icon: '☀',
  },
  {
    id: 'shanshui-qixia',
    name: '栖霞 · 霜叶流丹宣',
    color: '#b8442a',
    secondaryColor: '#9c6a12',
    bgPreview: '#f9f1e9',
    sealColor: '#c43b2b',
    sealChar: '霞',
    badge: '霜叶浅色',
    pigment: '栖霞枫丹 · 古银杏黄 · 暖象牙宣',
    poem: '停车坐爱枫林晚，霜叶红于二月花',
    isLight: true,
    group: 'shanshui',
    counterpartId: 'shanshui-taishan',
    seasonHint: '秋',
    recommendedSound: 'guqin',
    desc: '栖霞古寺秋枫宣纸，朱丹霜叶配暖金银杏（浅色）',
    icon: '☀',
  },
  {
    id: 'shanshui-erhai',
    name: '苍山洱海 · 风花澄碧',
    color: '#38bdf8',
    secondaryColor: '#7be4d0',
    bgPreview: '#060c13',
    sealColor: '#f06a5c',
    sealChar: '洱',
    badge: '苍洱',
    pigment: '苍山靛墨 · 洱海晴蓝 · 上关苍雪',
    poem: '下关风，上关花，苍山雪，洱海月',
    group: 'shanshui',
    counterpartId: 'shanshui-tianqing',
    seasonHint: '春',
    recommendedSound: 'droplet',
    desc: '苍山深青靛墨铺底，洱海月光晴蓝澄澈如镜',
    icon: '⛰',
  },
  {
    id: 'shanshui-qingcheng',
    name: '青城 · 幽篁道韵',
    color: '#3ecf8e',
    secondaryColor: '#e8c55a',
    bgPreview: '#070e0b',
    sealColor: '#e96754',
    sealChar: '幽',
    badge: '青城',
    pigment: '老君阁金 · 幽篁竹墨 · 石阶青苔',
    poem: '拜水都江堰，问道青城山',
    group: 'shanshui',
    counterpartId: 'shanshui-suzhou',
    seasonHint: '夏',
    recommendedSound: 'zen',
    desc: '青城天下幽玄竹深墨配道观鎏金与翠竹苍青',
    icon: '⛰',
  },
];

const LEGACY_THEME_ALIASES: Record<string, string> = {
  obsidian: 'midnight',
  'rmb-100': 'midnight',
  'rmb-50': 'shanshui-potala',
  'rmb-20': 'shanshui-guilin',
  'rmb-10': 'shanshui-sanxia',
  'rmb-5': 'shanshui-taishan',
  'rmb-1': 'shanshui-xihu',
};

export function normalizeThemeId(themeId?: string | null): string {
  const id = (themeId || '').trim();
  if (!id) return 'midnight';
  const resolved = LEGACY_THEME_ALIASES[id] || id;
  if (THEME_DEFINITIONS.some((t) => t.id === resolved)) return resolved;
  return 'midnight';
}

export function getThemeDefinition(themeId?: string | null): ThemeDefinition | undefined {
  const normalized = normalizeThemeId(themeId);
  return THEME_DEFINITIONS.find((t) => t.id === normalized);
}

export function isShanshuiThemeId(themeId?: string | null): boolean {
  const normalized = normalizeThemeId(themeId);
  return normalized.startsWith('shanshui-');
}

export function isLightThemeId(themeId?: string | null): boolean {
  return Boolean(getThemeDefinition(themeId)?.isLight);
}

export function getShanshuiThemes(): ThemeDefinition[] {
  return THEME_DEFINITIONS.filter((t) => t.group === 'shanshui');
}

export function getPairedThemeId(themeId?: string | null): string {
  const def = getThemeDefinition(themeId);
  return def?.counterpartId || (def?.isLight ? 'midnight' : 'daylight');
}

export function toggleThemePolarity(themeId?: string | null): string {
  return getPairedThemeId(themeId);
}

export function cycleTheme(
  currentThemeId?: string | null,
  direction: 1 | -1 = 1,
  filter: 'all' | 'shanshui' | 'light' | 'dark' = 'all',
): ThemeDefinition {
  let pool = THEME_DEFINITIONS;
  if (filter === 'shanshui') pool = THEME_DEFINITIONS.filter((t) => t.group === 'shanshui');
  else if (filter === 'light') pool = THEME_DEFINITIONS.filter((t) => t.isLight);
  else if (filter === 'dark') pool = THEME_DEFINITIONS.filter((t) => !t.isLight);
  if (!pool.length) pool = THEME_DEFINITIONS;

  const normalized = normalizeThemeId(currentThemeId);
  const idx = pool.findIndex((t) => t.id === normalized);
  if (idx === -1) return pool[0];
  const nextIdx = (idx + direction + pool.length) % pool.length;
  return pool[nextIdx];
}

export function getThemeAutoMode(): ThemeAutoMode {
  if (typeof localStorage === 'undefined') return 'manual';
  const raw = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (raw === 'circadian' || raw === 'seasonal' || raw === 'system' || raw === 'manual') return raw;
  return 'manual';
}

export function setThemeAutoMode(mode: ThemeAutoMode): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:theme-mode-change', { detail: mode }));
  }
}

export function getFavoriteThemeIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(THEME_FAVORITES_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(THEME_DEFINITIONS.map((t) => t.id));
    return parsed.map((id) => normalizeThemeId(String(id))).filter((id, i, arr) => valid.has(id) && arr.indexOf(id) === i);
  } catch {
    return [];
  }
}

export function toggleFavoriteThemeId(themeId: string): string[] {
  const normalized = normalizeThemeId(themeId);
  const current = getFavoriteThemeIds();
  const next = current.includes(normalized)
    ? current.filter((id) => id !== normalized)
    : [...current, normalized];
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_FAVORITES_STORAGE_KEY, JSON.stringify(next));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:favorite-themes-change', { detail: next }));
  }
  return next;
}

export function getRecentThemeIds(limit = 5): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(THEME_RECENTS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(THEME_DEFINITIONS.map((t) => t.id));
    return parsed
      .map((id) => normalizeThemeId(String(id)))
      .filter((id, i, arr) => valid.has(id) && arr.indexOf(id) === i)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function recordRecentThemeId(themeId: string, limit = 5): string[] {
  const normalized = normalizeThemeId(themeId);
  const current = getRecentThemeIds(limit);
  const next = [normalized, ...current.filter((id) => id !== normalized)].slice(0, limit);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_RECENTS_STORAGE_KEY, JSON.stringify(next));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:recent-themes-change', { detail: next }));
  }
  return next;
}

export type ThemeFilterCategory = 'all' | 'curated' | 'shanshui' | 'light' | 'dark' | 'fav';
export type ThemeSeasonFilter = 'all' | '春' | '夏' | '秋' | '冬';

const THEME_SEARCH_ALIASES: Record<string, string> = {
  midnight: 'obsidian dark scrolltide yaoshi 曜石 深海',
  daylight: 'light white roadmap qingshi 晴石 白天 日间',
  cyber: 'cyan teal neon bichao 碧潮 赛博 科技',
  amber: 'orange gold warm hupo 琥珀 暖色 余晖',
  aurora: 'purple violet orchid huanzi 幻紫 极光',
  'shanshui-jiangshan': 'qianlijiangshan song xuan paper qinglv light',
  'shanshui-huangshan': 'huangshan songmo yunhai pine dark',
  'shanshui-potala': 'budala xizang tibet snow green gold',
  'shanshui-guilin': 'guilin lijiang karst brown warm',
  'shanshui-sanxia': 'changjiang sanxia yangtze indigo blue',
  'shanshui-taishan': 'taishan sunrise purple gold',
  'shanshui-xihu': 'hangzhou xihu westlake moss green',
  'shanshui-lushan': 'lushan kuanglu waterfall cyan',
  'shanshui-jiangnan': 'jiangnan huizhou rain light',
  'shanshui-emei': 'emei jinding gold emerald',
  'shanshui-dunhuang': 'dunhuang mingsha desert sand light',
  'shanshui-jiuzhaigou': 'jiuzhaigou pools jade turquoise',
  'shanshui-suzhou': 'suzhou gusu bamboo garden light',
  'shanshui-zhangjiajie': 'zhangjiajie wuling sandstone',
  'shanshui-changbai': 'changbai tianchi snow lake light',
  'shanshui-tianqing': 'ruyao celadon rain sky blue light',
  'shanshui-qixia': 'qixia maple autumn red light',
  'shanshui-erhai': 'cangshan erhai dali lake blue',
  'shanshui-qingcheng': 'qingcheng bamboo daoist green',
};

export function filterThemes(options?: {
  category?: ThemeFilterCategory;
  season?: ThemeSeasonFilter;
  query?: string;
  favoriteIds?: string[];
}): ThemeDefinition[] {
  const category = options?.category ?? 'all';
  const season = options?.season ?? 'all';
  const favs = options?.favoriteIds ?? getFavoriteThemeIds();

  let list = THEME_DEFINITIONS;
  if (category === 'curated') list = list.filter((t) => t.group === 'curated');
  else if (category === 'shanshui') list = list.filter((t) => t.group === 'shanshui');
  else if (category === 'light') list = list.filter((t) => t.isLight);
  else if (category === 'dark') list = list.filter((t) => !t.isLight);
  else if (category === 'fav') list = list.filter((t) => favs.includes(t.id));

  if (season !== 'all') {
    list = list.filter((t) => t.seasonHint === season);
  }

  const q = (options?.query || '').trim().toLowerCase();
  if (!q) return list;

  return list.filter((t) => {
    const alias = THEME_SEARCH_ALIASES[t.id] || '';
    const polarity = t.isLight ? '浅色 日间 light xuan' : '深色 夜间 dark ink';
    return `${t.id} ${t.name} ${t.badge || ''} ${t.pigment || ''} ${t.poem || ''} ${t.desc} ${t.seasonHint || ''} ${polarity} ${alias}`
      .toLowerCase()
      .includes(q);
  });
}

export function getThemeBackgroundHex(themeId?: string | null): string {
  return getThemeDefinition(themeId)?.bgPreview || '#07080a';
}

export function getShanshuiSerifMode(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SHANSHUI_SERIF_STORAGE_KEY) === 'true';
}

export function setShanshuiSerifMode(enabled: boolean): boolean {
  const val = Boolean(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SHANSHUI_SERIF_STORAGE_KEY, String(val));
  }
  if (typeof document !== 'undefined') {
    if (val) document.documentElement.setAttribute('data-shanshui-serif', 'true');
    else document.documentElement.removeAttribute('data-shanshui-serif');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:theme-prefs-change', { detail: { shanshuiSerif: val } }));
  }
  return val;
}

export function getHighContrastMode(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === 'true';
}

export function setHighContrastMode(enabled: boolean): boolean {
  const val = Boolean(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, String(val));
  }
  if (typeof document !== 'undefined') {
    if (val) document.documentElement.setAttribute('data-high-contrast', 'true');
    else document.documentElement.removeAttribute('data-high-contrast');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:theme-prefs-change', { detail: { highContrast: val } }));
  }
  return val;
}

export function getThemePrimaryColor(themeId?: string | null, customAccentOverride?: string | null): string {
  const customHex = resolveCustomAccentHex(customAccentOverride ?? getCustomAccentOverride());
  if (customHex) return customHex;
  return getThemeDefinition(themeId)?.color || '#46b7ff';
}

export function validateThemeDefinitions(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const t of THEME_DEFINITIONS) {
    if (ids.has(t.id)) errors.push(`duplicate theme id: ${t.id}`);
    ids.add(t.id);
    if (!normalizeHexColor(t.color)) errors.push(`invalid primary color for ${t.id}`);
    if (!normalizeHexColor(t.bgPreview)) errors.push(`invalid bgPreview for ${t.id}`);
    const pair = THEME_DEFINITIONS.find((p) => p.id === t.counterpartId);
    if (!pair) errors.push(`missing counterpart for ${t.id}`);
    else if (Boolean(pair.isLight) === Boolean(t.isLight)) errors.push(`same polarity counterpart for ${t.id}`);
    if (t.group === 'shanshui' && (!t.sealChar || !t.pigment || !t.poem || !t.seasonHint)) {
      errors.push(`incomplete shanshui metadata for ${t.id}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function getSoundFollowTheme(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SOUND_FOLLOW_THEME_KEY) === 'true';
}

export function setSoundFollowTheme(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SOUND_FOLLOW_THEME_KEY, String(enabled));
}

export function isDaytimeHour(date: Date = new Date()): boolean {
  const mins = date.getHours() * 60 + date.getMinutes();
  return mins >= 6 * 60 + 30 && mins < 18 * 60 + 30;
}

export function resolveEffectiveThemeId(options?: {
  baseThemeId?: string | null;
  mode?: ThemeAutoMode;
  now?: Date;
  systemPrefersDark?: boolean;
}): string {
  const storedBase = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null;
  const base = normalizeThemeId(options?.baseThemeId ?? storedBase);
  const mode = options?.mode ?? getThemeAutoMode();
  const now = options?.now ?? new Date();

  if (mode === 'seasonal') {
    return normalizeThemeId(getSeasonalShanshuiRecommendation(now));
  }

  if (mode === 'circadian') {
    const def = getThemeDefinition(base);
    const shouldBeLight = isDaytimeHour(now);
    if (Boolean(def?.isLight) === shouldBeLight) return base;
    return getPairedThemeId(base);
  }

  if (mode === 'system') {
    const prefersDark =
      typeof options?.systemPrefersDark === 'boolean'
        ? options.systemPrefersDark
        : typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
          : true;
    const def = getThemeDefinition(base);
    const shouldBeLight = !prefersDark;
    if (Boolean(def?.isLight) === shouldBeLight) return base;
    return getPairedThemeId(base);
  }

  return base;
}

const OVERRIDE_CSS_VARS = [
  '--accent',
  '--accent-hover',
  '--accent-text',
  '--accent-soft',
  '--accent-border',
  '--accent-shadow',
  '--tide',
  '--tide-hover',
  '--tide-text',
  '--brand-primary',
  '--brand-light',
  '--brand-dark',
  '--border-brand',
  '--fill-active',
  '--ink-on-accent',
] as const;

export function normalizeHexColor(raw?: string | null): string | null {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  const full = /^#([0-9a-f]{6})$/.exec(s);
  if (full) return `#${full[1]}`;
  const short = /^#([0-9a-f]{3})$/.exec(s);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const norm = normalizeHexColor(hex);
  if (!norm) return null;
  const n = parseInt(norm.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgbHex(rgb: [number, number, number], target: [number, number, number], weight: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(rgb[0] * (1 - weight) + target[0] * weight);
  const g = clamp(rgb[1] * (1 - weight) + target[1] * weight);
  const b = clamp(rgb[2] * (1 - weight) + target[2] * weight);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2]);
}

export function getContrastRatio(hexA: string, hexB: string): number {
  const l1 = getRelativeLuminance(hexA);
  const l2 = getRelativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * 依据 WCAG 相对亮度计算高对比前景色（阈值 0.179 为黑白对比度几何均点，确保 ≥ 4.5:1 AA 对比度）
 */
export function pickReadableInk(hex: string): '#0b0d10' | '#ffffff' {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const lum = getRelativeLuminance(hex);
  return lum > 0.179 ? '#0b0d10' : '#ffffff';
}

export function getCanvasIntensity(): CanvasIntensity {
  if (typeof localStorage === 'undefined') return 'balanced';
  const raw = localStorage.getItem(CANVAS_INTENSITY_STORAGE_KEY);
  if (raw === 'off' || raw === 'subtle' || raw === 'balanced' || raw === 'vivid') return raw;
  return 'balanced';
}

export function setCanvasIntensity(level: CanvasIntensity): CanvasIntensity {
  const valid: CanvasIntensity =
    level === 'off' || level === 'subtle' || level === 'balanced' || level === 'vivid'
      ? level
      : 'balanced';
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CANVAS_INTENSITY_STORAGE_KEY, valid);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-canvas-intensity', valid);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:canvas-intensity-change', { detail: valid }));
  }
  return valid;
}

export function cycleCanvasIntensity(): CanvasIntensity {
  const order: CanvasIntensity[] = ['off', 'subtle', 'balanced', 'vivid'];
  const curr = getCanvasIntensity();
  const next = order[(order.indexOf(curr) + 1) % order.length];
  return setCanvasIntensity(next);
}

export function resolveCustomAccentHex(raw?: string | null): string | null {
  const val = (raw || '').trim();
  if (!val || val === 'default') return null;
  const preset = CUSTOM_ACCENT_PRESETS.find((p) => p.id === val);
  if (preset) return normalizeHexColor(preset.hex);
  return normalizeHexColor(val);
}

export function getCustomAccentOverride(): string {
  if (typeof localStorage === 'undefined') return 'default';
  const raw = (localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY) || '').trim();
  if (!raw || raw === 'default') return 'default';
  const preset = CUSTOM_ACCENT_PRESETS.find((p) => p.id === raw);
  if (preset && preset.hex) return preset.id;
  return normalizeHexColor(raw) || 'default';
}

function applyCustomAccentVarsToRoot(root: HTMLElement, overrideIdOrHex: string, isLight: boolean): void {
  const hex = resolveCustomAccentHex(overrideIdOrHex);
  const rgb = hex ? hexToRgb(hex) : null;
  if (!hex || !rgb) {
    for (const prop of OVERRIDE_CSS_VARS) {
      root.style.removeProperty(prop);
    }
    root.removeAttribute('data-custom-accent');
    root.removeAttribute('data-accent-customized');
    return;
  }

  const hoverHex = isLight ? mixRgbHex(rgb, [0, 0, 0], 0.14) : mixRgbHex(rgb, [255, 255, 255], 0.16);
  const darkHex = mixRgbHex(rgb, [0, 0, 0], 0.28);
  const textHex = isLight ? mixRgbHex(rgb, [14, 18, 24], 0.28) : mixRgbHex(rgb, [255, 255, 255], 0.32);
  const softRgba = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${isLight ? 0.11 : 0.15})`;
  const borderRgba = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${isLight ? 0.38 : 0.42})`;
  const shadowRgba = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${isLight ? 0.20 : 0.28})`;
  const ink = pickReadableInk(hex);

  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-hover', hoverHex);
  root.style.setProperty('--accent-text', textHex);
  root.style.setProperty('--accent-soft', softRgba);
  root.style.setProperty('--accent-border', borderRgba);
  root.style.setProperty('--accent-shadow', shadowRgba);
  root.style.setProperty('--tide', hex);
  root.style.setProperty('--tide-hover', hoverHex);
  root.style.setProperty('--tide-text', textHex);
  root.style.setProperty('--brand-primary', hex);
  root.style.setProperty('--brand-light', textHex);
  root.style.setProperty('--brand-dark', darkHex);
  root.style.setProperty('--border-brand', borderRgba);
  root.style.setProperty('--fill-active', softRgba);
  root.style.setProperty('--ink-on-accent', ink);
  root.setAttribute('data-custom-accent', overrideIdOrHex);
  root.setAttribute('data-accent-customized', 'true');
}

export function setCustomAccentOverride(presetIdOrHex: string): string {
  const trimmed = (presetIdOrHex || '').trim();
  let normalized = 'default';
  if (trimmed && trimmed !== 'default') {
    const preset = CUSTOM_ACCENT_PRESETS.find((p) => p.id === trimmed);
    if (preset && preset.hex) normalized = preset.id;
    else normalized = normalizeHexColor(trimmed) || 'default';
  }

  if (typeof localStorage !== 'undefined') {
    if (normalized === 'default') localStorage.removeItem(CUSTOM_ACCENT_STORAGE_KEY);
    else localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, normalized);
  }
  if (typeof document !== 'undefined') {
    const isLight = document.documentElement.getAttribute('data-color-scheme') === 'light';
    applyCustomAccentVarsToRoot(document.documentElement, normalized, isLight);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:accent-change', { detail: normalized }));
  }
  return normalized;
}

function syncThemeMetaColor(bgHex: string): void {
  if (typeof document === 'undefined' || !document.head) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = bgHex;
}

let themeSwitchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 将主题完整且原子化地应用到 documentElement，避免明暗样式/画布/印章状态不同步
 */
export function applyThemeToDocument(
  themeId?: string | null,
  options?: { animate?: boolean; persist?: boolean; dispatch?: boolean },
): string {
  const normalized = normalizeThemeId(themeId);
  const def = getThemeDefinition(normalized);
  const colorScheme = def?.isLight ? 'light' : 'dark';
  const group = def?.group || 'curated';
  const canvasIntensity = getCanvasIntensity();
  const accentOverride = getCustomAccentOverride();
  const shanshuiSerif = getShanshuiSerifMode();
  const highContrast = getHighContrastMode();
  const bgHex = def?.bgPreview || '#07080a';

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (options?.animate) {
      root.setAttribute('data-theme-switching', 'true');
      if (themeSwitchTimer) clearTimeout(themeSwitchTimer);
      themeSwitchTimer = setTimeout(() => {
        root.removeAttribute('data-theme-switching');
      }, 280);
    }

    if (normalized === 'midnight') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', normalized);
    }
    root.setAttribute('data-color-scheme', colorScheme);
    root.setAttribute('data-theme-polarity', colorScheme);
    root.setAttribute('data-theme-group', group);
    root.setAttribute('data-canvas-intensity', canvasIntensity);
    if (def?.seasonHint) {
      root.setAttribute('data-theme-season', def.seasonHint);
    } else {
      root.removeAttribute('data-theme-season');
    }
    if (shanshuiSerif) root.setAttribute('data-shanshui-serif', 'true');
    else root.removeAttribute('data-shanshui-serif');
    if (highContrast) root.setAttribute('data-high-contrast', 'true');
    else root.removeAttribute('data-high-contrast');

    root.style.setProperty('--theme-secondary', def?.secondaryColor || def?.color || '#d9ff54');
    root.style.colorScheme = colorScheme;
    root.style.backgroundColor = bgHex;
    syncThemeMetaColor(bgHex);
    applyCustomAccentVarsToRoot(root, accentOverride, colorScheme === 'light');
  }

  if (options?.persist && typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, normalized);
    recordRecentThemeId(normalized);
  }
  if (options?.dispatch && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:theme-change', { detail: normalized }));
  }

  return normalized;
}

export interface ThemeConfigSnapshot {
  version: 1 | 2;
  theme: string;
  autoMode: ThemeAutoMode;
  favorites: string[];
  soundFollowTheme: boolean;
  canvasIntensity: CanvasIntensity;
  customAccent: string;
  shanshuiSerif?: boolean;
  highContrast?: boolean;
}

export function exportThemeConfigJSON(): string {
  const baseTheme =
    typeof localStorage !== 'undefined'
      ? normalizeThemeId(localStorage.getItem(THEME_STORAGE_KEY))
      : 'midnight';
  const payload: ThemeConfigSnapshot = {
    version: 2,
    theme: baseTheme,
    autoMode: getThemeAutoMode(),
    favorites: getFavoriteThemeIds(),
    soundFollowTheme: getSoundFollowTheme(),
    canvasIntensity: getCanvasIntensity(),
    customAccent: getCustomAccentOverride(),
    shanshuiSerif: getShanshuiSerifMode(),
    highContrast: getHighContrastMode(),
  };
  return JSON.stringify(payload, null, 2);
}

export function importThemeConfigJSON(
  rawJson: string,
): { ok: true; themeId: string } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '配置格式无效：需要 JSON 对象' };
    }

    const baseTheme = normalizeThemeId(typeof parsed.theme === 'string' ? parsed.theme : 'midnight');
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, baseTheme);
    }

    const modeRaw = parsed.autoMode;
    const mode: ThemeAutoMode =
      modeRaw === 'circadian' || modeRaw === 'seasonal' || modeRaw === 'system' || modeRaw === 'manual'
        ? modeRaw
        : 'manual';
    setThemeAutoMode(mode);

    if (Array.isArray(parsed.favorites) && typeof localStorage !== 'undefined') {
      const validIds = new Set(THEME_DEFINITIONS.map((t) => t.id));
      const cleanFavs = parsed.favorites
        .map((id: unknown) => normalizeThemeId(String(id)))
        .filter((id: string, idx: number, arr: string[]) => validIds.has(id) && arr.indexOf(id) === idx);
      localStorage.setItem(THEME_FAVORITES_STORAGE_KEY, JSON.stringify(cleanFavs));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('agenda:favorite-themes-change', { detail: cleanFavs }));
      }
    }

    if (typeof parsed.soundFollowTheme === 'boolean') {
      setSoundFollowTheme(parsed.soundFollowTheme);
    }

    const intensityRaw = parsed.canvasIntensity;
    setCanvasIntensity(
      intensityRaw === 'off' || intensityRaw === 'subtle' || intensityRaw === 'balanced' || intensityRaw === 'vivid'
        ? intensityRaw
        : 'balanced',
    );

    setCustomAccentOverride(typeof parsed.customAccent === 'string' ? parsed.customAccent : 'default');
    setShanshuiSerifMode(typeof parsed.shanshuiSerif === 'boolean' ? parsed.shanshuiSerif : false);
    setHighContrastMode(typeof parsed.highContrast === 'boolean' ? parsed.highContrast : false);

    const resolved = applyThemeToDocument(resolveEffectiveThemeId({ baseThemeId: baseTheme, mode }), {
      animate: true,
      dispatch: true,
    });
    return { ok: true, themeId: resolved };
  } catch {
    return { ok: false, error: '无法解析 JSON，请检查配置内容是否完整' };
  }
}

export function resetThemePreferences(): string {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, 'midnight');
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'manual');
    localStorage.setItem(THEME_FAVORITES_STORAGE_KEY, '[]');
    localStorage.setItem(THEME_RECENTS_STORAGE_KEY, '[]');
    localStorage.setItem(SOUND_FOLLOW_THEME_KEY, 'false');
    localStorage.setItem(CANVAS_INTENSITY_STORAGE_KEY, 'balanced');
    localStorage.removeItem(CUSTOM_ACCENT_STORAGE_KEY);
    localStorage.removeItem(SHANSHUI_SERIF_STORAGE_KEY);
    localStorage.removeItem(HIGH_CONTRAST_STORAGE_KEY);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute('data-shanshui-serif');
    document.documentElement.removeAttribute('data-high-contrast');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agenda:favorite-themes-change', { detail: [] }));
    window.dispatchEvent(new CustomEvent('agenda:recent-themes-change', { detail: [] }));
    window.dispatchEvent(
      new CustomEvent('agenda:theme-prefs-change', { detail: { shanshuiSerif: false, highContrast: false } }),
    );
  }
  return applyThemeToDocument('midnight', { animate: true, dispatch: true });
}
