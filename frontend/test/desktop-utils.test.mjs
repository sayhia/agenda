import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

import {
  formatPanguText,
  parseNaturalReminder,
} from '../src/utils/nlp.ts';
import {
  formatRepeatLabel,
  formatDurationLabel,
  formatNotePreview,
  formatTime,
  formatDateLabel,
  formatRelativeTime,
  getCountdownBadge,
  highlightMatch,
} from '../src/utils/format.ts';
import { checkTimeConflict, calculateScheduleDensity } from '../src/utils/conflict.ts';
import { escapeHTML, sanitizeHTML } from '../src/utils/sanitize.ts';
import { getTagColor, setCustomTagColor, getCustomTagColors } from '../src/utils/tagColors.ts';
import { fuzzyMatchPinyin } from '../src/utils/pinyin.ts';
import {
  AMBIENT_SOUND_OPTIONS,
  getActiveAmbientSound,
  isAmbientPreviewActive,
  playReminderChime,
  playFocusCompleteChime,
  playFocusDistractionSound,
  playFocusPauseSound,
  playFocusStartSound,
  playFocusTickSound,
  previewAmbientSound,
  startAmbientSound,
  stopAmbientPreviewIfIdle,
  stopAmbientSound,
  setAmbientVolume,
  getSoundVolume,
  setSoundVolume,
  getSoundProfile,
  getSoundProfileLabel,
  setSoundProfile,
} from '../src/utils/audio.ts';
import {
  DEFAULT_FOCUS_PREFERENCES,
  FOCUS_PRESETS,
  FOCUS_VIEW_FORMS,
  aggregateDailyFocusMap,
  buildReminderFocusMap,
  buildWeeklyFocusTrend,
  calculateFocusStreak,
  clearFocusHistory,
  clearFocusSession,
  computeRemainingSeconds,
  deleteFocusHistoryEntry,
  exportFocusHistoryMarkdown,
  formatFocusClock,
  formatFocusDateKey,
  formatMinutesCompact,
  getBreathingCue,
  getDialHudStyleForTheme,
  getFocusEffectStyleForTheme,
  getFocusModeBreakdown,
  getFocusStatsOverview,
  getFocusThemeAura,
  getRecommendedAmbientForTheme,
  getReminderFocusSummary,
  loadFocusHistory,
  loadFocusPreferences,
  loadFocusSession,
  recordFocusHistoryEntry,
  resetFocusPreferences,
  resolveNextPhase,
  sanitizeFocusPreferences,
  sanitizeFocusSession,
  saveFocusPreferences,
  saveFocusSession,
  tagFocusHistoryEntryMood,
} from '../src/utils/focus.ts';
import { exportToMarkdown, exportToCSV } from '../src/utils/export.ts';
import {
  THEME_DEFINITIONS,
  normalizeThemeId,
  getThemeDefinition,
  isShanshuiThemeId,
  isLightThemeId,
  getShanshuiThemes,
  getPairedThemeId,
  cycleTheme,
  getThemeAutoMode,
  setThemeAutoMode,
  getFavoriteThemeIds,
  toggleFavoriteThemeId,
  getRecentThemeIds,
  recordRecentThemeId,
  filterThemes,
  getThemePrimaryColor,
  getThemeBackgroundHex,
  getShanshuiSerifMode,
  setShanshuiSerifMode,
  getHighContrastMode,
  setHighContrastMode,
  validateThemeDefinitions,
  getSoundFollowTheme,
  setSoundFollowTheme,
  resolveEffectiveThemeId,
  CUSTOM_ACCENT_PRESETS,
  getRelativeLuminance,
  getContrastRatio,
  pickReadableInk,
  getCanvasIntensity,
  setCanvasIntensity,
  cycleCanvasIntensity,
  getCustomAccentOverride,
  setCustomAccentOverride,
  exportThemeConfigJSON,
  importThemeConfigJSON,
  resetThemePreferences,
} from '../src/utils/themes.ts';
import {
  getChineseShichen,
  getApproxSolarTerm,
  getChineseMonthAlias,
  getRecommendedShanshuiThemeForTime,
  getDailyShanshuiProverb,
  getShanshuiGreeting,
  getSeasonalAtmosphere,
  getShanshuiThemeAtmosphere,
  getSeasonalShanshuiRecommendation,
  getAllSolarTerms,
  getSolarTermsBySeason,
  getSolarTermOnDate,
  getNextSolarTerm,
  getFourSeasonsMeta,
  getCurrentSeasonMeta,
} from '../src/utils/shanshui.ts';
import { t, getLanguage, setLanguage } from '../src/utils/i18n.ts';
import {
  parseReminderSubtasks,
  parseReminderTags,
  toUpdateReminderRequest,
} from '../src/domain/reminder.ts';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
}

// 1. Natural language parser + Pangu spacing
check('nlp parses tomorrow afternoon, #tags, and P0 priority cleanly', () => {
  const refNow = new Date(2026, 10, 12, 9, 0, 0, 0);
  const parsed = parseNaturalReminder('明天下午4点架构评审 #工程 #发布 P0', refNow);
  assert.equal(parsed.title, '架构评审');
  assert.equal(parsed.priority, 'p0');
  assert.equal(parsed.tags, '工程,发布');
  assert.equal(parsed.hasTime, true);

  const sched = new Date(parsed.scheduledAt);
  assert.equal(sched.getFullYear(), 2026);
  assert.equal(sched.getMonth(), 10);
  assert.equal(sched.getDate(), 13);
  assert.equal(sched.getHours(), 16);
  assert.equal(sched.getMinutes(), 0);
});

check('nlp parses explicit lead minutes and daily repeat rule', () => {
  const refNow = new Date(2026, 10, 12, 8, 0, 0, 0);
  const parsed = parseNaturalReminder('每天 10:30 站会 提前15分钟 p1', refNow);
  assert.equal(parsed.priority, 'p1');
  assert.equal(parsed.leadSpecified, true);
  assert.equal(parsed.leadMinutes, 15);
  assert.equal(parsed.repeatRule, 'FREQ=DAILY');
  assert.equal(parsed.hasTime, true);
});

check('formatPanguText inserts thin ASCII/CJK spaces without breaking punctuation', () => {
  assert.equal(formatPanguText('发布v4.0版本和API接口'), '发布 v4.0 版本和 API 接口');
  assert.equal(formatPanguText('纯中文句子'), '纯中文句子');
});

// 2. Time conflict detector
check('checkTimeConflict ignores done items, respects excludeId, and suggests free slot', () => {
  const t1000 = new Date(2026, 10, 12, 10, 0, 0, 0).toISOString();
  const t1010 = new Date(2026, 10, 12, 10, 10, 0, 0).toISOString();
  const t1015 = new Date(2026, 10, 12, 10, 15, 0, 0).toISOString();
  const t0930 = new Date(2026, 10, 12, 9, 30, 0, 0).toISOString();

  const existing = [
    { id: 'r1', title: '晨会', status: 'active', scheduled_at: t1000, duration_minutes: 45 },
    { id: 'r2', title: '已完成会议', status: 'done', scheduled_at: t1010, duration_minutes: 30 },
  ];

  const overlap = checkTimeConflict(t1015, 30, existing);
  assert.equal(overlap.hasConflict, true);
  assert.equal(overlap.conflicts.length, 1);
  assert.equal(overlap.conflicts[0].id, 'r1');
  assert.equal(overlap.suggestedTime, new Date(2026, 10, 12, 10, 50, 0, 0).toISOString());

  const selfExcluded = checkTimeConflict(t1000, 45, existing, 'r1');
  assert.equal(selfExcluded.hasConflict, false);

  const adjacentBefore = checkTimeConflict(t0930, 30, existing);
  assert.equal(adjacentBefore.hasConflict, false);
});

// 3. HTML escape & fallback sanitizer
check('escapeHTML neutralizes special HTML characters', () => {
  assert.equal(
    escapeHTML('<script>alert("x") & \'y\'</script>'),
    '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
  );
});

check('sanitizeHTML neutralizes unsafe markup when DOMParser is absent', () => {
  const out = sanitizeHTML('<img src=x onerror=alert(1)><b>ok</b>');
  assert.equal(out.includes('<img'), false);
  assert.equal(out.includes('&lt;img'), true);
});

// 4. Deterministic tag color generator
check('getTagColor returns deterministic color tokens across CJK and ASCII tags', () => {
  const a1 = getTagColor('工程');
  const a2 = getTagColor('工程');
  assert.deepEqual(a1, a2);
  assert.ok(a1.bg && a1.text && a1.border);

  const b = getTagColor('release');
  assert.ok(b.bg && b.text && b.border);

  const empty = getTagColor('');
  assert.ok(empty.bg && empty.text && empty.border);
});

// 5. Domain reminder normalization & UpdateReminderRequest mapping
check('parseReminderTags and parseReminderSubtasks normalize malformed inputs', () => {
  assert.deepEqual(parseReminderTags(' 工程, 发布 , , 复盘 '), ['工程', '发布', '复盘']);
  assert.deepEqual(parseReminderTags(''), []);

  const subs = parseReminderSubtasks(
    JSON.stringify([{ id: 's1', title: '写测试', done: true }, { title: '打包' }]),
  );
  assert.equal(subs.length, 2);
  assert.deepEqual(subs[0], { id: 's1', title: '写测试', done: true });
  assert.deepEqual(subs[1], { id: 'subtask-1', title: '打包', done: false });
  assert.deepEqual(parseReminderSubtasks('not-json'), []);
});

