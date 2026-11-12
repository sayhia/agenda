import assert from 'node:assert/strict';
import {
  formatPanguText,
  parseNaturalReminder,
} from '../src/utils/nlp.ts';
import { checkTimeConflict } from '../src/utils/conflict.ts';
import { escapeHTML, sanitizeHTML } from '../src/utils/sanitize.ts';
import { getTagColor } from '../src/utils/tagColors.ts';
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

console.log(`✅ All ${passed} desktop utility unit tests passed!`);
