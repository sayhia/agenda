/**
 * Agenda NLP Parser - Client-side Natural Language Parser for Reminders
 * Supports Chinese and English expressions, relative dates, time intervals,
 * recurrences (RRULE), advance notifications, and durations.
 */

export interface ParsedReminder {
  title: string;
  scheduledAt: string; // ISO 8601
  repeatRule: string;  // RRULE or empty
  leadMinutes: number;
  leadSpecified: boolean;
  durationMinutes: number;
  notes: string;
  prompt: string;
  hasTime: boolean;
  rawInput: string;
  priority?: string;
  tags?: string;
}

export function formatPanguText(text: string): string {
  if (!text) return '';
  return text
    .replace(/([\u4e00-\u9fa5])([a-zA-Z0-9])/g, '$1 $2')
    .replace(/([a-zA-Z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNaturalReminder(text: string, now: Date = new Date()): ParsedReminder {
  const original = text.trim();
  // Strip chat emoji tags like [撇嘴], [OK], [握手], [强]
  let input = original.replace(/\[(?:[a-zA-Z\u4e00-\u9fa50-9_]{1,10})\]/g, ' ');

  let leadMinutes = 0;
  let leadSpecified = false;
  let durationMinutes = 30;
  let repeatRule = '';
  let notes = '';

  // 1. Extract Lead Time (提前提醒)
  const leadMatch = input.match(/提前\s*(\d+)\s*(分钟|小时|分|h|min|m)/i);
  if (leadMatch) {
    leadSpecified = true;
    const val = parseInt(leadMatch[1], 10);
    const unit = leadMatch[2].toLowerCase();
    if (unit.startsWith('h') || unit.includes('小时')) {
      leadMinutes = val * 60;
    } else {
      leadMinutes = val;
    }
    input = input.replace(leadMatch[0], ' ');
  } else if (/提前半小时/i.test(input)) {
    leadSpecified = true;
    leadMinutes = 30;
    input = input.replace(/提前半小时/i, ' ');
  } else if (/提前一天/i.test(input)) {
    leadSpecified = true;
    leadMinutes = 24 * 60;
    input = input.replace(/提前一天/i, ' ');
  } else if (/(?:准时提醒|准时)/i.test(input)) {
    leadSpecified = true;
    leadMinutes = 0;
    input = input.replace(/(?:准时提醒|准时)/i, ' ');
  }

  // 2. Extract Duration (持续时长)
  const durMatch = input.match(/(?:持续|时长|为期)\s*(\d+)\s*(分钟|小时|分|h|min|m)/i);
  if (durMatch) {
    const val = parseInt(durMatch[1], 10);
    const unit = durMatch[2].toLowerCase();
    if (unit.startsWith('h') || unit.includes('小时')) {
      durationMinutes = val * 60;
    } else {
      durationMinutes = val;
    }
    input = input.replace(durMatch[0], ' ');
  } else if (/持续半小时/i.test(input)) {
    durationMinutes = 30;
    input = input.replace(/持续半小时/i, ' ');
  }

  // 3. Extract Recurrence (重复模式)
  if (/工作日/i.test(input) || /每工作日/i.test(input)) {
    repeatRule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    input = input.replace(/(?:每|每个)?工作日/i, ' ');
  } else if (!/(?:本周末|这周末|下周末)/i.test(input) && (/周末/i.test(input) || /每周六[、和与]?日/i.test(input))) {
    repeatRule = 'FREQ=WEEKLY;BYDAY=SA,SU';
    input = input.replace(/(?:每|每个)?周末|每周六[、和与]?日/i, ' ');
  } else if (/每天|每日|天天/i.test(input)) {
    repeatRule = 'FREQ=DAILY';
    input = input.replace(/每天|每日|天天/i, ' ');
  } else if (/每隔一天/i.test(input)) {
    repeatRule = 'FREQ=DAILY;INTERVAL=2';
    input = input.replace(/每隔一天/i, ' ');
  } else if (/每周([一二三四五六日天1234567])/i.test(input)) {
    const m = input.match(/每周([一二三四五六日天1234567])/i);
    if (m) {
      const code = weekdayToCode(m[1]);
      repeatRule = `FREQ=WEEKLY;BYDAY=${code}`;
      input = input.replace(m[0], ' ');
    }
  } else if (/每月(\d+)号|每月(\d+)日/i.test(input)) {
    const m = input.match(/每月(\d+)[号日]/i);
    if (m) {
      repeatRule = `FREQ=MONTHLY;BYMONTHDAY=${m[1]}`;
      input = input.replace(m[0], ' ');
    }
  } else if (/每年/i.test(input)) {
    repeatRule = 'FREQ=YEARLY';
    input = input.replace(/每年/i, ' ');
  }

  // 4. Extract Explicit Notes (备注)
  const noteMatch = input.match(/(?:备注|附注|说明|注)[：:]\s*(.+)$/i);
  if (noteMatch) {
    notes = noteMatch[1].trim();
    input = input.replace(noteMatch[0], ' ');
  }

  // 4.1 Extract Priority (优先级: P0/P1/P2/P3 / 特急 / 最高优 / 加急 / 重要紧急 / 低优 / 延后)
  let priority = 'p2';
  if (/(?:(?:优先级|级别)[:：]?\s*)?[pP]0\b|特急|非常紧急|最高优先级|重要紧急/i.test(input)) {
    priority = 'p0';
    input = input.replace(/(?:(?:优先级|级别)[:：]?\s*)?[pP]0\b|特急|非常紧急|最高优先级|重要紧急/gi, ' ');
  } else if (/(?:(?:优先级|级别)[:：]?\s*)?[pP]1\b|高优|加急|重要不紧急|优先/i.test(input)) {
    priority = 'p1';
    input = input.replace(/(?:(?:优先级|级别)[:：]?\s*)?[pP]1\b|高优|加急|重要不紧急|优先/gi, ' ');
  } else if (/(?:(?:优先级|级别)[:：]?\s*)?[pP]3\b|低优|不急|顺延|延后/i.test(input)) {
    priority = 'p3';
    input = input.replace(/(?:(?:优先级|级别)[:：]?\s*)?[pP]3\b|低优|不急|顺延|延后/gi, ' ');
  }

  // 4.2 Extract Hash Tags (#标签)
  const tagList: string[] = [];
  const tagMatches = input.match(/#([a-zA-Z0-9_\u4e00-\u9fa5]+)/g);
  if (tagMatches) {
    for (const m of tagMatches) {
      tagList.push(m.replace(/^#/, '').trim());
      input = input.replace(m, ' ');
    }
  }
  const tags = tagList.join(',');

  // 5. Parse Date and Time
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth();
  let targetDate = now.getDate();
  let targetHour = 9;
  let targetMinute = 0;
  let hasTime = false;
  let hasExplicitDate = false;

  // 4.3 Explicit Calendar Dates (e.g. 2026-11-20 / 11月25号 / 下个月15日)
  const fullDateMatch = input.match(/(?:(\d{4})[年\-\/\.])?\s*(\d{1,2})[月\-\/\.]\s*(\d{1,2})[号日]?/);
  if (fullDateMatch && !/每/.test(input.slice(Math.max(0, (fullDateMatch.index || 0) - 2), fullDateMatch.index || 0))) {
    let y = fullDateMatch[1] ? parseInt(fullDateMatch[1], 10) : now.getFullYear();
    const m = parseInt(fullDateMatch[2], 10) - 1; // 0-indexed
    const d = parseInt(fullDateMatch[3], 10);
    // If no year specified and date is already past by more than 1 month, assume next year
    if (!fullDateMatch[1] && (m < now.getMonth() || (m === now.getMonth() && d < now.getDate()))) {
      y += 1;
    }
    targetYear = y;
    targetMonth = m;
    targetDate = d;
    hasExplicitDate = true;
    input = input.replace(fullDateMatch[0], ' ');
  } else {
    const nextMonthMatch = input.match(/(?:下个?月|下月)\s*(\d{1,2})[号日]/);
    if (nextMonthMatch) {
      const d = parseInt(nextMonthMatch[1], 10);
      const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, d);
      targetYear = nextDate.getFullYear();
      targetMonth = nextDate.getMonth();
      targetDate = nextDate.getDate();
      hasExplicitDate = true;
      input = input.replace(nextMonthMatch[0], ' ');
    }
  }

  // Relative Date & Multi-day Ranges: 明后两天 / 今明两天 / 明天 / 后天
  if (/(?:明后两天|明后两日|明后天)/i.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    repeatRule = 'FREQ=DAILY;COUNT=2';
    input = input.replace(/(?:明后两天|明后两日|明后天)/i, ' ');
  } else if (/(?:今明两天|今明两日|今明天)/i.test(input)) {
    hasExplicitDate = true;
    repeatRule = 'FREQ=DAILY;COUNT=2';
    input = input.replace(/(?:今明两天|今明两日|今明天)/i, ' ');
  } else if (/(?:今明后三天|今明后3天)/i.test(input)) {
    hasExplicitDate = true;
    repeatRule = 'FREQ=DAILY;COUNT=3';
    input = input.replace(/(?:今明后三天|今明后3天)/i, ' ');
  } else if (/(?:明后三天|明后3天)/i.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    repeatRule = 'FREQ=DAILY;COUNT=3';
    input = input.replace(/(?:明后三天|明后3天)/i, ' ');
  } else if (/大后天/i.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 3);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    input = input.replace(/大后天/i, ' ');
  } else if (/后天/i.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    input = input.replace(/后天/i, ' ');
  } else if (/明天|明晚/i.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    if (/明晚/i.test(input)) {
      targetHour = 20;
      targetMinute = 0;
      hasTime = true;
    }
    input = input.replace(/明天|明晚/i, ' ');
  } else if (/今天|今日|今晚/i.test(input)) {
    hasExplicitDate = true;
    if (/今晚/i.test(input)) {
      targetHour = 20;
      targetMinute = 0;
      hasTime = true;
    }
    input = input.replace(/今天|今日|今晚/i, ' ');
  }

  // Consecutive Days phrase (e.g. 连续3天 / 接下来5天)
  const consecutiveMatch = input.match(/(?:连续|一连|接下来的?|未来的?)\s*(\d+|[一二两三四五六七八九十]+)\s*天/);
  if (consecutiveMatch) {
    const num = parseChineseOrArabicNum(consecutiveMatch[1]);
    if (num > 1) {
      repeatRule = `FREQ=DAILY;COUNT=${num}`;
    }
    input = input.replace(consecutiveMatch[0], ' ');
  }

  // Relative Weekday: 下下周三 / 下周三 / 周五 / 星期日 / 下个礼拜一 / 这周五
  const weekMatch = input.match(/(?:(下下个?|下下|下个?|这个?|本个?|下|这|本)\s*)?(?:周|星期|礼拜)([一二三四五六日天1-7])/i);
  if (weekMatch) {
    const prefix = weekMatch[1] || '';
    const dayCode = weekdayToNum(weekMatch[2]);
    const currentDay = now.getDay();
    let diff = dayCode - currentDay;
    if (prefix.startsWith('下下')) {
      diff = (diff <= 0 ? diff + 7 : diff) + 7;
    } else if (diff <= 0 || prefix.startsWith('下')) {
      diff += 7;
    }
    const d = new Date(now);
    d.setDate(d.getDate() + diff);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    input = input.replace(weekMatch[0], ' ');
  }

  // Weekends: 本周末 / 这周末 / 下周末
  if (/(?:本周末|这周末)/i.test(input)) {
    const d = new Date(now);
    const day = d.getDay();
    const diff = (6 - day + 7) % 7 || 7; // coming Saturday
    d.setDate(d.getDate() + diff);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    input = input.replace(/(?:本周末|这周末)/i, ' ');
  } else if (/下周末/i.test(input)) {
    const d = new Date(now);
    const day = d.getDay();
    const diff = ((6 - day + 7) % 7 || 7) + 7; // next week's Saturday
    d.setDate(d.getDate() + diff);
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    hasExplicitDate = true;
    input = input.replace(/下周末/i, ' ');
  }

  // Month Period: 月初 / 月中 / 月底
  if (/本?月底/i.test(input)) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    targetDate = lastDay;
    hasExplicitDate = true;
    input = input.replace(/本?月底/i, ' ');
  } else if (/本?月中/i.test(input)) {
    targetDate = 15;
    hasExplicitDate = true;
    input = input.replace(/本?月中/i, ' ');
  } else if (/本?月初/i.test(input)) {
    targetDate = 1;
    hasExplicitDate = true;
    input = input.replace(/本?月初/i, ' ');
  }

  // Relative Minutes/Hours: 10分钟后 / 2小时后 / 17分钟后 / 一刻钟后 / 半小时后 / 半天后 / 即时提醒
  if (/(?:即时提醒|立刻提醒|马上提醒|稍后提醒|尽快提醒|立刻|马上|尽快|即刻)/i.test(input) && !/(?:明天|后天|下周)/i.test(input)) {
    const d = new Date(now.getTime() + 15 * 60 * 1000);
    targetYear = d.getFullYear(); targetMonth = d.getMonth(); targetDate = d.getDate();
    targetHour = d.getHours(); targetMinute = d.getMinutes();
    hasTime = true; hasExplicitDate = true;
    input = input.replace(/(?:即时提醒|立刻提醒|马上提醒|稍后提醒|尽快提醒|立刻|马上|尽快|即刻)/i, ' ');
  } else if (/一刻钟后/i.test(input)) {
    const d = new Date(now.getTime() + 15 * 60 * 1000);
    targetYear = d.getFullYear(); targetMonth = d.getMonth(); targetDate = d.getDate();
    targetHour = d.getHours(); targetMinute = d.getMinutes();
    hasTime = true; hasExplicitDate = true;
    input = input.replace(/一刻钟后/i, ' ');
  } else if (/半小时后/i.test(input)) {
    const d = new Date(now.getTime() + 30 * 60 * 1000);
    targetYear = d.getFullYear(); targetMonth = d.getMonth(); targetDate = d.getDate();
    targetHour = d.getHours(); targetMinute = d.getMinutes();
    hasTime = true; hasExplicitDate = true;
    input = input.replace(/半小时后/i, ' ');
  } else if (/(?:半天|大半天)后/i.test(input)) {
    const d = new Date(now.getTime() + 4 * 3600 * 1000);
    targetYear = d.getFullYear(); targetMonth = d.getMonth(); targetDate = d.getDate();
    targetHour = d.getHours(); targetMinute = d.getMinutes();
    hasTime = true; hasExplicitDate = true;
    input = input.replace(/(?:半天|大半天)后/i, ' ');
  } else if (/\bin\s+(\d+)\s*(mins?|minutes?|hours?|hrs?|h)\b/i.test(input)) {
    const enRelMatch = input.match(/\bin\s+(\d+)\s*(mins?|minutes?|hours?|hrs?|h)\b/i);
    if (enRelMatch) {
      const val = parseInt(enRelMatch[1], 10);
      const unit = enRelMatch[2].toLowerCase();
      const d = new Date(now);
      if (unit.startsWith('h')) {
        d.setHours(d.getHours() + val);
      } else {
        d.setMinutes(d.getMinutes() + val);
      }
      targetYear = d.getFullYear(); targetMonth = d.getMonth(); targetDate = d.getDate();
      targetHour = d.getHours(); targetMinute = d.getMinutes();
      hasTime = true; hasExplicitDate = true;
      input = input.replace(enRelMatch[0], ' ');
    }
  }

  const relTimeMatch = input.match(/(?:就在\s*)?(\d+)\s*(分钟|小时|分|h|min)后/i);
  if (relTimeMatch) {
    const val = parseInt(relTimeMatch[1], 10);
    const unit = relTimeMatch[2];
    const d = new Date(now);
    if (unit.includes('小时') || unit.toLowerCase().startsWith('h')) {
      d.setHours(d.getHours() + val);
    } else {
      d.setMinutes(d.getMinutes() + val);
    }
    targetYear = d.getFullYear();
    targetMonth = d.getMonth();
    targetDate = d.getDate();
    targetHour = d.getHours();
    targetMinute = d.getMinutes();
    hasTime = true;
    hasExplicitDate = true;
    input = input.replace(relTimeMatch[0], ' ');
  }

  // Clock & Time Range Parser (only if not already resolved by relative countdown)
  if (!hasTime) {
    // Check Natural Range Expression: "9点到11点" / "下午2点至4点半" / "14:00-16:30"
    const rangeRegex = /(?:(早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里)\s*)?(\d{1,2})(?:[:：](\d{1,2})|点(?:半|一刻|三刻|(\d{1,2})分?)?)?\s*(?:到|至|~|-|——)\s*(?:(早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里)\s*)?(\d{1,2})(?:[:：](\d{1,2})|点(?:半|一刻|三刻|(\d{1,2})分?)?)?/;
    const rangeMatch = input.match(rangeRegex);
    if (rangeMatch) {
      const extractSegment = (period: string | undefined, hourStr: string, colonMin: string | undefined, clockMin: string | undefined, raw: string) => {
        let h = parseInt(hourStr, 10);
        let min = 0;
        if (colonMin) min = parseInt(colonMin, 10);
        else if (clockMin) min = parseInt(clockMin, 10);
        else if (raw.includes('半')) min = 30;
        else if (raw.includes('一刻')) min = 15;
        else if (raw.includes('三刻')) min = 45;

        if (period && /下午|晚上|傍晚|夜里/.test(period) && h < 12) h += 12;
        else if (period && /半夜|午夜|凌晨/.test(period) && h === 12) h = 0;
        return { h, min };
      };

      const startPart = rangeMatch[0].split(/[到至~—\-]/)[0];
      const endPart = rangeMatch[0].slice(startPart.length + 1);

      const start = extractSegment(rangeMatch[1], rangeMatch[2], rangeMatch[3], rangeMatch[4], startPart);
      const end = extractSegment(rangeMatch[5] || rangeMatch[1], rangeMatch[6], rangeMatch[7], rangeMatch[8], endPart);

      let startTotal = start.h * 60 + start.min;
      let endTotal = end.h * 60 + end.min;

      if (endTotal <= startTotal && end.h < 12) {
        end.h += 12;
        endTotal = end.h * 60 + end.min;
      }

      durationMinutes = Math.max(15, endTotal - startTotal);
      targetHour = start.h;
      targetMinute = start.min;
      hasTime = true;
      input = input.replace(rangeMatch[0], ' ');
    }
  }

  // Clock Parser (only if not already resolved by relative countdown or range)
  if (!hasTime) {
    // Check "差 N 分 M 点" or "差一刻 M 点"
    const diffMatch = input.match(/(?:(早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里)\s*)?差\s*(\d{1,2}|一刻|十分|五分|半)\s*分?(?:到|进)?\s*(\d{1,2})点/i);
    if (diffMatch) {
      const p = diffMatch[1] || '';
      let diffMins = 0;
      const diffStr = diffMatch[2];
      if (diffStr === '一刻') diffMins = 15;
      else if (diffStr === '半') diffMins = 30;
      else if (diffStr === '十分') diffMins = 10;
      else if (diffStr === '五分') diffMins = 5;
      else diffMins = parseInt(diffStr, 10);

      let h = parseInt(diffMatch[3], 10);
      if (/下午|晚上|傍晚|夜里/.test(p) && h < 12) {
        h += 12;
      }
      let totalMins = h * 60 - diffMins;
      if (totalMins < 0) totalMins += 24 * 60;
      targetHour = Math.floor(totalMins / 60);
      targetMinute = totalMins % 60;
      hasTime = true;
      input = input.replace(diffMatch[0], ' ');
    }
  }

  if (!hasTime) {
    // Check 14:50 / 8:30 / 上午8:30 / 下午3:15
    const colonMatch = input.match(/(?:(早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)\s*)?(\d{1,2})[:：](\d{1,2})/);
    if (colonMatch) {
      const p = colonMatch[1] || '';
      let h = parseInt(colonMatch[2], 10);
      const m = parseInt(colonMatch[3], 10);
      if (/下午|晚上|傍晚|夜里/.test(p) && h < 12) {
        h += 12;
      } else if (/半夜|午夜|凌晨/.test(p) && h === 12) {
        h = 0;
      }
      targetHour = h;
      targetMinute = m;
      hasTime = true;
      input = input.replace(colonMatch[0], ' ');
    } else {
      // Check X点半 / X点一刻 / X点Y分 / 下午3点
      const clockMatch = input.match(/(?:(早上|早晨|清晨|上午|中午|下午|傍晚|晚上|夜里|半夜|凌晨)\s*)?(\d{1,2})点(?:半|(?:过|零)?(\d{1,2})分?|一刻|三刻)?/);
      if (clockMatch) {
        const p = clockMatch[1] || '';
        let h = parseInt(clockMatch[2], 10);
        if (/下午|晚上|傍晚|夜里/.test(p) && h < 12) {
          h += 12;
        } else if (/半夜|午夜|凌晨/.test(p) && h === 12) {
          h = 0;
        }
        targetHour = h;
        if (clockMatch[0].includes('半')) {
          targetMinute = 30;
        } else if (clockMatch[0].includes('一刻')) {
          targetMinute = 15;
        } else if (clockMatch[0].includes('三刻')) {
          targetMinute = 45;
        } else if (clockMatch[3]) {
          targetMinute = parseInt(clockMatch[3], 10);
        } else {
          targetMinute = 0;
        }
        hasTime = true;
        input = input.replace(clockMatch[0], ' ');
      }
    }

    // Standalone Period Parser (when period like 下午 / 上午 / 晚上 / 中午 is specified without clock digits)
    if (!hasTime) {
      const periodStandaloneMatch = input.match(/(大清早|清晨|早晨|早上|上午|中午|正午|午后|下午|傍晚|黄昏|晚上|夜里|夜间|深夜|午夜|半夜|凌晨)/);
      if (periodStandaloneMatch) {
        const p = periodStandaloneMatch[1];
        switch (p) {
          case '大清早': case '清晨':
            targetHour = 6; targetMinute = 30; break;
          case '早晨': case '早上':
            targetHour = 8; targetMinute = 0; break;
          case '上午':
            targetHour = 9; targetMinute = 0; break;
          case '中午': case '正午':
            targetHour = 12; targetMinute = 0; break;
          case '午后': case '下午':
            targetHour = 14; targetMinute = 0; break;
          case '傍晚': case '黄昏':
            targetHour = 18; targetMinute = 0; break;
          case '晚上': case '夜里': case '夜间':
            targetHour = 20; targetMinute = 0; break;
          case '深夜':
            targetHour = 23; targetMinute = 0; break;
          case '午夜': case '半夜': case '凌晨':
            targetHour = 0; targetMinute = 0; break;
        }
        hasTime = true;
        input = input.replace(periodStandaloneMatch[0], ' ');
      }
    }
  }

  // 6. Clean Title
  let title = input
    .replace(/(?:提醒我|设个提醒|定个闹钟|闹钟|帮我|麻烦|安排一下|请|设一个|加一个|添加|创建|辛苦|顺便|另外)/g, ' ')
    .replace(/(?:准时|记得|务必|去|做)/g, ' ')
    .replace(/(?:已设为|设为)?(?:今天|今日)?的?(?:即时提醒|立刻提醒|稍后提醒|提醒)/g, ' ')
    .replace(/[（(]?\s*就在(?:[，,\s]*先止损)?\s*[）)]?/g, ' ')
    .replace(/[（(]\s*，?\s*先止损\s*[）)]/g, ' ')
    .replace(/[（(]\s*[）)]/g, ' ')
    .replace(/^\s*\d{1,2}:\d{2}\s*的?\s*/g, '')
    .replace(/如果希望改成[^\n~～]*?[~～]/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[⏰🔔👍🚨🔎☕️✨⚡️]/gu, ' ')
    .replace(/^[：:\-—\s]+|[：:\-—\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If input is a complex chat dump, inspect if there is an explicit reminder/task item marker
  const markerRegex = /(?:提醒事项|处理事项|待办事项|事项)[：:\s\n]+([^\n，,。；;：:]+)/g;
  let mItem: RegExpExecArray | null;
  let foundCandidate = '';
  while ((mItem = markerRegex.exec(original)) !== null) {
    let candidate = mItem[1]
      .replace(/[⏰🔔👍🚨🔎☕️✨⚡️]/gu, '')
      .replace(/^[：:\-—\s]+|[：:\-—\s]+$/g, '')
      .trim();
    if (candidate.length >= 2 && candidate.length <= 40 && !candidate.startsWith('域名')) {
      foundCandidate = candidate;
    }
  }
  if (foundCandidate) {
    title = foundCandidate;
  }

  title = formatPanguText(title);

  // If title is excessively long (e.g. pasted multi-line chats), sanitize and cap
  if (title.length > 50) {
    const firstSentence = title.split(/[，,。；;\n]/)[0].trim();
    if (firstSentence.length >= 4 && firstSentence.length <= 40) {
      title = firstSentence;
    } else {
      title = title.slice(0, 45) + '...';
    }
  }

  if (!title) {
    title = '新日程';
  }

  const scheduledDate = new Date(targetYear, targetMonth, targetDate, targetHour, targetMinute, 0);

  // Defense against past time & instant expiration:
  if (scheduledDate.getTime() <= now.getTime()) {
    if (!hasExplicitDate) {
      // e.g. "9点开会" typed at 14:00 -> assume tomorrow 9:00
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    } else {
      // User explicitly typed "今天" or a relative date that landed in the past:
      if (!hasTime) {
        // e.g. user typed "今天开会" in the afternoon without specifying hour:
        // Schedule for upcoming slot (30 min later rounded to next 10 min, e.g. 16:30 / 17:00), or tomorrow 09:00 if late night
        const candidate = new Date(now.getTime() + 30 * 60 * 1000);
        if (candidate.getHours() >= 22) {
          scheduledDate.setDate(scheduledDate.getDate() + 1);
          scheduledDate.setHours(9, 0, 0, 0);
        } else {
          const remMin = candidate.getMinutes() % 10;
          if (remMin > 0) {
            candidate.setMinutes(candidate.getMinutes() + (10 - remMin));
          }
          scheduledDate.setTime(candidate.getTime());
        }
      } else {
        // User explicitly specified a past hour today (e.g. "12:00" when it is 15:00):
        // Defensive bump to now + 15 minutes to guarantee it never enters the database expired!
        scheduledDate.setTime(now.getTime() + 15 * 60 * 1000);
      }
    }
  }

  const prompt = `提醒您：${title}${notes ? ' (' + notes + ')' : ''}`;

  return {
    title,
    scheduledAt: scheduledDate.toISOString(),
    repeatRule,
    leadMinutes,
    leadSpecified,
    durationMinutes,
    notes,
    prompt,
    hasTime,
    rawInput: original,
    priority,
    tags,
  };
}

function weekdayToCode(ch: string): string {
  switch (ch) {
    case '一': case '1': return 'MO';
    case '二': case '2': return 'TU';
    case '三': case '3': return 'WE';
    case '四': case '4': return 'TH';
    case '五': case '5': return 'FR';
    case '六': case '6': return 'SA';
    case '日': case '天': case '7': default: return 'SU';
  }
}

function weekdayToNum(ch: string): number {
  switch (ch) {
    case '一': case '1': return 1;
    case '二': case '2': return 2;
    case '三': case '3': return 3;
    case '四': case '4': return 4;
    case '五': case '5': return 5;
    case '六': case '6': return 6;
    case '日': case '天': case '7': default: return 0;
  }
}

function parseChineseOrArabicNum(str: string): number {
  const map: Record<string, number> = {
    '一': 1, '1': 1,
    '二': 2, '两': 2, '2': 2,
    '三': 3, '3': 3,
    '四': 4, '4': 4,
    '五': 5, '5': 5,
    '六': 6, '6': 6,
    '七': 7, '7': 7,
    '八': 8, '8': 8,
    '九': 9, '9': 9,
    '十': 10, '10': 10,
  };
  return map[str.trim()] || parseInt(str, 10) || 1;
}