check('toUpdateReminderRequest preserves pin, duration, priority, tags while patching fields', () => {
  const base = {
    id: 'rem_1',
    title: '原标题',
    repeat_rule: 'FREQ=WEEKLY',
    lead_minutes: 15,
    notes: '备注',
    duration_minutes: 25,
    timezone: 'Asia/Shanghai',
    prompt: '提醒',
    status: 'active',
    priority: 'p1',
    tags: '工程,发布',
    subtasks: '[]',
    is_pinned: true,
  };
  const req = toUpdateReminderRequest(base, { title: '新标题', status: 'done' });
  assert.equal(req.id, 'rem_1');
  assert.equal(req.title, '新标题');
  assert.equal(req.status, 'done');
  assert.equal(req.is_pinned, true);
  assert.equal(req.duration_minutes, 25);
  assert.equal(req.priority, 'p1');
  assert.equal(req.tags, '工程,发布');
  assert.equal(req.lead_minutes, 15);
});

// 6. Pinyin initial & fuzzy matching
check('fuzzyMatchPinyin matches initials and Chinese strings', () => {
  assert.equal(fuzzyMatchPinyin('新建日程', 'xj'), true);
  assert.equal(fuzzyMatchPinyin('日程管理', 'rc'), true);
  assert.equal(fuzzyMatchPinyin('切换主题', 'zt'), true);
  assert.equal(fuzzyMatchPinyin('专注番茄钟', 'zz'), true);
  assert.equal(fuzzyMatchPinyin('普通文字', 'fzk'), false);
  assert.equal(fuzzyMatchPinyin('帮助中心', 'help'), false);
  assert.equal(fuzzyMatchPinyin('任何文字', ''), true);
});

// 7. Schedule density heatmap calculator
check('calculateScheduleDensity computes workload percentages and density levels', () => {
  const d = '2026-11-13';
  const reminders = [
    { id: '1', title: 'Task 1', scheduled_at: '2026-11-13T09:00:00Z', duration_minutes: 60, status: 'active' },
    { id: '2', title: 'Task 2', scheduled_at: '2026-11-13T11:00:00Z', duration_minutes: 90, status: 'active' },
    { id: '3', title: 'Task 3', scheduled_at: '2026-11-14T09:00:00Z', duration_minutes: 120, status: 'active' },
    { id: '4', title: 'Ended Task', scheduled_at: '2026-11-13T14:00:00Z', duration_minutes: 60, status: 'ended' },
  ];

  const density = calculateScheduleDensity(d, reminders);
  assert.equal(density.totalBusyMinutes, 150); // 60 + 90
  assert.equal(density.densityPct, 25); // 150 / 600
  assert.equal(density.level, 'medium');
  assert.equal(density.conflictsCount, 0); // 09:00-10:00 and 11:00-12:30 do not overlap

  const overlappingReminders = [
    ...reminders,
    { id: '5', title: 'Overlapping Task', scheduled_at: '2026-11-13T09:30:00Z', duration_minutes: 45, status: 'active' },
  ];
  const overlapDensity = calculateScheduleDensity(d, overlappingReminders);
  assert.equal(overlapDensity.conflictsCount, 1);

  const emptyDensity = calculateScheduleDensity('2026-11-15', reminders);
  assert.equal(emptyDensity.totalBusyMinutes, 0);
  assert.equal(emptyDensity.level, 'low');
  assert.equal(emptyDensity.conflictsCount, 0);
});

// 8. Advanced Chinese NLP expressions
check('nlp handles 特急, 重要不紧急, and 下下周', () => {
  const refNow = new Date(2026, 10, 12, 9, 0, 0, 0);
  const p0 = parseNaturalReminder('特急：修复线上事故', refNow);
  assert.equal(p0.priority, 'p0');

  const p1 = parseNaturalReminder('重要不紧急 规划年度架构路线图', refNow);
  assert.equal(p1.priority, 'p1');

  const nextNextWeek = parseNaturalReminder('下下周三下午3点一刻季度战略研讨', refNow);
  assert.equal(nextNextWeek.hasTime, true);
  const sched = new Date(nextNextWeek.scheduledAt);
  assert.equal(sched.getHours(), 15);
  assert.equal(sched.getMinutes(), 15);
});

// 9. Sound synthesizer module
check('sound synthesizer functions are callable without throwing', () => {
  assert.equal(typeof playReminderChime, 'function');
  assert.equal(typeof playFocusCompleteChime, 'function');
  // In node environment without window.AudioContext, it safely returns or handles error
  assert.doesNotThrow(() => playReminderChime());
  assert.doesNotThrow(() => playFocusCompleteChime());
});

// 10. Volume and custom audio settings
check('getSoundVolume and setSoundVolume clamp and preserve numbers', () => {
  setSoundVolume(0.75);
  assert.equal(getSoundVolume(), 0.75);
  setSoundVolume(1.5);
  assert.equal(getSoundVolume(), 1.0);
  setSoundVolume(-0.2);
  assert.equal(getSoundVolume(), 0.0);
});

// 11. Duration & all-day NLP parsing
check('nlp handles 持续一个半小时, 两小时, 全天, 一刻钟', () => {
  const refNow = new Date(2026, 10, 12, 9, 0, 0, 0);
  const r1 = parseNaturalReminder('今天下午3点架构研讨 持续一个半小时', refNow);
  assert.equal(r1.durationMinutes, 90);

  const r2 = parseNaturalReminder('明天上午10点深度编程 持续两小时', refNow);
  assert.equal(r2.durationMinutes, 120);

  const r3 = parseNaturalReminder('周五公司年会 全天活动', refNow);
  assert.equal(r3.durationMinutes, 480);
});

// 12. Markdown export generation
check('exportToMarkdown formats reminders into readable checklist', () => {
  const list = [
    {
      id: 'm1',
      title: '发布新版',
      scheduled_at: '2026-11-13T10:00:00Z',
      priority: 'p0',
      tags: '发布,架构',
      status: 'active',
    },
  ];
  const md = exportToMarkdown(list);
  assert.ok(md.includes('日程管家 · 个人日程清单'));
  assert.ok(md.includes('发布新版'));
});

// 13. Custom Tag Color persistence
check('custom tag colors can be set and retrieved', () => {
  setCustomTagColor('生产环境', '#ff3366');
  const colors = getCustomTagColors();
  assert.equal(colors['生产环境'], '#ff3366');
  const token = getTagColor('生产环境');
  assert.ok(token.text.includes('#ff3366'));
});

// 14. i18n dictionary and toggle
check('i18n supports zh-CN and en-US dictionary lookup', () => {
  setLanguage('zh-CN');
  assert.equal(getLanguage(), 'zh-CN');
  assert.equal(t('app.title'), '日程管家');
  assert.equal(t('priority.p0'), 'P0 极紧急');

  setLanguage('en-US');
  assert.equal(getLanguage(), 'en-US');
  assert.equal(t('app.title'), 'Agenda Butler');
  assert.equal(t('priority.p0'), 'P0 Critical');
  setLanguage('zh-CN'); // Reset
});

// 15. Relative multi-day offsets and 大后天
check('nlp handles 大后天, 3天后, and 下下个月', () => {
  const refNow = new Date(2026, 10, 12, 9, 0, 0, 0); // 2026-11-12
  const r1 = parseNaturalReminder('大后天上午10点团队聚餐', refNow);
  const d1 = new Date(r1.scheduledAt);
  assert.equal(d1.getDate(), 15);

  const r2 = parseNaturalReminder('3天后下午2点项目验收', refNow);
  const d2 = new Date(r2.scheduledAt);
  assert.equal(d2.getDate(), 15);

  const r3 = parseNaturalReminder('下下个月15号发布新版本', refNow);
  const d3 = new Date(r3.scheduledAt);
  assert.equal(d3.getMonth(), 0); // 11 + 2 = Jan (0)
  assert.equal(d3.getDate(), 15);
  assert.equal(d3.getFullYear(), 2027);
});

// 16. Multi-tag combinations with AND / OR
check('multi-tag combinations evaluate correctly for AND / OR modes', () => {
  const r1 = { tags: '工作, 重要, 架构' };
  const r2 = { tags: '生活, 健身' };
  const r3 = { tags: '工作, 日常' };

  const targetTags = ['工作', '架构'];

  // AND mode: item must contain all target tags
  const andMatch = (item) => {
    const itemTags = parseReminderTags(item.tags);
    return targetTags.every((t) => itemTags.includes(t));
  };

  assert.equal(andMatch(r1), true);
  assert.equal(andMatch(r2), false);
  assert.equal(andMatch(r3), false);

  // OR mode: item contains any of the target tags
  const orMatch = (item) => {
    const itemTags = parseReminderTags(item.tags);
    return targetTags.some((t) => itemTags.includes(t));
  };

  assert.equal(orMatch(r1), true);
  assert.equal(orMatch(r2), false);
  assert.equal(orMatch(r3), true);
});

