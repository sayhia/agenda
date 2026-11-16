/**
 * 中国传统山水印境、二十四节气与十二时辰辅助工具
 */

export interface ChineseShichen {
  branch: string
  alias: string
  poeticHint: string
}

export interface SolarTermInfo {
  name: string
  season: '春' | '夏' | '秋' | '冬'
  sealChar: string
  verse: string
}

export interface SolarTermDetail extends SolarTermInfo {
  index: number
  month: number
  day: number
  date: Date
  dateKey: string
  monthDayLabel: string
  sanHou: string
  custom: string
}

export interface FourSeasonInfo {
  season: '春' | '夏' | '秋' | '冬'
  title: string
  alias: string
  sealChar: string
  color: string
  poem: string
  atmosphere: string
  tea: string
  rhythmAdvice: string
  recommendedThemeIds: string[]
}

export interface ShanshuiProverb {
  text: string
  source: string
}

export interface SeasonalAtmosphere {
  season: '春' | '夏' | '秋' | '冬'
  particleType: 'petal' | 'firefly' | 'maple' | 'snow'
  auraLabel: string
  teaSuggestion: string
}

export interface ShanshuiThemeAtmosphere {
  mood: string
  motif:
    | 'waterfall'
    | 'alpine'
    | 'sunhalo'
    | 'karst'
    | 'moonwindow'
    | 'caldera'
    | 'cascade-pools'
    | 'geese'
    | 'rain-ripples'
    | 'bamboo-mist'
  inkTone: string
}

const SHICHEN_TABLE: Array<{ branch: string; alias: string; poeticHint: string }> = [
  { branch: '子', alias: '夜半', poeticHint: '万籁归寂，夜墨生辉' },
  { branch: '丑', alias: '鸡鸣', poeticHint: '星沉幽壑，静候曦微' },
  { branch: '寅', alias: '平旦', poeticHint: '烟岚初动，东方既白' },
  { branch: '卯', alias: '日出', poeticHint: '晨雾散林，宜启新篇' },
  { branch: '辰', alias: '食时', poeticHint: '朝光映水，清气盈窗' },
  { branch: '巳', alias: '隅中', poeticHint: '晴岚高照，思虑澄明' },
  { branch: '午', alias: '日中', poeticHint: '山影正中，宜小憩养神' },
  { branch: '未', alias: '日昳', poeticHint: '风清砚润，从容致远' },
  { branch: '申', alias: '哺时', poeticHint: '斜阳染翠，渐收诸务' },
  { branch: '酉', alias: '日入', poeticHint: '暮霞归岫，灯火初明' },
  { branch: '戌', alias: '黄昏', poeticHint: '山寺钟沉，宜复盘沉思' },
  { branch: '亥', alias: '人定', poeticHint: '夜深纸静，安顿身心' },
]

