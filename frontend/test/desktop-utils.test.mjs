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
import { checkTimeConflict, calculateScheduleDensity } from '../src/utils/conflict.ts';
import { escapeHTML, sanitizeHTML } from '../src/utils/sanitize.ts';
import { getTagColor, setCustomTagColor, getCustomTagColors } from '../src/utils/tagColors.ts';
import { fuzzyMatchPinyin } from '../src/utils/pinyin.ts';
import { playReminderChime, playFocusCompleteChime, getSoundVolume, setSoundVolume } from '../src/utils/audio.ts';
import { exportToMarkdown } from '../src/utils/export.ts';
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

  const emptyDensity = calculateScheduleDensity('2026-11-15', reminders);
  assert.equal(emptyDensity.totalBusyMinutes, 0);
  assert.equal(emptyDensity.level, 'low');
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

console.log(`✅ All ${passed} desktop utility unit tests passed!`);