// 17. Smart snooze presets offset calculation
check('smart snooze presets compute correct future target times', () => {
  const now = new Date(2026, 10, 12, 14, 0, 0, 0); // Thursday 14:00
  // Tomorrow 09:00
  const tom = new Date(now);
  tom.setDate(tom.getDate() + 1);
  tom.setHours(9, 0, 0, 0);
  assert.equal(tom.getDate(), 13);
  assert.equal(tom.getHours(), 9);

  // Weekend Saturday 10:00 (Thursday is day 4 -> Saturday is +2 days)
  const sat = new Date(now);
  const daysUntilSaturday = ((6 - sat.getDay() + 7) % 7) || 7;
  sat.setDate(sat.getDate() + daysUntilSaturday);
  sat.setHours(10, 0, 0, 0);
  assert.equal(sat.getDay(), 6);
  assert.equal(sat.getDate(), 14);

  // Next Monday 09:00 (Thursday is day 4 -> next Monday is +4 days)
  const mon = new Date(now);
  const daysUntilMonday = ((1 - mon.getDay() + 7) % 7) || 7;
  mon.setDate(mon.getDate() + daysUntilMonday);
  mon.setHours(9, 0, 0, 0);
  assert.equal(mon.getDay(), 1);
  assert.equal(mon.getDate(), 16);
});

// 18. Relative task duplication offset
check('relative duplication offset shifts target date cleanly', () => {
  const origSched = '2026-11-13T10:00:00.000Z';
  const d1 = new Date(origSched);
  d1.setDate(d1.getDate() + 1);
  assert.equal(d1.toISOString().slice(0, 10), '2026-11-14');

  const d7 = new Date(origSched);
  d7.setDate(d7.getDate() + 7);
  assert.equal(d7.toISOString().slice(0, 10), '2026-11-20');
});

// 19. Extended i18n dictionary lookup
check('extended i18n keys for next_up and snooze work in zh-CN and en-US', () => {
  setLanguage('zh-CN');
  assert.equal(t('next_up'), '下一个日程');
  assert.equal(t('snooze.tomorrow'), '明天 09:00');
  assert.equal(t('duplicate.nextweek'), '克隆为下周同时间 (+7天)');

  setLanguage('en-US');
  assert.equal(t('next_up'), 'Next Up');
  assert.equal(t('snooze.tomorrow'), 'Tomorrow 09:00');
  assert.equal(t('duplicate.nextweek'), 'Clone to next week (+7d)');
  setLanguage('zh-CN');
});