// 24 节气二十一世纪寿星天文常量（2000-2099 年零误差基准）与三候物候元数据
const SOLAR_TERM_ANCHORS: Array<{
  month: number
  day: number
  c21: number
  c20: number
  name: string
  season: '春' | '夏' | '秋' | '冬'
  sealChar: string
  verse: string
  sanHou: string
  custom: string
}> = [
  { month: 1, day: 5, c21: 5.4055, c20: 6.11, name: '小寒', season: '冬', sealChar: '寒', verse: '松风清冽，围炉煮雪', sanHou: '雁北乡 · 鹊始巢 · 雉始雊', custom: '宜早卧迟起，温补养藏' },
  { month: 1, day: 20, c21: 20.12, c20: 20.84, name: '大寒', season: '冬', sealChar: '冰', verse: '霜华满径，静待春信', sanHou: '鸡乳 · 征鸟厉疾 · 水泽腹坚', custom: '宜迎年除旧，暖茶固本' },
  { month: 2, day: 4, c21: 3.87, c20: 4.15, name: '立春', season: '春', sealChar: '春', verse: '东风解冻，草木初萌', sanHou: '东风解冻 · 蛰虫始振 · 鱼陟负冰', custom: '宜立春启志，疏肝舒怀' },
  { month: 2, day: 19, c21: 18.73, c20: 19.04, name: '雨水', season: '春', sealChar: '润', verse: '好雨知时，山翠欲滴', sanHou: '獭祭鱼 · 鸿雁来 · 草木萌动', custom: '宜健脾防湿，散步林涧' },
  { month: 3, day: 5, c21: 5.63, c20: 6.11, name: '惊蛰', season: '春', sealChar: '雷', verse: '春雷启蛰，万物生发', sanHou: '桃始华 · 仓庚鸣 · 鹰化为鸠', custom: '宜早起舒展，春令生发' },
  { month: 3, day: 20, c21: 20.646, c20: 21.0, name: '春分', season: '春', sealChar: '分', verse: '昼夜均停，柳烟花雾', sanHou: '玄鸟至 · 雷乃发声 · 始电', custom: '宜调和阴阳，踏青观云' },
  { month: 4, day: 4, c21: 4.81, c20: 5.59, name: '清明', season: '春', sealChar: '清', verse: '气清景明，踏青寻幽', sanHou: '桐始华 · 田鼠化为鴽 · 虹始见', custom: '宜郊野行吟，烹新试茶' },
  { month: 4, day: 20, c21: 20.1, c20: 20.888, name: '谷雨', season: '春', sealChar: '茶', verse: '雨生百谷，新茶初焙', sanHou: '萍始生 · 鸣鸠拂其羽 · 戴胜降于桑', custom: '宜品明前茶，润燥生津' },
  { month: 5, day: 5, c21: 5.52, c20: 6.318, name: '立夏', season: '夏', sealChar: '夏', verse: '绿树阴浓，山溪流翠', sanHou: '蝼蝈鸣 · 蚯蚓出 · 王瓜生', custom: '宜养心安神，午时小憩' },
  { month: 5, day: 21, c21: 21.04, c20: 21.86, name: '小满', season: '夏', sealChar: '盈', verse: '小得盈满，水墨留白', sanHou: '苦菜秀 · 靡草死 · 麦秋至', custom: '宜清淡戒燥，留白致远' },
  { month: 6, day: 5, c21: 5.678, c20: 6.5, name: '芒种', season: '夏', sealChar: '耕', verse: '时雨及芒，忙而不乱', sanHou: '螳螂生 · 鵙始鸣 · 反舌无声', custom: '宜忙中取静，顺时而作' },
  { month: 6, day: 21, c21: 21.37, c20: 22.2, name: '夏至', season: '夏', sealChar: '至', verse: '昼长蝉鸣，荷风送凉', sanHou: '鹿角解 · 蜩始鸣 · 半夏生', custom: '宜静心避暑，夜读清话' },
  { month: 7, day: 7, c21: 7.108, c20: 7.928, name: '小暑', season: '夏', sealChar: '暑', verse: '竹影摇风，寻溪避暄', sanHou: '温风至 · 蟋蟀居宇 · 鹰始鸷', custom: '宜消暑静虑，少动寡欲' },
  { month: 7, day: 22, c21: 22.83, c20: 23.65, name: '大暑', season: '夏', sealChar: '莲', verse: '菡萏初开，心静自凉', sanHou: '腐草为萤 · 土润溽暑 · 大雨时行', custom: '宜赏荷品茗，清凉调息' },
  { month: 8, day: 7, c21: 7.5, c20: 8.35, name: '立秋', season: '秋', sealChar: '秋', verse: '一叶知秋，云淡天高', sanHou: '凉风至 · 白露降 · 寒蝉鸣', custom: '宜收敛神气，早睡早起' },
  { month: 8, day: 23, c21: 23.13, c20: 23.95, name: '处暑', season: '秋', sealChar: '爽', verse: '暑气渐收，秋水澄明', sanHou: '鹰乃祭鸟 · 天地始肃 · 禾乃登', custom: '宜滋阴润肺，登高望远' },
  { month: 9, day: 7, c21: 7.646, c20: 8.44, name: '白露', season: '秋', sealChar: '露', verse: '蒹葭苍苍，白露为霜', sanHou: '鸿雁来 · 玄鸟归 · 群鸟养羞', custom: '宜添衣防露，夜饮桂酿' },
  { month: 9, day: 23, c21: 23.042, c20: 23.822, name: '秋分', season: '秋', sealChar: '桂', verse: '丹桂飘香，山水澄澈', sanHou: '雷始收声 · 蛰虫坯户 · 水始涸', custom: '宜平分秋色，复盘总结' },
  { month: 10, day: 8, c21: 8.318, c20: 9.098, name: '寒露', season: '秋', sealChar: '枫', verse: '霜叶红于，万山层染', sanHou: '鸿雁来宾 · 雀入大水为蛤 · 菊有黄华', custom: '宜赏枫品菊，静读修心' },
  { month: 10, day: 23, c21: 23.438, c20: 24.218, name: '霜降', season: '秋', sealChar: '霜', verse: '木叶微脱，暮霭清寒', sanHou: '豺乃祭兽 · 草木黄落 · 蛰虫咸俯', custom: '宜温胃护足，深耕主业' },
  { month: 11, day: 7, c21: 7.438, c20: 8.218, name: '立冬', season: '冬', sealChar: '冬', verse: '水始冰寒，墨韵凝香', sanHou: '水始冰 · 地始冻 · 雉入大水为蜃', custom: '宜静养潜藏，围炉筹划' },
  { month: 11, day: 22, c21: 22.36, c20: 23.08, name: '小雪', season: '冬', sealChar: '雪', verse: '微雪初霁，远岫含黛', sanHou: '虹藏不见 · 天气上升 · 闭塞成冬', custom: '宜晒冬日暖阳，焙茶暖胃' },
  { month: 12, day: 7, c21: 7.18, c20: 7.9, name: '大雪', season: '冬', sealChar: '素', verse: '千山暮雪，素宣铺陈', sanHou: '鹖鴠不鸣 · 虎始交 · 荔挺出', custom: '宜深居简出，沉淀思虑' },
  { month: 12, day: 21, c21: 21.94, c20: 22.6, name: '冬至', season: '冬', sealChar: '阳', verse: '一阳初复，岁寒知松', sanHou: '蚯蚓结 · 麋角解 · 水泉动', custom: '宜数九消寒，蓄力来春' },
]

