/**
 * Date, time, and recurrence formatting utilities.
 */

import { escapeHTML } from './sanitize.ts';

export function formatTime(isoString: string): string {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '--:--';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatEndTime(iso: string, durationMinutes: number): string {
  if (!durationMinutes || durationMinutes <= 0) return '';
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return '';
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
}

export function formatDateLabel(isoString: string): { label: string; subLabel: string; isToday: boolean; isTomorrow: boolean } {
  if (!isoString) return { label: '', subLabel: '', isToday: false, isTomorrow: false };
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return { label: '', subLabel: '', isToday: false, isTomorrow: false };
  const now = new Date();

  const dYear = d.getFullYear();
  const dMonth = d.getMonth();
  const dDate = d.getDate();

  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const nowDate = now.getDate();

  const isToday = dYear === nowYear && dMonth === nowMonth && dDate === nowDate;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = dYear === tomorrow.getFullYear() && dMonth === tomorrow.getMonth() && dDate === tomorrow.getDate();

  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekDayStr = weekdays[d.getDay()];
  const monthDayStr = `${d.getMonth() + 1}月${d.getDate()}日`;

  if (isToday) {
    return { label: '今天', subLabel: `${monthDayStr} · ${weekDayStr}`, isToday: true, isTomorrow: false };
  }
  if (isTomorrow) {
    return { label: '明天', subLabel: `${monthDayStr} · ${weekDayStr}`, isToday: false, isTomorrow: true };
  }

  return { label: `${monthDayStr}`, subLabel: weekDayStr, isToday: false, isTomorrow: false };
}

export function formatRelativeTime(isoString: string): string {
  if (!isoString) return '';
  const target = new Date(isoString).getTime();
  if (Number.isNaN(target)) return '';
  const now = Date.now();
  const diffSec = Math.round((target - now) / 1000);

  if (diffSec < 0 && diffSec > -60) return '刚刚到期';
  if (diffSec <= -60) {
    const mins = Math.abs(Math.round(diffSec / 60));
    if (mins < 60) return `逾期 ${mins} 分钟`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `逾期 ${hours} 小时`;
    return `已逾期`;
  }

  if (diffSec < 60) return '即将到期';
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins} 分钟后`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时后`;
  const days = Math.round(hours / 24);
  return `${days} 天后`;
}

export function isNearDue(isoString: string, withinMinutes: number = 15): boolean {
  if (!isoString) return false;
  const target = new Date(isoString).getTime();
  if (Number.isNaN(target)) return false;
  const now = Date.now();
  const diff = target - now;
  return diff >= 0 && diff <= withinMinutes * 60 * 1000;
}

export function formatRepeatLabel(rrule: string): string {
  if (!rrule) return '';
  const r = rrule.toUpperCase();
  const countMatch = r.match(/COUNT=(\d+)/);
  const countSuffix = countMatch ? ` (共${countMatch[1]}次)` : '';
  const dayMap: Record<string, string> = {
    MO: '周一', TU: '周二', WE: '周三', TH: '周四', FR: '周五', SA: '周六', SU: '周日',
  };

  if (r.includes('BYDAY=MO,TU,WE,TH,FR')) return `每个工作日${countSuffix}`;
  if (r.includes('BYDAY=SA,SU')) return `每周六日${countSuffix}`;
  if (r.includes('FREQ=DAILY')) {
    if (r.includes('INTERVAL=2')) return `每隔一天${countSuffix}`;
    const ivMatch = r.match(/INTERVAL=(\d+)/);
    if (ivMatch && Number(ivMatch[1]) > 2) return `每 ${ivMatch[1]} 天${countSuffix}`;
    if (countMatch) return `连续 ${countMatch[1]} 天`;
    return '每天';
  }
  if (r.includes('FREQ=WEEKLY')) {
    const ivMatch = r.match(/INTERVAL=(\d+)/);
    const iv = ivMatch ? Number(ivMatch[1]) : 1;
    const prefix = iv === 2 ? '每两周' : iv > 2 ? `每 ${iv} 周` : '每周';
    const match = r.match(/BYDAY=([A-Z,]+)/);
    if (match) {
      const days = match[1].split(',').map(d => dayMap[d] || d).join('、');
      return `${prefix} ${days}${countSuffix}`;
    }
    return `${prefix}${countSuffix}`;
  }
  if (r.includes('FREQ=MONTHLY')) {
    if (r.includes('INTERVAL=3')) return `每季度${countSuffix}`;
    const lastWdMatch = r.match(/BYDAY=-1([A-Z]{2})/);
    if (lastWdMatch) {
      return `每月最后一个${dayMap[lastWdMatch[1]] || lastWdMatch[1]}${countSuffix}`;
    }
    const nthWdMatch = r.match(/BYDAY=(\d+)([A-Z]{2})/);
    if (nthWdMatch) {
      return `每月第${nthWdMatch[1]}个${dayMap[nthWdMatch[2]] || nthWdMatch[2]}${countSuffix}`;
    }
    if (r.includes('BYMONTHDAY=-1')) return `每月最后一天${countSuffix}`;
    const match = r.match(/BYMONTHDAY=(\d+)/);
    if (match) return `每月 ${match[1]} 号${countSuffix}`;
    return `每月${countSuffix}`;
  }
  if (r.includes('FREQ=YEARLY')) return `每年${countSuffix}`;
  return `周期循环${countSuffix}`;
}