// 20. Extended NLP recurrences & month boundaries (biweekly, quarterly, last Friday of month, next month start/end)
check('nlp parses 每两周, 每季度, 每个月最后一个周五, 下月初, and 月末', () => {
  const refNow = new Date(2026, 10, 12, 9, 0, 0, 0); // 2026-11-12
  const biweekly = parseNaturalReminder('每两周周五下午4点双周迭代复盘', refNow);
  assert.equal(biweekly.repeatRule, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR');

  const quarterly = parseNaturalReminder('每季度上午10点OKR对齐会', refNow);
  assert.equal(quarterly.repeatRule, 'FREQ=MONTHLY;INTERVAL=3');

  const lastFri = parseNaturalReminder('每个月最后一个周五下午5点月度总结', refNow);
  assert.equal(lastFri.repeatRule, 'FREQ=MONTHLY;BYDAY=-1FR');

  const nextMonthStart = parseNaturalReminder('下月初上午9点核对账单', refNow);
  const dStart = new Date(nextMonthStart.scheduledAt);
  assert.equal(dStart.getMonth(), 11); // December
  assert.equal(dStart.getDate(), 1);

  const monthEnd = parseNaturalReminder('月末下午6点提交月报', refNow);
  const dEnd = new Date(monthEnd.scheduledAt);
  assert.equal(dEnd.getMonth(), 10); // November has 30 days
  assert.equal(dEnd.getDate(), 30);
});

// 21. Markdown export preserves pinned indicator and multi-line notes
check('exportToMarkdown renders 📌 for pinned reminders and formats multi-line notes', () => {
  const md = exportToMarkdown([
    {
      id: 'pin-1',
      title: '核心发布里程碑',
      scheduled_at: '2026-11-14T10:00:00Z',
      priority: 'p0',
      status: 'active',
      is_pinned: true,
      notes: '第一行说明\n- [ ] 检查灰度配置',
    },
  ]);
  assert.ok(md.includes('📌 **核心发布里程碑**'));
  assert.ok(md.includes('  > 备注: 第一行说明\n  > - [ ] 检查灰度配置'));
});

// 22. Extended repeat label formatting & cascading conflict slot suggestion
check('formatRepeatLabel and cascading checkTimeConflict handle complex recurrences and back-to-back slots', () => {
  assert.equal(formatRepeatLabel('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR'), '每两周 周五');
  assert.equal(formatRepeatLabel('FREQ=MONTHLY;INTERVAL=3'), '每季度');
  assert.equal(formatRepeatLabel('FREQ=MONTHLY;BYDAY=2MO'), '每月第2个周一');
  assert.equal(formatRepeatLabel('FREQ=MONTHLY;BYMONTHDAY=-1'), '每月最后一天');
  assert.equal(formatRepeatLabel('FREQ=DAILY;INTERVAL=3'), '每 3 天');

  const refNow = new Date(2026, 10, 12, 9, 0, 0, 0);
  const morgen = parseNaturalReminder('明早8点半产品晨会', refNow);
  const morgenDate = new Date(morgen.scheduledAt);
  assert.equal(morgenDate.getDate(), 13);
  assert.equal(morgenDate.getHours(), 8);
  assert.equal(morgenDate.getMinutes(), 30);

  const monthLastDay = parseNaturalReminder('每月最后一天下午5点财务月结', refNow);
  assert.equal(monthLastDay.repeatRule, 'FREQ=MONTHLY;BYMONTHDAY=-1');

  // Cascading conflict: r1 is 10:00..10:45, r2 is 10:45..11:15 -> proposing 10:15 (30m) should cascade past r2 to 11:20
  const t1000 = new Date(2026, 10, 12, 10, 0, 0, 0).toISOString();
  const t1015 = new Date(2026, 10, 12, 10, 15, 0, 0).toISOString();
  const t1045 = new Date(2026, 10, 12, 10, 45, 0, 0).toISOString();
  const backToBack = [
    { id: 'b1', title: '第一场', status: 'active', scheduled_at: t1000, duration_minutes: 45 },
    { id: 'b2', title: '紧接第二场', status: 'active', scheduled_at: t1045, duration_minutes: 30 },
  ];
  const res = checkTimeConflict(t1015, 30, backToBack);
  assert.equal(res.hasConflict, true);
  assert.equal(res.suggestedTime, new Date(2026, 10, 12, 11, 20, 0, 0).toISOString());
});

// 23. formatDurationLabel, multi-week repeat, English NLP keywords, and CSV pinned export
check('formatDurationLabel, English NLP, and exportToCSV pinned column work as expected', () => {
  assert.equal(formatDurationLabel(0), '0 分钟');
  assert.equal(formatDurationLabel(45), '45 分钟');
  assert.equal(formatDurationLabel(60), '1 小时');
  assert.equal(formatDurationLabel(90), '1 小时 30 分');
  assert.equal(formatRepeatLabel('FREQ=WEEKLY;INTERVAL=3'), '每 3 周');

  const refNow = new Date(2026, 10, 12, 9, 0, 0, 0);
  const dailyEn = parseNaturalReminder('daily standup tomorrow 10:00', refNow);
  assert.equal(dailyEn.repeatRule, 'FREQ=DAILY');
  assert.equal(new Date(dailyEn.scheduledAt).getDate(), 13);

  const triWeekly = parseNaturalReminder('每3周项目对齐会', refNow);
  assert.equal(triWeekly.repeatRule, 'FREQ=WEEKLY;INTERVAL=3');

  const csv = exportToCSV([
    {
      id: 'c1',
      title: '置顶任务',
      scheduled_at: '2026-11-15T10:00:00Z',
      status: 'active',
      priority: 'p0',
      repeat_rule: '',
      lead_minutes: 10,
      duration_minutes: 45,
      tags: '核心',
      notes: '',
      subtasks: '',
      is_pinned: true,
    },
  ]);
  assert.ok(csv.includes('是否置顶'));
  assert.ok(csv.includes(',是'));
  assert.ok(!csv.includes(',无,'));
});

// 24. Chinese landscape (Shanshui) aesthetic themes registry
check('THEME_DEFINITIONS includes 19 Chinese landscape themes (with 7 light Xuan-paper modes & 12 dark ink) and normalizes legacy IDs', () => {
  const shanshuiThemes = getShanshuiThemes();
  assert.equal(shanshuiThemes.length, 19);
  assert.deepEqual(
    shanshuiThemes.map((t) => t.id),
    [
      'shanshui-jiangshan',
      'shanshui-huangshan',
      'shanshui-potala',
      'shanshui-guilin',
      'shanshui-sanxia',
      'shanshui-taishan',
      'shanshui-xihu',
      'shanshui-lushan',
      'shanshui-jiangnan',
      'shanshui-emei',
      'shanshui-dunhuang',
      'shanshui-jiuzhaigou',
      'shanshui-suzhou',
      'shanshui-zhangjiajie',
      'shanshui-changbai',
      'shanshui-tianqing',
      'shanshui-qixia',
      'shanshui-erhai',
      'shanshui-qingcheng',
    ],
  );
  for (const t of shanshuiThemes) {
    assert.ok(t.sealChar && t.pigment && t.poem, `theme ${t.id} should include sealChar, pigment, and poem`);
  }
  const lightShanshuiCount = shanshuiThemes.filter((t) => isLightThemeId(t.id)).length;
  assert.equal(lightShanshuiCount, 7);
  assert.equal(isLightThemeId('shanshui-tianqing'), true);
  assert.equal(isLightThemeId('shanshui-qixia'), true);
  assert.equal(isShanshuiThemeId('shanshui-erhai'), true);
  assert.equal(isShanshuiThemeId('shanshui-qingcheng'), true);
  assert.equal(isShanshuiThemeId('shanshui-jiangshan'), true);
  assert.equal(isShanshuiThemeId('shanshui-jiangnan'), true);
  assert.equal(isShanshuiThemeId('shanshui-emei'), true);
  assert.equal(isShanshuiThemeId('shanshui-dunhuang'), true);
  assert.equal(isShanshuiThemeId('shanshui-jiuzhaigou'), true);
  assert.equal(isShanshuiThemeId('shanshui-suzhou'), true);
  assert.equal(isShanshuiThemeId('shanshui-zhangjiajie'), true);
  assert.equal(isShanshuiThemeId('shanshui-changbai'), true);
  assert.equal(isShanshuiThemeId('shanshui-lushan'), true);
  assert.equal(isShanshuiThemeId('midnight'), false);
  assert.equal(isLightThemeId('shanshui-jiangshan'), true);
  assert.equal(isLightThemeId('shanshui-jiangnan'), true);
  assert.equal(isLightThemeId('shanshui-dunhuang'), true);
  assert.equal(isLightThemeId('shanshui-suzhou'), true);
  assert.equal(isLightThemeId('shanshui-changbai'), true);
  assert.equal(isLightThemeId('daylight'), true);
  assert.equal(isLightThemeId('shanshui-lushan'), false);
  assert.equal(isLightThemeId('shanshui-emei'), false);
  assert.equal(isLightThemeId('shanshui-jiuzhaigou'), false);
  assert.equal(isLightThemeId('shanshui-zhangjiajie'), false);
  assert.equal(isLightThemeId('shanshui-huangshan'), false);
  assert.equal(normalizeThemeId('obsidian'), 'midnight');
  assert.equal(normalizeThemeId('rmb-100'), 'midnight');
  assert.equal(normalizeThemeId('rmb-50'), 'shanshui-potala');
  assert.equal(normalizeThemeId(null), 'midnight');
  assert.equal(getThemeDefinition('rmb-100')?.id, 'midnight');
  assert.equal(getThemeDefinition('shanshui-potala')?.badge, '雪域');
  assert.equal(getThemeDefinition('shanshui-jiangshan')?.sealChar, '江');
  assert.equal(getThemeDefinition('shanshui-lushan')?.sealChar, '瀑');
  assert.equal(getThemeDefinition('shanshui-jiangnan')?.sealChar, '徽');
  assert.equal(getThemeDefinition('shanshui-emei')?.sealChar, '峨');
  assert.equal(getThemeDefinition('shanshui-dunhuang')?.sealChar, '敦');
  assert.equal(getThemeDefinition('shanshui-jiuzhaigou')?.sealChar, '九');
  assert.equal(getThemeDefinition('shanshui-suzhou')?.sealChar, '园');
  assert.equal(getThemeDefinition('shanshui-zhangjiajie')?.sealChar, '陵');
  assert.equal(getThemeDefinition('shanshui-changbai')?.sealChar, '池');
});

// 25. Chinese Shanshui 12 Shichen, 24 Solar Terms, month aliases & diurnal theme recommendation
check('shanshui helpers compute Shichen, Solar Term, month alias, and time-of-day theme', () => {
  assert.equal(getChineseShichen(new Date(2026, 10, 15, 0, 30)).branch, '子');
  assert.equal(getChineseShichen(new Date(2026, 10, 15, 6, 15)).branch, '卯');
  assert.equal(getChineseShichen(new Date(2026, 10, 15, 12, 0)).branch, '午');
  assert.equal(getChineseShichen(new Date(2026, 10, 15, 19, 30)).branch, '戌');
  assert.equal(getChineseShichen(new Date(2026, 10, 15, 23, 10)).branch, '子');

  assert.equal(getApproxSolarTerm(new Date(2026, 3, 5)).name, '清明');
  assert.equal(getApproxSolarTerm(new Date(2026, 10, 15)).name, '立冬');
  assert.equal(getApproxSolarTerm(new Date(2026, 11, 22)).name, '冬至');
  assert.equal(getApproxSolarTerm(new Date(2026, 0, 2)).name, '冬至');

  assert.equal(getChineseMonthAlias(0), '端月');
  assert.equal(getChineseMonthAlias(10), '冬月');
  assert.equal(getChineseMonthAlias(11), '腊月');

  assert.equal(getRecommendedShanshuiThemeForTime(new Date(2026, 10, 15, 5, 30)), 'shanshui-xihu');
  assert.equal(getRecommendedShanshuiThemeForTime(new Date(2026, 10, 15, 9, 0)), 'shanshui-jiangnan');
  assert.equal(getRecommendedShanshuiThemeForTime(new Date(2026, 10, 15, 14, 0)), 'shanshui-jiangshan');
  assert.equal(getRecommendedShanshuiThemeForTime(new Date(2026, 10, 15, 19, 0)), 'shanshui-taishan');
  assert.equal(getRecommendedShanshuiThemeForTime(new Date(2026, 10, 15, 21, 30)), 'shanshui-lushan');
  assert.equal(getRecommendedShanshuiThemeForTime(new Date(2026, 10, 15, 23, 30)), 'shanshui-huangshan');
});

// 26. Daily Shanshui proverb & time-aware poetic greeting
check('shanshui daily proverb and greeting return deterministic poetic copy', () => {
  const dayA = new Date(2026, 10, 15, 9, 15);
  const dayASame = new Date(2026, 10, 15, 22, 45);
  const p1 = getDailyShanshuiProverb(dayA);
  const p2 = getDailyShanshuiProverb(dayASame);
  assert.ok(p1.text.length > 0 && p1.source.length > 0);
  assert.deepEqual(p1, p2);

  const greeting = getShanshuiGreeting(dayA);
  assert.ok(greeting.length > 0 && greeting.includes('巳'));
});

// 27. Four-season Shanshui atmosphere, theme motif mapping & seasonal recommendations
check('shanshui seasonal atmosphere, theme motifs and recommendations work across all seasons', () => {
  const spring = getSeasonalAtmosphere(new Date(2026, 3, 5));
  const summer = getSeasonalAtmosphere(new Date(2026, 6, 15));
  const autumn = getSeasonalAtmosphere(new Date(2026, 9, 10));
  const winter = getSeasonalAtmosphere(new Date(2026, 11, 25));
  assert.equal(spring.particleType, 'petal');
  assert.equal(summer.particleType, 'firefly');
  assert.equal(autumn.particleType, 'maple');
  assert.equal(winter.particleType, 'snow');
  assert.ok(spring.teaSuggestion.length > 0 && winter.auraLabel.length > 0);

  for (const t of getShanshuiThemes()) {
    const motifInfo = getShanshuiThemeAtmosphere(t.id);
    assert.ok(motifInfo.mood && motifInfo.motif && motifInfo.inkTone, `missing motif metadata for ${t.id}`);
  }

  assert.equal(getSeasonalShanshuiRecommendation(new Date(2026, 3, 5, 10, 0)), 'shanshui-tianqing');
  assert.equal(getSeasonalShanshuiRecommendation(new Date(2026, 2, 22, 10, 0)), 'shanshui-suzhou');
  assert.equal(getSeasonalShanshuiRecommendation(new Date(2026, 6, 15, 20, 0)), 'shanshui-qingcheng');
  assert.equal(getSeasonalShanshuiRecommendation(new Date(2026, 9, 10, 14, 0)), 'shanshui-qixia');
  assert.equal(getSeasonalShanshuiRecommendation(new Date(2026, 8, 12, 14, 0)), 'shanshui-dunhuang');
  assert.equal(getSeasonalShanshuiRecommendation(new Date(2026, 11, 25, 11, 0)), 'shanshui-changbai');
});

// 28. Chinese pentatonic / temple bell sound profiles persistence
check('sound profile helpers persist Chinese guqin and qing sound profiles', () => {
  setSoundProfile('guqin');
  assert.equal(getSoundProfile(), 'guqin');
  setSoundProfile('qing');
  assert.equal(getSoundProfile(), 'qing');
});

// 29. Full 24 Solar Terms astronomical calculation & Four Seasons metadata
check('24 Solar Terms and Four Seasons almanac helpers compute exact dates, three pentads, countdowns, and season themes', () => {
  const terms2026 = getAllSolarTerms(2026);
  assert.equal(terms2026.length, 24);
  for (const term of terms2026) {
    assert.ok(term.name && term.sealChar && term.sanHou && term.custom && term.dateKey, `missing solar term data for ${term.name}`);
  }
  assert.equal(terms2026.find((t) => t.name === '立春')?.dateKey, '2026-02-04');
  assert.equal(terms2026.find((t) => t.name === '清明')?.dateKey, '2026-04-05');
  assert.equal(terms2026.find((t) => t.name === '夏至')?.dateKey, '2026-06-21');
  assert.equal(terms2026.find((t) => t.name === '秋分')?.dateKey, '2026-09-23');
  assert.equal(terms2026.find((t) => t.name === '立冬')?.dateKey, '2026-11-07');
  assert.equal(terms2026.find((t) => t.name === '冬至')?.dateKey, '2026-12-22');

  for (const season of ['春', '夏', '秋', '冬']) {
    assert.equal(getSolarTermsBySeason(season, 2026).length, 6);
  }

  assert.equal(getSolarTermOnDate(new Date(2026, 10, 7))?.name, '立冬');
  assert.equal(getSolarTermOnDate(new Date(2026, 10, 15)), null);

  const next = getNextSolarTerm(new Date(2026, 10, 15));
  assert.equal(next.term.name, '小雪');
  assert.equal(next.daysRemaining, 7);

  const seasons = getFourSeasonsMeta();
  assert.equal(seasons.length, 4);
  for (const s of seasons) {
    assert.ok(s.recommendedThemeIds.length >= 3);
    for (const tid of s.recommendedThemeIds) {
      assert.ok(isShanshuiThemeId(tid), `${tid} should be valid Shanshui theme`);
    }
  }
  assert.equal(getCurrentSeasonMeta(new Date(2026, 10, 15)).alias, '玄冬');
});

// 30. 24-theme studio completeness, polarity pairing, cycling, favorites & sound linkage
check('theme catalog has 24 complete themes with opposite-polarity counterparts, cycling, and favorites', () => {
  assert.equal(THEME_DEFINITIONS.length, 24);
  assert.equal(getShanshuiThemes().length, 19);

  const ids = new Set();
  for (const theme of THEME_DEFINITIONS) {
    assert.ok(!ids.has(theme.id), `duplicate theme id ${theme.id}`);
    ids.add(theme.id);
    assert.ok(theme.bgPreview && theme.color, `missing colors for ${theme.id}`);
    const pair = getThemeDefinition(theme.counterpartId);
    assert.ok(pair, `missing counterpart for ${theme.id}`);
    assert.notEqual(Boolean(theme.isLight), Boolean(pair.isLight), `${theme.id} counterpart must invert light/dark polarity`);
  }

  assert.equal(getPairedThemeId('midnight'), 'daylight');
  assert.equal(getPairedThemeId('shanshui-tianqing'), 'shanshui-erhai');
  assert.equal(normalizeThemeId('nonexistent-theme'), 'midnight');

  const next = cycleTheme('midnight', 1, 'all');
  assert.equal(next.id, 'daylight');
  const prev = cycleTheme('midnight', -1, 'all');
  assert.equal(prev.id, 'shanshui-qingcheng');

  assert.deepEqual(toggleFavoriteThemeId('shanshui-tianqing'), ['shanshui-tianqing']);
  assert.deepEqual(getFavoriteThemeIds(), ['shanshui-tianqing']);
  assert.deepEqual(toggleFavoriteThemeId('shanshui-tianqing'), []);

  setSoundFollowTheme(true);
  assert.equal(getSoundFollowTheme(), true);
  setSoundFollowTheme(false);
  assert.equal(getSoundFollowTheme(), false);
});

// 31. Adaptive theme modes (manual, circadian, seasonal, system)
check('resolveEffectiveThemeId adapts across manual, circadian, seasonal, and system modes', () => {
  setThemeAutoMode('manual');
  assert.equal(getThemeAutoMode(), 'manual');
  assert.equal(
    resolveEffectiveThemeId({ baseThemeId: 'shanshui-huangshan', mode: 'manual', now: new Date(2026, 6, 15, 11, 0) }),
    'shanshui-huangshan',
  );

  assert.equal(
    resolveEffectiveThemeId({ baseThemeId: 'shanshui-huangshan', mode: 'circadian', now: new Date(2026, 6, 15, 11, 0) }),
    'shanshui-jiangshan',
  );
  assert.equal(
    resolveEffectiveThemeId({ baseThemeId: 'shanshui-jiangshan', mode: 'circadian', now: new Date(2026, 6, 15, 22, 0) }),
    'shanshui-huangshan',
  );

  assert.equal(
    resolveEffectiveThemeId({ baseThemeId: 'midnight', mode: 'system', systemPrefersDark: false }),
    'daylight',
  );
  assert.equal(
    resolveEffectiveThemeId({ baseThemeId: 'daylight', mode: 'system', systemPrefersDark: true }),
    'midnight',
  );

  assert.equal(
    resolveEffectiveThemeId({ baseThemeId: 'midnight', mode: 'seasonal', now: new Date(2026, 11, 25, 11, 0) }),
    'shanshui-changbai',
  );
});

// 32. Theme pigment override, canvas intensity & config snapshot roundtrip
check('custom accent override, canvas intensity, and theme config export/import roundtrip work cleanly', () => {
  assert.ok(CUSTOM_ACCENT_PRESETS.some((p) => p.id === 'zhusha' && p.hex));
  assert.equal(pickReadableInk('#d9ff54'), '#0b0d10');
  assert.equal(pickReadableInk('#1f3b73'), '#ffffff');

  setCanvasIntensity('subtle');
  assert.equal(getCanvasIntensity(), 'subtle');
  assert.equal(cycleCanvasIntensity(), 'balanced');
  assert.equal(cycleCanvasIntensity(), 'vivid');
  assert.equal(cycleCanvasIntensity(), 'off');

  setCustomAccentOverride('shilv');
  assert.equal(getCustomAccentOverride(), 'shilv');
  setCustomAccentOverride('#AbC');
  assert.equal(getCustomAccentOverride(), '#aabbcc');

  setThemeAutoMode('manual');
  toggleFavoriteThemeId('shanshui-xihu');
  const snapshot = exportThemeConfigJSON();

  resetThemePreferences();
  assert.equal(getCanvasIntensity(), 'balanced');
  assert.equal(getCustomAccentOverride(), 'default');
  assert.deepEqual(getFavoriteThemeIds(), []);

  const badImport = importThemeConfigJSON('{bad-json');
  assert.equal(badImport.ok, false);

  const restored = importThemeConfigJSON(snapshot);
  assert.equal(restored.ok, true);
  assert.equal(getCanvasIntensity(), 'off');
  assert.equal(getCustomAccentOverride(), '#aabbcc');
  assert.ok(getFavoriteThemeIds().includes('shanshui-xihu'));

  resetThemePreferences();
});

// 33. Markdown note preview cleaner
check('formatNotePreview strips checkboxes, headings, emphasis, links and inline code cleanly', () => {
  assert.equal(formatNotePreview(''), '');
  assert.equal(
    formatNotePreview('### 议程\n- [ ] 检查 **核心指标** 与 `API`\n- [x] 阅读 [发布文档](https://example.com) ~~旧项~~'),
    '议程 检查 核心指标 与 API 阅读 发布文档 旧项',
  );
});

// 34. Theme studio integrity, WCAG contrast, filtering, recents, and sound labels
check('theme studio helpers validate catalog, WCAG ink contrast, filtering, recents, and sound labels', () => {
  const validation = validateThemeDefinitions();
  assert.equal(validation.valid, true, validation.errors.join('; '));

  // WCAG AA geometric threshold ensures mid-tone pigments like 藤黄 (#d4941e) use dark ink (>= 4.5:1)
  assert.equal(pickReadableInk('#d4941e'), '#0b0d10');
  assert.ok(getContrastRatio('#d4941e', '#0b0d10') >= 4.5);
  assert.ok(getRelativeLuminance('#ffffff') > getRelativeLuminance('#0b0d10'));

  // Extended mineral accent presets
  assert.ok(CUSTOM_ACCENT_PRESETS.some((p) => p.id === 'huaqing' && p.hex === '#3b6ea5'));
  assert.ok(CUSTOM_ACCENT_PRESETS.some((p) => p.id === 'xionghuang' && p.hex === '#d9822b'));

  // Unified filterThemes supports category, season, and query
  const springShanshui = filterThemes({ category: 'shanshui', season: '春' });
  assert.ok(springShanshui.length >= 4);
  assert.ok(springShanshui.every((t) => t.group === 'shanshui' && t.seasonHint === '春'));
  const tianqingSearch = filterThemes({ query: '汝窑' });
  assert.equal(tianqingSearch.length, 1);
  assert.equal(tianqingSearch[0].id, 'shanshui-tianqing');

  // Recent themes tracking caps at 5, deduplicates, and resets cleanly
  resetThemePreferences();
  assert.deepEqual(getRecentThemeIds(), []);
  recordRecentThemeId('shanshui-xihu');
  recordRecentThemeId('shanshui-tianqing');
  recordRecentThemeId('shanshui-xihu');
  assert.deepEqual(getRecentThemeIds(), ['shanshui-xihu', 'shanshui-tianqing']);
  for (const id of ['midnight', 'daylight', 'cyber', 'amber', 'aurora']) {
    recordRecentThemeId(id);
  }
  assert.equal(getRecentThemeIds().length, 5);
  assert.equal(getRecentThemeIds()[0], 'aurora');

  // Primary color resolution respects custom accent override
  setCustomAccentOverride('zhusha');
  assert.equal(getThemePrimaryColor('midnight'), '#d9483b');
  setCustomAccentOverride('default');
  assert.equal(getThemePrimaryColor('midnight'), '#46b7ff');

  // Sound profile label helper
  assert.equal(getSoundProfileLabel('guqin').short, '琴');
  assert.equal(getSoundProfileLabel('qing').label, '山寺玉磬');

  resetThemePreferences();
});

// 35. Theme serif/high-contrast prefs, v2 snapshot roundtrip, pinyin alias search & i18n theme keys
check('theme serif/high-contrast modes, v2 snapshot import/export, pinyin aliases, and i18n theme keys work cleanly', () => {
  resetThemePreferences();
  assert.equal(getThemeBackgroundHex('shanshui-jiangshan'), '#f4efe4');
  assert.equal(getThemeBackgroundHex('unknown'), '#07080a');

  // Pinyin / English alias search
  assert.ok(filterThemes({ query: 'ruyao' }).some((t) => t.id === 'shanshui-tianqing'));
  assert.ok(filterThemes({ query: 'westlake' }).some((t) => t.id === 'shanshui-xihu'));
  assert.equal(filterThemes({ query: 'light' }).length, 8);

  // Serif & high-contrast toggles + v2 snapshot roundtrip
  assert.equal(getShanshuiSerifMode(), false);
  assert.equal(getHighContrastMode(), false);
  setShanshuiSerifMode(true);
  setHighContrastMode(true);
  assert.equal(getShanshuiSerifMode(), true);
  assert.equal(getHighContrastMode(), true);

  const v2Snapshot = exportThemeConfigJSON();
  const parsedV2 = JSON.parse(v2Snapshot);
  assert.equal(parsedV2.version, 2);
  assert.equal(parsedV2.shanshuiSerif, true);
  assert.equal(parsedV2.highContrast, true);

  resetThemePreferences();
  assert.equal(getShanshuiSerifMode(), false);
  assert.equal(getHighContrastMode(), false);

  const restoredV2 = importThemeConfigJSON(v2Snapshot);
  assert.equal(restoredV2.ok, true);
  assert.equal(getShanshuiSerifMode(), true);
  assert.equal(getHighContrastMode(), true);

  // V1 snapshot backward compatibility defaults serif/highContrast to false
  const v1Result = importThemeConfigJSON(
    JSON.stringify({
      version: 1,
      theme: 'daylight',
      autoMode: 'manual',
      favorites: ['shanshui-tianqing'],
      soundFollowTheme: false,
      canvasIntensity: 'subtle',
      customAccent: 'default',
    }),
  );
  assert.equal(v1Result.ok, true);
  assert.equal(v1Result.themeId, 'daylight');
  assert.equal(getShanshuiSerifMode(), false);
  assert.equal(getHighContrastMode(), false);

  // i18n theme keys
  setLanguage('zh-CN');
  assert.equal(t('theme.studio'), '主题工坊');
  assert.equal(t('theme.high_contrast'), '高对比护眼模式');
  setLanguage('en-US');
  assert.equal(t('theme.studio'), 'Theme Studio');
  assert.equal(t('theme.serif'), 'Shanshui Serif Headings');
  setLanguage('zh-CN');

  resetThemePreferences();
});

// 36. Expired status i18n and markdown export separation
check('expired status is localized and exported separately from completed', () => {
  setLanguage('zh-CN');
  assert.equal(t('status.expired'), '已过期');
  assert.equal(t('status.ended'), '已完结');
  setLanguage('en-US');
  assert.equal(t('status.expired'), 'Expired');
  setLanguage('zh-CN');

  const md = exportToMarkdown([
    {
      id: 'exp-1',
      title: '过期的周会',
      scheduled_at: '2026-11-15T10:00:00Z',
      repeat_rule: '',
      lead_minutes: 0,
      notes: '',
      duration_minutes: 30,
      timezone: 'Asia/Shanghai',
      prompt: '',
      status: 'expired',
      priority: 'p1',
      tags: '',
      subtasks: '',
      deleted_at: '',
      is_pinned: false,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'end-1',
      title: '已完成评审',
      scheduled_at: '2026-11-15T11:00:00Z',
      repeat_rule: '',
      lead_minutes: 0,
      notes: '',
      duration_minutes: 30,
      timezone: 'Asia/Shanghai',
      prompt: '',
      status: 'ended',
      priority: 'p2',
      tags: '',
      subtasks: '',
      deleted_at: '',
      is_pinned: false,
      created_at: '',
      updated_at: '',
    },
  ]);
  assert.ok(md.includes('## ⏰ 已过期 (1)'));
  assert.ok(md.includes('- [ ] **过期的周会**'));
  assert.ok(md.includes('## ✅ 已完成 / 已结束 (1)'));
  assert.ok(md.includes('- [x] ~~已完成评审~~'));
});

// 37. Focus utility formatting, presets & preference sanitization
check('focus formatting, presets and preferences clamping work accurately', () => {
  assert.equal(formatFocusClock(1500), '25:00');
  assert.equal(formatFocusClock(3665), '1:01:05');
  assert.equal(formatFocusClock(-10), '00:00');
  assert.equal(formatMinutesCompact(45), '45m');
  assert.equal(formatMinutesCompact(60), '1h');
  assert.equal(formatMinutesCompact(85), '1h 25m');
  assert.ok(FOCUS_PRESETS.length >= 5);

  const sanitized = sanitizeFocusPreferences({
    focusMinutes: 999,
    shortBreakMinutes: 0,
    longBreakInterval: 20,
    dailyGoalMinutes: 5,
    ambientSound: 'invalid-sound',
    ambientVolume: 2.5,
  });
  assert.equal(sanitized.focusMinutes, 180);
  assert.equal(sanitized.shortBreakMinutes, 1);
  assert.equal(sanitized.longBreakInterval, 8);
  assert.equal(sanitized.dailyGoalMinutes, 15);
  assert.equal(sanitized.ambientSound, DEFAULT_FOCUS_PREFERENCES.ambientSound);
  assert.equal(sanitized.ambientVolume, 1);

  const saved = saveFocusPreferences({ focusMinutes: 45, autoStartBreak: true, ambientSound: 'rain' });
  assert.equal(saved.focusMinutes, 45);
  assert.equal(loadFocusPreferences().autoStartBreak, true);
  assert.equal(loadFocusPreferences().ambientSound, 'rain');
  const reset = resetFocusPreferences();
  assert.equal(reset.focusMinutes, 25);
});

// 38. Focus Pomodoro cycle state machine transitions (focus -> shortBreak / longBreak -> focus)
check('resolveNextPhase handles short break, long break intervals and auto-start flags', () => {
  const prefs = { ...DEFAULT_FOCUS_PREFERENCES, longBreakInterval: 4, autoStartBreak: true, autoStartFocus: false };
  const r1 = resolveNextPhase('focus', 0, prefs);
  assert.equal(r1.nextMode, 'shortBreak');
  assert.equal(r1.nextRoundsInCycle, 1);
  assert.equal(r1.shouldAutoStart, true);

  const r4 = resolveNextPhase('focus', 3, prefs);
  assert.equal(r4.nextMode, 'longBreak');
  assert.equal(r4.nextRoundsInCycle, 0);
  assert.equal(r4.durationMinutes, 15);

  const backToFocus = resolveNextPhase('longBreak', 0, prefs);
  assert.equal(backToFocus.nextMode, 'focus');
  assert.equal(backToFocus.shouldAutoStart, false);
});

// 39. Focus session serialization, legacy migration & wall-clock calculation
check('focus active session persists and handles legacy fields and remaining seconds', () => {
  clearFocusSession();
  const legacySanitized = sanitizeFocusSession({ isBreak: true, secondsLeft: 240, isRunning: false });
  assert.equal(legacySanitized.mode, 'shortBreak');
  assert.equal(legacySanitized.secondsLeft, 240);

  const now = 1_700_000_000_000;
  assert.equal(computeRemainingSeconds(now + 125_200, now), 126);
  assert.equal(computeRemainingSeconds(now - 5000, now), 0);

  saveFocusSession({
    reminderId: 'rem-42',
    reminderTitle: '架构评审',
    mode: 'focus',
    durationMinutes: 45,
    phaseTotalSeconds: 2700,
    secondsLeft: 1800,
    isRunning: true,
    endAt: now + 1800_000,
    startedAt: now - 900_000,
    completedRoundsInCycle: 2,
    intention: '写完核心状态机',
    distractions: 1,
    updatedAt: now,
  });
  const loaded = loadFocusSession();
  assert.ok(loaded);
  assert.equal(loaded?.reminderId, 'rem-42');
  assert.equal(loaded?.completedRoundsInCycle, 2);
  assert.equal(loaded?.distractions, 1);
  clearFocusSession();
  assert.equal(loadFocusSession(), null);
});

// 40. Focus history, consecutive day streak, weekly trend & stats overview
check('focus history computes today metrics, streak days and 7-day trend', () => {
  const ref = new Date('2026-11-16T10:00:00');
  clearFocusHistory(ref);
  localStorage.removeItem(`agenda_focus_daily_${formatFocusDateKey(ref)}`);

  const y1 = new Date('2026-11-15T09:00:00');
  const y2 = new Date('2026-11-14T15:00:00');
  recordFocusHistoryEntry({ mode: 'focus', durationMinutes: 25, reminderId: 'r1', reminderTitle: '昨日任务', now: y1 });
  recordFocusHistoryEntry({ mode: 'focus', durationMinutes: 50, reminderId: 'r2', reminderTitle: '前日任务', now: y2 });
  recordFocusHistoryEntry({ mode: 'shortBreak', durationMinutes: 5, now: ref });
  recordFocusHistoryEntry({ mode: 'focus', durationMinutes: 25, reminderId: 'r3', reminderTitle: '今日突破', distractions: 2, now: ref });

  const entries = loadFocusHistory();
  assert.equal(entries.length, 4);
  const dailyMap = aggregateDailyFocusMap(entries, ref, 0);
  assert.equal(calculateFocusStreak(dailyMap, ref), 3);

  const trend = buildWeeklyFocusTrend(dailyMap, ref);
  assert.equal(trend.length, 7);
  assert.equal(trend[6].minutes, 25);
  assert.equal(trend[6].label, '今日');

  const overview = getFocusStatsOverview(ref);
  assert.equal(overview.todayMinutes, 25);
  assert.equal(overview.todaySessions, 1);
  assert.equal(overview.totalMinutes, 100);
  assert.equal(overview.streakDays, 3);
  clearFocusHistory(ref);
});

// 41. Ambient soundscape catalog & focus audio safe helpers in non-DOM environment
check('ambient sound catalog and focus chimes handle non-DOM runtime cleanly', () => {
  assert.ok(AMBIENT_SOUND_OPTIONS.some((o) => o.id === 'forest'));
  assert.ok(AMBIENT_SOUND_OPTIONS.some((o) => o.id === 'fireplace'));
  assert.doesNotThrow(() => {
    playFocusStartSound();
    playFocusTickSound();
    playFocusCompleteChime('focus');
    playFocusCompleteChime('shortBreak');
    startAmbientSound('forest', 0.3);
    setAmbientVolume(0.5);
    stopAmbientSound();
  });
});

// 42. Theme-synchronized focus aura, FX styles, and ambient recommendations
check('focus theme aura maps every curated & shanshui theme to matching FX and ambient sound', () => {
  const jiangnan = getFocusThemeAura('shanshui-jiangnan');
  assert.equal(jiangnan.isShanshui, true);
  assert.equal(jiangnan.isLight, true);
  assert.equal(jiangnan.effectStyle, 'ripple');
  assert.equal(jiangnan.recommendedAmbient, 'rain');

  const qingcheng = getFocusThemeAura('shanshui-qingcheng');
  assert.equal(qingcheng.effectStyle, 'bamboo');
  assert.equal(qingcheng.recommendedAmbient, 'forest');

  const dunhuang = getFocusThemeAura('shanshui-dunhuang');
  assert.equal(dunhuang.effectStyle, 'embers');
  assert.equal(dunhuang.recommendedAmbient, 'fireplace');

  const xihu = getFocusThemeAura('shanshui-xihu');
  assert.equal(xihu.effectStyle, 'petal');
  const changbai = getFocusThemeAura('shanshui-changbai');
  assert.equal(changbai.effectStyle, 'snow');
  const guilin = getFocusThemeAura('shanshui-guilin');
  assert.equal(guilin.effectStyle, 'firefly');
  const aurora = getFocusThemeAura('aurora');
  assert.equal(aurora.effectStyle, 'starfield');
  const jiuzhaigou = getFocusThemeAura('shanshui-jiuzhaigou');
  assert.equal(jiuzhaigou.effectStyle, 'spectrum');
  const emei = getFocusThemeAura('shanshui-emei');
  assert.equal(emei.effectStyle, 'nebula');

  const customOverride = getFocusThemeAura('shanshui-xihu', 'starfield', 'bagua');
  assert.equal(customOverride.effectStyle, 'starfield');
  assert.equal(customOverride.dialHudStyle, 'bagua');

  assert.equal(getDialHudStyleForTheme('cyber'), 'cyber');
  assert.equal(getDialHudStyleForTheme('midnight'), 'radar');
  assert.equal(getDialHudStyleForTheme('aurora'), 'gyro');
  assert.equal(getDialHudStyleForTheme('daylight'), 'chronograph');
  assert.equal(getDialHudStyleForTheme('shanshui-jiangshan'), 'bagua');

  const cyber = getFocusEffectStyleForTheme('cyber');
  assert.equal(cyber.style, 'matrix');
  assert.equal(getRecommendedAmbientForTheme('midnight'), 'alpha');

  const prefs = saveFocusPreferences({ fxEnabled: false, fxStyleOverride: 'petal', dialHudOverride: 'radar', viewForm: 'hourglass', ambientFollowTheme: true });
  assert.equal(prefs.fxEnabled, false);
  assert.equal(prefs.fxStyleOverride, 'petal');
  assert.equal(prefs.dialHudOverride, 'radar');
  assert.equal(prefs.viewForm, 'hourglass');
  assert.equal(FOCUS_VIEW_FORMS.length, 5);
  assert.equal(prefs.ambientFollowTheme, true);
  const legacyConverted = sanitizeFocusPreferences({ viewForm: 'horizon' });
  assert.equal(legacyConverted.viewForm, 'lotus');
  const legacyMatrix = sanitizeFocusPreferences({ viewForm: 'matrix' });
  assert.equal(legacyMatrix.viewForm, 'lotus');
  assert.equal(FOCUS_VIEW_FORMS.some((v) => v.id === 'lotus'), true);
  assert.equal(FOCUS_VIEW_FORMS.some((v) => v.id === 'horizon'), false);
  assert.equal(FOCUS_VIEW_FORMS.some((v) => v.id === 'matrix'), false);
  const reset = resetFocusPreferences();
  assert.equal(reset.fxEnabled, true);
  assert.equal(reset.fxStyleOverride, 'auto');
  assert.equal(reset.dialHudOverride, 'auto');
  assert.equal(reset.viewForm, 'dial');
  assert.equal(reset.ambientFollowTheme, false);
});

// 43. Per-task focus telemetry, mode breakdown, entry deletion & breathing cues
check('focus telemetry aggregates per-task totals, breakdown, deletion, breathing and markdown export', () => {
  const ref = new Date('2026-11-16T12:30:00');
  clearFocusHistory(ref);

  const e1 = recordFocusHistoryEntry({ mode: 'focus', durationMinutes: 25, reminderId: 'task-a', reminderTitle: '撰写设计文档', distractions: 0, now: ref });
  recordFocusHistoryEntry({ mode: 'focus', durationMinutes: 25, reminderId: 'task-a', reminderTitle: '撰写设计文档', distractions: 1, now: ref });
  recordFocusHistoryEntry({ mode: 'shortBreak', durationMinutes: 5, now: ref });

  const taskSummary = getReminderFocusSummary('task-a');
  assert.ok(taskSummary);
  assert.equal(taskSummary?.totalMinutes, 50);
  assert.equal(taskSummary?.sessions, 2);
  assert.equal(buildReminderFocusMap().size, 1);

  const breakdown = getFocusModeBreakdown();
  assert.equal(breakdown.focusSessions, 2);
  assert.equal(breakdown.breakSessions, 1);
  assert.equal(breakdown.zeroDistractionPercent, 50);

  const md = exportFocusHistoryMarkdown(ref);
  assert.ok(md.includes('撰写设计文档'));
  assert.ok(md.includes('零分心率 50%'));

  assert.equal(tagFocusHistoryEntryMood(e1.id, 'flow'), true);
  assert.equal(tagFocusHistoryEntryMood('missing-id', 'steady'), false);
  const mdWithMood = exportFocusHistoryMarkdown(ref);
  assert.ok(mdWithMood.includes('深度心流'));

  assert.equal(getBreathingCue(1).step, '吸气');
  assert.equal(getBreathingCue(5).step, '屏息');
  assert.equal(getBreathingCue(9).step, '呼气');
  assert.equal(getBreathingCue(13).step, '调息');

  assert.equal(deleteFocusHistoryEntry(e1.id), true);
  assert.equal(getReminderFocusSummary('task-a')?.totalMinutes, 25);
  assert.equal(getFocusStatsOverview(ref).todayMinutes, 25);
  clearFocusHistory(ref);
});

// 44. Search highlighting entity safety, malformed date guards, and NLP decimal/version immunity
check('highlightMatch preserves HTML entities and format helpers guard invalid dates', () => {
  const highlightedAmp = highlightMatch('A & B <tag>', 'amp');
  assert.equal(highlightedAmp, 'A &amp; B &lt;tag&gt;');
  assert.ok(!highlightedAmp.includes('<mark'));

  const highlightedMatch = highlightMatch('A & B sync', 'B');
  assert.equal(highlightedMatch, 'A &amp; <mark class="search-highlight">B</mark> sync');

  assert.equal(formatTime('not-a-date'), '--:--');
  assert.equal(formatDateLabel('not-a-date').label, '');
  assert.equal(formatRelativeTime('not-a-date'), '');
  assert.equal(getCountdownBadge('not-a-date').showBadge, false);
});

check('nlp ignores version numbers and decimals while preserving valid calendar dates', () => {
  const ref = new Date('2026-11-16T10:00:00');
  const ver = parseNaturalReminder('明天 14:00 发布 v1.2.3 版本', ref);
  const verDate = new Date(ver.scheduledAt);
  assert.equal(verDate.getFullYear(), 2026);
  assert.equal(verDate.getMonth(), 10); // November
  assert.equal(verDate.getDate(), 17);
  assert.ok(ver.title.includes('v1.2.3'));

  const pi = parseNaturalReminder('明天 15:00 核对 3.14 报表', ref);
  const piDate = new Date(pi.scheduledAt);
  assert.equal(piDate.getMonth(), 10);
  assert.equal(piDate.getDate(), 17);

  const slashDate = parseNaturalReminder('12/25 10:00 圣诞活动', ref);
  const slashParsed = new Date(slashDate.scheduledAt);
  assert.equal(slashParsed.getMonth(), 11);
  assert.equal(slashParsed.getDate(), 25);
});

// 46. Shanshui 24 solar terms cache & lookup
check('shanshui computes 24 cached solar terms per year and finds nearest transitions', () => {
  const terms2026 = getAllSolarTerms(2026);
  const terms2026Cached = getAllSolarTerms(2026);
  const terms2027 = getAllSolarTerms(2027);
  assert.equal(terms2026.length, 24);
  assert.equal(terms2027.length, 24);
  assert.deepEqual(terms2026, terms2026Cached);

  const springBegin = terms2026.find((t) => t.name === '立春');
  assert.ok(springBegin);
  const matched = getSolarTermOnDate(new Date(springBegin.dateKey + 'T12:00:00'));
  assert.equal(matched?.name, '立春');
  assert.equal(getSolarTermOnDate(new Date('invalid-date')), null);

  const next = getNextSolarTerm(new Date('2026-11-16T09:00:00'));
  assert.ok(next.term.name.length > 0);
  assert.ok(next.daysRemaining >= 0 && next.daysRemaining <= 20);
});

// 47. Theme registry integrity & domain reminder normalization
check('validateThemeDefinitions passes and domain helpers normalize tags, subtasks and patches', () => {
  const validation = validateThemeDefinitions();
  assert.equal(validation.valid, true, validation.errors.join('; '));

  assert.deepEqual(parseReminderTags('#工作，会议, 工作 紧急'), ['工作', '会议', '紧急']);
  assert.deepEqual(parseReminderSubtasks('not-json'), []);
  assert.deepEqual(
    parseReminderSubtasks(JSON.stringify([{ title: '整理纪要', completed: true }, { title: '   ' }])),
    [{ id: 'subtask-0', title: '整理纪要', done: true }],
  );

  const req = toUpdateReminderRequest(
    {
      id: 'rem-1',
      title: '周会',
      scheduled_at: '2026-11-17T09:00:00Z',
      repeat_rule: '',
      lead_minutes: 10,
      notes: '讨论路线图',
      duration_minutes: 30,
      timezone: 'Asia/Shanghai',
      prompt: '',
      status: 'active',
      priority: 'p1',
      tags: '工作',
      subtasks: '[]',
      is_pinned: false,
      created_at: '',
      updated_at: '',
    },
    { status: 'ended', is_pinned: true },
  );
  assert.equal(req.id, 'rem-1');
  assert.equal(req.status, 'ended');
  assert.equal(req.is_pinned, true);
  assert.equal(sanitizeHTML('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

// 48. Schedule conflict & daily density calculation
check('conflict detector catches overlapping active reminders while ignoring paused/ended items', () => {
  const items = [
    { id: '1', title: '晨会', scheduled_at: '2026-11-16T09:00:00', duration_minutes: 60, status: 'active' },
    { id: '2', title: '已完成冲突项', scheduled_at: '2026-11-16T09:15:00', duration_minutes: 30, status: 'ended' },
    { id: '3', title: '一对一', scheduled_at: '2026-11-16T09:30:00', duration_minutes: 30, status: 'active' },
  ];
  const density = calculateScheduleDensity('2026-11-16', items);
  assert.equal(density.conflictsCount, 1);
  assert.equal(density.totalBusyMinutes, 90);
});

// 49. Regenerated Focus Audio Synthesis Engine (chimes, ticks, stereo buffers & preview lifecycle)
check('regenerated focus audio engine synthesizes stereo buffers, cues and profiles cleanly', () => {
  const createdBuffers = [];
  const createdNodes = [];

  class MockAudioParam {
    constructor(initial = 0) {
      this.value = initial;
    }
    setValueAtTime(v) {
      assert.ok(Number.isFinite(v), 'AudioParam value must be finite');
      this.value = v;
    }
    linearRampToValueAtTime(v) {
      assert.ok(Number.isFinite(v), 'linearRamp value must be finite');
      this.value = v;
    }
    exponentialRampToValueAtTime(v) {
      assert.ok(Number.isFinite(v) && v > 0, `exponentialRamp target must be > 0, got ${v}`);
      this.value = v;
    }
    setTargetAtTime(v) {
      assert.ok(Number.isFinite(v), 'setTarget value must be finite');
      this.value = v;
    }
    cancelScheduledValues() {}
  }

  class MockNode {
    constructor(kind) {
      this.kind = kind;
      createdNodes.push(this);
    }
    connect(dest) {
      return dest;
    }
    disconnect() {}
    start() {}
    stop() {}
  }

  class MockAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.currentTime = 1.0;
      this.state = 'running';
      this.destination = new MockNode('destination');
    }
    resume() {
      return Promise.resolve();
    }
    createGain() {
      const n = new MockNode('gain');
      n.gain = new MockAudioParam(1);
      return n;
    }
    createOscillator() {
      const n = new MockNode('oscillator');
      n.type = 'sine';
      n.frequency = new MockAudioParam(440);
      return n;
    }
    createBiquadFilter() {
      const n = new MockNode('biquad');
      n.type = 'lowpass';
      n.frequency = new MockAudioParam(1000);
      n.Q = new MockAudioParam(1);
      n.gain = new MockAudioParam(0);
      return n;
    }
    createStereoPanner() {
      const n = new MockNode('panner');
      n.pan = new MockAudioParam(0);
      return n;
    }
    createDynamicsCompressor() {
      const n = new MockNode('compressor');
      n.threshold = new MockAudioParam(-14);
      n.knee = new MockAudioParam(16);
      n.ratio = new MockAudioParam(3.5);
      n.attack = new MockAudioParam(0.004);
      n.release = new MockAudioParam(0.18);
      return n;
    }
    createBuffer(channels, length, sampleRate) {
      const channelArrays = Array.from({ length: channels }, () => new Float32Array(length));
      const buf = {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData(ch) {
          return channelArrays[ch];
        },
      };
      createdBuffers.push(buf);
      return buf;
    }
    createBufferSource() {
      const n = new MockNode('bufferSource');
      n.buffer = null;
      n.loop = false;
      n.playbackRate = new MockAudioParam(1);
      return n;
    }
  }

  const prevWindow = globalThis.window;
  globalThis.window = { AudioContext: MockAudioContext };

  try {
    setSoundVolume(0.32);

    // Test lifecycle cues
    playFocusStartSound('focus');
    playFocusStartSound('shortBreak');
    playFocusPauseSound();
    playFocusTickSound(0);
    playFocusTickSound(1);
    playFocusDistractionSound();

    // Test every sound profile for focus and break completion chimes
    for (const profile of ['crystal', 'zen', 'guqin', 'qing', 'droplet', 'cyber']) {
      setSoundProfile(profile);
      playFocusCompleteChime('focus');
      playFocusCompleteChime('longBreak');
    }

    // Test all ambient soundscapes, stereo buffers, preview & stop lifecycle
    for (const opt of AMBIENT_SOUND_OPTIONS) {
      if (opt.id === 'none') continue;
      startAmbientSound(opt.id, 0.35);
      assert.equal(getActiveAmbientSound(), opt.id);
      assert.equal(isAmbientPreviewActive(), false);
      setAmbientVolume(0.5);
    }

    previewAmbientSound('stream', 0.3, 1500);
    assert.equal(getActiveAmbientSound(), 'stream');
    assert.equal(isAmbientPreviewActive(), true);
    stopAmbientPreviewIfIdle();
    assert.equal(getActiveAmbientSound(), 'none');
    assert.equal(isAmbientPreviewActive(), false);

    stopAmbientSound();

    // Verify stereo buffers were generated cleanly with finite bounded samples
    const longBuffers = createdBuffers.filter((b) => b.length >= 48000);
    assert.ok(longBuffers.length >= 4, 'expected stereo ambient noise buffers to be created');
    for (const buf of longBuffers) {
      assert.equal(buf.numberOfChannels, 2);
      const left = buf.getChannelData(0);
      const right = buf.getChannelData(1);
      assert.notEqual(left[100], right[100]); // decorrelated stereo channels
      for (let i = 0; i < buf.length; i += 997) {
        assert.ok(Number.isFinite(left[i]) && Math.abs(left[i]) <= 1);
        assert.ok(Number.isFinite(right[i]) && Math.abs(right[i]) <= 1);
      }
    }
    assert.ok(createdNodes.some((n) => n.kind === 'panner'), 'expected stereo panning nodes');
    assert.ok(createdNodes.some((n) => n.kind === 'compressor'), 'expected soft chime compressor');
  } finally {
    stopAmbientSound();
    if (prevWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = prevWindow;
    }
  }
});

console.log(`✅ All ${passed} desktop utility unit tests passed!`);