const FOUR_SEASONS_META: FourSeasonInfo[] = [
  {
    season: '春',
    title: '春 · 万物生发',
    alias: '青阳',
    sealChar: '春',
    color: '#34b87a',
    poem: '竹外桃花三两枝，春江水暖鸭先知',
    atmosphere: '风柔雨润 · 烟柳画船',
    tea: '明前龙井 · 白毫银针',
    rhythmAdvice: '春主生发，宜于清晨卯巳之间起草规划、拓展新局。',
    recommendedThemeIds: ['shanshui-suzhou', 'shanshui-tianqing', 'shanshui-xihu', 'shanshui-erhai', 'shanshui-jiangnan'],
  },
  {
    season: '夏',
    title: '夏 · 繁荫流光',
    alias: '朱明',
    sealChar: '夏',
    color: '#2cb5c8',
    poem: '绿树阴浓夏日长，楼台倒影入池塘',
    atmosphere: '苍崖飞瀑 · 荷风溪泉',
    tea: '竹叶青 · 冷泡碧螺春',
    rhythmAdvice: '夏宜养心静虑，午时宜小憩避暄，夜晚宜深研难题。',
    recommendedThemeIds: ['shanshui-jiangshan', 'shanshui-lushan', 'shanshui-qingcheng', 'shanshui-jiuzhaigou', 'shanshui-sanxia'],
  },
  {
    season: '秋',
    title: '秋 · 金风澄肃',
    alias: '素秋',
    sealChar: '秋',
    color: '#d98a38',
    poem: '空山新雨后，天气晚来秋',
    atmosphere: '丹崖层染 · 暮霞归岫',
    tea: '武夷岩茶 · 金骏眉',
    rhythmAdvice: '秋主收敛，宜清点成果、复盘归档，删繁就简。',
    recommendedThemeIds: ['shanshui-qixia', 'shanshui-dunhuang', 'shanshui-taishan', 'shanshui-zhangjiajie', 'shanshui-guilin'],
  },
  {
    season: '冬',
    title: '冬 · 素雪闭藏',
    alias: '玄冬',
    sealChar: '冬',
    color: '#5a94e0',
    poem: '晚来天欲雪，能饮一杯无',
    atmosphere: '素宣晴雪 · 围炉松墨',
    tea: '陈年普洱 · 老寿眉',
    rhythmAdvice: '冬主闭藏蓄能，宜深耕核心长远要务，厚积薄发。',
    recommendedThemeIds: ['shanshui-changbai', 'shanshui-potala', 'shanshui-huangshan', 'shanshui-emei'],
  },
]