export function formatDurationLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m === 0) return '0 分钟';
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} 小时 ${rem} 分` : `${h} 小时`;
}

/**
 * Extracts valid HTTP/HTTPS URLs from text for one-click pill opening.
 */
export function extractUrls(text: string): { url: string; label: string }[] {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex) || [];
  return matches.map((url) => {
    let clean = url.replace(/[),，。]$/, '');
    let label = clean.replace(/^https?:\/\//, '');
    if (label.length > 28) {
      label = label.slice(0, 25) + '...';
    }
    return { url: clean, label };
  });
}

/**
 * Escapes HTML and wraps search query matches in <mark class="search-highlight">.
 * Matches against raw text before escaping each segment so queries never corrupt HTML entities.
 */
export function highlightMatch(text: string, query?: string): string {
  const raw = text || '';
  const q = query?.trim() || '';
  if (!q) return escapeHTML(raw);

  const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedQuery, 'gi');
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match[0].length === 0) break;
    if (match.index > lastIndex) {
      out += escapeHTML(raw.slice(lastIndex, match.index));
    }
    out += `<mark class="search-highlight">${escapeHTML(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    out += escapeHTML(raw.slice(lastIndex));
  }
  return out;
}

/**
 * Extracts filesystem paths for Finder revealer
 */
export function extractLocalPaths(text: string): { path: string; label: string }[] {
  if (!text) return [];
  // Match absolute unix paths (/Users/..., /Applications/...) or file:// URIs
  const pathRegex = /(?:file:\/\/)?(\/(?:Users|Volumes|Applications|System|Library|private|tmp)[^\s"'>)]+)/g;
  const matches = [...text.matchAll(pathRegex)];
  const results: { path: string; label: string }[] = [];
  const seen = new Set<string>();

  for (const m of matches) {
    let clean = m[1].replace(/[),，。]$/, '');
    if (!seen.has(clean)) {
      seen.add(clean);
      const parts = clean.split('/').filter(Boolean);
      const filename = parts.length > 0 ? parts[parts.length - 1] : clean;
      results.push({
        path: clean,
        label: filename.length > 20 ? filename.slice(0, 18) + '...' : filename,
      });
    }
  }
  return results;
}

/**
 * Calculates dynamic countdown badge within 24h
 */
export function getCountdownBadge(isoString: string): { text: string; isUrgent: boolean; isPast: boolean; showBadge: boolean } {
  if (!isoString) return { text: '', isUrgent: false, isPast: false, showBadge: false };
  const target = new Date(isoString).getTime();
  if (Number.isNaN(target)) return { text: '', isUrgent: false, isPast: false, showBadge: false };
  const now = Date.now();
  const diffSec = Math.round((target - now) / 1000);

  // If more than 24 hours away or overdue by more than 12 hours, do not show dynamic badge
  if (diffSec > 24 * 3600 || diffSec < -12 * 3600) {
    return { text: '', isUrgent: false, isPast: false, showBadge: false };
  }

  if (diffSec < 0) {
    const mins = Math.abs(Math.round(diffSec / 60));
    if (mins < 60) {
      return { text: `逾期 ${mins}m`, isUrgent: true, isPast: true, showBadge: true };
    }
    const hours = Math.round(mins / 60);
    return { text: `逾期 ${hours}h`, isUrgent: true, isPast: true, showBadge: true };
  }

  const mins = Math.round(diffSec / 60);
  if (mins <= 15) {
    return { text: `${mins <= 0 ? '立刻' : mins + '分钟内'}`, isUrgent: true, isPast: false, showBadge: true };
  }
  if (mins < 60) {
    return { text: `${mins}m后`, isUrgent: false, isPast: false, showBadge: true };
  }
  const hours = Math.round(mins / 60);
  return { text: `${hours}h后`, isUrgent: false, isPast: false, showBadge: true };
}

/**
 * 清理备注中的常见 Markdown 语法与待办复选框标记，生成紧凑的单行预览文本
 */
export function formatNotePreview(notes?: string): string {
  if (!notes) return '';
  return notes
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(`+)([^`]+)\1/g, '$2')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