function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function calcSolarTermDay(year: number, anchorIndex: number): number {
  const anchor = SOLAR_TERM_ANCHORS[anchorIndex]
  if (year >= 2000 && year <= 2099) {
    const y = year % 100
    const L = Math.floor(y / 4)
    return Math.floor(y * 0.2422 + anchor.c21) - L
  }
  if (year >= 1900 && year <= 1999) {
    const y = year % 100
    const L = Math.floor(y / 4)
    return Math.floor(y * 0.2422 + anchor.c20) - L
  }
  return anchor.day
}

function buildSolarTermDetail(year: number, anchorIndex: number): SolarTermDetail {
  const anchor = SOLAR_TERM_ANCHORS[anchorIndex]
  const day = calcSolarTermDay(year, anchorIndex)
  const date = new Date(year, anchor.month - 1, day)
  return {
    index: anchorIndex,
    name: anchor.name,
    season: anchor.season,
    sealChar: anchor.sealChar,
    verse: anchor.verse,
    month: anchor.month,
    day,
    date,
    dateKey: formatDateKey(date),
    monthDayLabel: `${anchor.month}月${day}日`,
    sanHou: anchor.sanHou,
    custom: anchor.custom,
  }
}

const solarTermsYearCache = new Map<number, SolarTermDetail[]>()

/**
 * 获取指定年份完整的二十四节气天文交节与物候列表
 */
export function getAllSolarTerms(year: number = new Date().getFullYear()): SolarTermDetail[] {
  let cached = solarTermsYearCache.get(year)
  if (!cached) {
    cached = SOLAR_TERM_ANCHORS.map((_, idx) => buildSolarTermDetail(year, idx))
    if (solarTermsYearCache.size > 24) solarTermsYearCache.clear()
    solarTermsYearCache.set(year, cached)
  }
  return cached
}

/**
 * 按四季（春/夏/秋/冬）筛选当季六个节气
 */
export function getSolarTermsBySeason(
  season: '春' | '夏' | '秋' | '冬',
  year: number = new Date().getFullYear(),
): SolarTermDetail[] {
  return getAllSolarTerms(year).filter((t) => t.season === season)
}

/**
 * 判断指定公历日期是否恰好为二十四节气交节当日
 */
export function getSolarTermOnDate(date: Date): SolarTermDetail | null {
  if (Number.isNaN(date.getTime())) return null
  const key = formatDateKey(date)
  const terms = getAllSolarTerms(date.getFullYear())
  return terms.find((t) => t.dateKey === key) || null
}

/**
 * 获取距离指定日期最近的下一个交节节气与剩余天数
 */
export function getNextSolarTerm(date: Date = new Date()): { term: SolarTermDetail; daysRemaining: number } {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const candidates = [
    ...getAllSolarTerms(date.getFullYear()),
    ...getAllSolarTerms(date.getFullYear() + 1),
  ]
  for (const term of candidates) {
    if (term.date.getTime() > dayStart.getTime()) {
      const daysRemaining = Math.round((term.date.getTime() - dayStart.getTime()) / 86_400_000)
      return { term, daysRemaining }
    }
  }
  return { term: candidates[candidates.length - 1], daysRemaining: 1 }
}

/**
 * 获取春夏秋冬四季意境总览
 */
export function getFourSeasonsMeta(): FourSeasonInfo[] {
  return FOUR_SEASONS_META
}

/**
 * 获取指定日期所属季节的四时元数据
 */
export function getCurrentSeasonMeta(date: Date = new Date()): FourSeasonInfo {
  const { season } = getApproxSolarTerm(date)
  return FOUR_SEASONS_META.find((s) => s.season === season) || FOUR_SEASONS_META[0]
}

const MONTH_POETIC_ALIASES = [
  '端月', '杏月', '桃月', '槐月', '榴月', '荷月',
  '巧月', '桂月', '菊月', '阳月', '冬月', '腊月',
]

/**
 * 获取当前或指定时刻的中国传统十二时辰信息
 */
export function getChineseShichen(date: Date = new Date()): ChineseShichen {
  const hour = date.getHours()
  // 23:00-00:59 -> 子时 (index 0)
  const index = Math.floor(((hour + 1) % 24) / 2)
  return SHICHEN_TABLE[index] || SHICHEN_TABLE[0]
}

/**
 * 计算公历日期所处的二十四节气（按精确交节日期判定）
 */
export function getApproxSolarTerm(date: Date = new Date()): SolarTermInfo {
  const year = date.getFullYear()
  const dayStart = new Date(year, date.getMonth(), date.getDate())
  const terms = getAllSolarTerms(year)

  let matched: SolarTermInfo = SOLAR_TERM_ANCHORS[SOLAR_TERM_ANCHORS.length - 1]
  for (const term of terms) {
    if (dayStart.getTime() >= term.date.getTime()) {
      matched = term
    } else {
      break
    }
  }
  return {
    name: matched.name,
    season: matched.season,
    sealChar: matched.sealChar,
    verse: matched.verse,
  }
}

/**
 * 获取传统十二月雅称（一月端月 ~ 十二月腊月）
 */
export function getChineseMonthAlias(monthIndexZeroBased: number): string {
  const idx = ((monthIndexZeroBased % 12) + 12) % 12
  return MONTH_POETIC_ALIASES[idx]
}

/**
 * 根据晨昏时令推荐与之契合的中国山水主题 ID
 */
export function getRecommendedShanshuiThemeForTime(date: Date = new Date()): string {
  const hour = date.getHours()
  if (hour >= 5 && hour <= 6) {
    return 'shanshui-xihu' // 破晓薄雾西湖
  }
  if (hour >= 7 && hour <= 11) {
    return 'shanshui-jiangnan' // 晨光徽宣清雅浅色
  }
  if (hour >= 12 && hour <= 17) {
    return 'shanshui-jiangshan' // 日中千里江山浅色宣纸
  }
  if (hour >= 18 && hour <= 20) {
    return 'shanshui-taishan' // 黄昏泰山金晖暮岚
  }
  if (hour >= 21 && hour <= 22) {
    return 'shanshui-lushan' // 晚境匡庐飞瀑苍崖
  }
  return 'shanshui-huangshan' // 深夜黄山松壑幽墨
}

const SHANSHUI_PROVERBS: ShanshuiProverb[] = [
  { text: '行到水穷处，坐看云起时', source: '王维' },
  { text: '山川脱胎于予，予脱胎于山川', source: '石涛 · 苦瓜和尚画语录' },
  { text: '不下堂筵，坐穷泉壑', source: '郭熙 · 林泉高致' },
  { text: '江山风月，本无常主，闲者便是主人', source: '苏轼' },
  { text: '松风水月，未足比其清华；仙露明珠，讵能方其朗润', source: '山川清韵' },
  { text: '心静即声淡，其间无古今', source: '白居易' },
  { text: '山中何所有，岭上多白云', source: '陶弘景' },
  { text: '江流天地外，山色有无中', source: '王维' },
  { text: '春水碧于天，画船听雨眠', source: '韦庄' },
  { text: '孤帆远影碧空尽，唯见长江天际流', source: '李白' },
  { text: '气蒸云梦泽，波撼岳阳城', source: '孟浩然' },
  { text: '孤舟蓑笠翁，独钓寒江雪', source: '柳宗元' },
  { text: '竹喧归浣女，莲动下渔舟', source: '王维' },
  { text: '采菊东篱下，悠然见南山', source: '陶渊明' },
  { text: '山光悦鸟性，潭影空人心', source: '常建' },
  { text: '落霞与孤鹜齐飞，秋水共长天一色', source: '王勃' },
]

const SEASONAL_ATMOSPHERE_MAP: Record<SeasonalAtmosphere['season'], SeasonalAtmosphere> = {
  '春': { season: '春', particleType: 'petal', auraLabel: '春山微雨 · 落英轻扬', teaSuggestion: '宜烹明前龙井或白毫银针' },
  '夏': { season: '夏', particleType: 'firefly', auraLabel: '夏木阴浓 · 碧涧萤流', teaSuggestion: '宜饮竹叶青或冷泡碧螺春' },
  '秋': { season: '秋', particleType: 'maple', auraLabel: '秋山霜染 · 枫叶丹林', teaSuggestion: '宜品武夷岩茶或金骏眉' },
  '冬': { season: '冬', particleType: 'snow', auraLabel: '冬岭素宣 · 微雪浮尘', teaSuggestion: '宜煮陈年普洱或老白茶' },
}

const THEME_ATMOSPHERE_MAP: Record<string, ShanshuiThemeAtmosphere> = {
  'shanshui-jiangshan': { mood: '青绿千里写丹青', motif: 'geese', inkTone: '石青石绿配熟宣' },
  'shanshui-huangshan': { mood: '云海青松立翠微', motif: 'alpine', inkTone: '徽墨松烟润云白' },
  'shanshui-potala': { mood: '雪域晴岚金顶光', motif: 'alpine', inkTone: '松墨矿绿点泥金' },
  'shanshui-guilin': { mood: '青罗玉篸烟雨中', motif: 'karst', inkTone: '赭石螺青沉香底' },
  'shanshui-sanxia': { mood: '千里江陵猿声静', motif: 'waterfall', inkTone: '花青靛蓝配银涛' },
  'shanshui-taishan': { mood: '凌绝顶而观沧海', motif: 'sunhalo', inkTone: '紫矿雄黄朝霞金' },
  'shanshui-xihu': { mood: '水光潋滟晴方好', motif: 'geese', inkTone: '藤黄柳青蟹壳绿' },
  'shanshui-lushan': { mood: '银汉飞流落九天', motif: 'waterfall', inkTone: '苍崖石青蕨苔翠' },
  'shanshui-jiangnan': { mood: '粉墙黛瓦听雨眠', motif: 'moonwindow', inkTone: '徽宣黛青佐梅褐' },
  'shanshui-emei': { mood: '佛光金顶云外天', motif: 'alpine', inkTone: '金碧玄青冷翠岚' },
  'shanshui-dunhuang': { mood: '鸣沙月泉落日圆', motif: 'sunhalo', inkTone: '鸣沙暖宣赭丹砂' },
  'shanshui-jiuzhaigou': { mood: '五花海色镜琉璃', motif: 'cascade-pools', inkTone: '孔雀石碧钙华金' },
  'shanshui-suzhou': { mood: '竹影移窗月洞幽', motif: 'moonwindow', inkTone: '姑苏素宣墨竹青' },
  'shanshui-zhangjiajie': { mood: '三千奇峰入云涛', motif: 'karst', inkTone: '武陵丹崖砂岩赭' },
  'shanshui-changbai': { mood: '天池雪霁照苍穹', motif: 'caldera', inkTone: '长白霁雪玄石蓝' },
  'shanshui-tianqing': { mood: '雨过天青云破处', motif: 'rain-ripples', inkTone: '天青瓷釉润淡宣' },
  'shanshui-qixia': { mood: '霜叶流丹染栖霞', motif: 'sunhalo', inkTone: '枫丹琥珀佐素宣' },
  'shanshui-erhai': { mood: '风花雪月映苍洱', motif: 'caldera', inkTone: '苍山靛墨点洱波' },
  'shanshui-qingcheng': { mood: '青城天下幽篁静', motif: 'bamboo-mist', inkTone: '玉清竹墨点杏金' },
}

/**
 * 获取与当前日期对应的中国山水意境雅言
 */
export function getDailyShanshuiProverb(date: Date = new Date()): ShanshuiProverb {
  const startOfYear = new Date(date.getFullYear(), 0, 1)
  const dayOfYear = Math.max(0, Math.floor((date.getTime() - startOfYear.getTime()) / 86_400_000))
  return SHANSHUI_PROVERBS[dayOfYear % SHANSHUI_PROVERBS.length]
}

/**
 * 组合当前节气、时辰与山水雅意提示语
 */
export function getShanshuiGreeting(date: Date = new Date()): string {
  const solar = getApproxSolarTerm(date)
  const shichen = getChineseShichen(date)
  return `${solar.name} · ${shichen.branch}时${shichen.alias} · ${shichen.poeticHint}`
}

/**
 * 获取四季物候与画布粒子氛围
 */
export function getSeasonalAtmosphere(date: Date = new Date()): SeasonalAtmosphere {
  const { season } = getApproxSolarTerm(date)
  return SEASONAL_ATMOSPHERE_MAP[season]
}

/**
 * 获取指定山水主题的意境构图特征
 */
export function getShanshuiThemeAtmosphere(themeId: string): ShanshuiThemeAtmosphere {
  return THEME_ATMOSPHERE_MAP[themeId] || THEME_ATMOSPHERE_MAP['shanshui-jiangshan']
}

/**
 * 结合四时节气与晨昏昼夜推荐中国山水主题（覆盖全部 19 境山水美学）
 */
export function getSeasonalShanshuiRecommendation(date: Date = new Date()): string {
  const { season, name } = getApproxSolarTerm(date)
  const hour = date.getHours()
  const isDaylight = hour >= 7 && hour <= 17
  if (season === '春') {
    if (isDaylight) {
      return name === '雨水' || name === '清明' || name === '谷雨'
        ? 'shanshui-tianqing'
        : 'shanshui-suzhou'
    }
    return hour >= 5 && hour <= 6 ? 'shanshui-xihu' : 'shanshui-erhai'
  }
  if (season === '夏') {
    if (isDaylight) return 'shanshui-jiangshan'
    return hour >= 21 || hour <= 4 ? 'shanshui-lushan' : 'shanshui-qingcheng'
  }
  if (season === '秋') {
    if (isDaylight) {
      return name === '霜降' || name === '寒露' ? 'shanshui-qixia' : 'shanshui-dunhuang'
    }
    return hour >= 18 && hour <= 20 ? 'shanshui-taishan' : 'shanshui-zhangjiajie'
  }
  // 冬
  if (isDaylight) return 'shanshui-changbai'
  return hour >= 18 && hour <= 20 ? 'shanshui-emei' : 'shanshui-potala'
}
