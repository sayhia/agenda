import assert from 'node:assert/strict';
import { extractActions, parseJsonLenient } from '../src/utils/aiAction.ts';

console.log('Running AI Action extraction tests...');

// 1. Lenient JSON parsing with trailing commas
{
  const valid = parseJsonLenient('{"title": "test", "priority": "p1",}');
  assert.equal(valid.title, 'test');
  assert.equal(valid.priority, 'p1');

  const arrayTrailing = parseJsonLenient('[{"title": "t1"}, {"title": "t2"},]');
  assert.equal(arrayTrailing.length, 2);
}

// 2. Standard ```agenda-action code block
{
  const input = `好的，已为您准备安排：
\`\`\`agenda-action
{"action": "create", "title": "项目周会", "scheduled_at": "2026-11-13T10:00:00+08:00", "priority": "p1"}
\`\`\`
请确认。`;
  const res = extractActions(input);
  assert.equal(res.actions.length, 1);
  assert.equal(res.actions[0].title, '项目周会');
  assert.equal(res.actions[0].priority, 'p1');
  assert.ok(!res.text.includes('```agenda-action'));
  assert.ok(res.text.includes('好的，已为您准备安排：'));
  assert.ok(res.text.includes('请确认。'));
}

// 3. ```json code block with create_batch (The user's real situation)
{
  const input = `好嘞 👌 再帮你批量创建 20 个全新的日程，点下面卡片一键批量入库 👇

\`\`\`json
{"action": "create_batch", "items": [
{"title": "清理待办清单中的僵尸任务", "scheduled_at": "2026-11-12T18:30:00+08:00", "priority": "p2", "tags": "工作,待办", "notes": "删除或归档长期未动的任务。"},
{"title": "梳理项目文档结构", "scheduled_at": "2026-11-13T15:00:00+08:00", "priority": "p1", "tags": "工作,文档", "notes": "整理项目文档目录，提升可读性。"},
{"title": "与协作方对齐需求", "scheduled_at": "2026-11-13T16:30:00+08:00", "priority": "p1", "tags": "工作,沟通", "notes": "确认需求边界与交付标准。"}
]}
\`\`\`

这 20 条都是新内容，随时告诉我 😊`;

  const res = extractActions(input);
  assert.equal(res.actions.length, 3);
  assert.equal(res.actions[0].title, '清理待办清单中的僵尸任务');
  assert.equal(res.actions[1].title, '梳理项目文档结构');
  assert.equal(res.actions[2].title, '与协作方对齐需求');
  assert.ok(!res.text.includes('```json'));
  assert.ok(!res.text.includes('create_batch'));
  assert.ok(res.text.includes('好嘞 👌 再帮你批量创建 20 个全新的日程'));
}

// 4. Bare JSON in plain text without markdown fences
{
  const input = `点下面卡片一键批量入库 👇

{"action": "create_batch", "items": [
{"title": "清理待办清单中的僵尸任务", "scheduled_at": "2026-11-12T18:30:00+08:00", "priority": "p2", "tags": "工作,待办", "notes": "删除或归档长期未动的任务。"},
{"title": "梳理项目文档结构", "scheduled_at": "2026-11-13T15:00:00+08:00", "priority": "p1", "tags": "工作,文档", "notes": "整理项目文档目录，提升可读性。"}
]}

这 20 条都是新内容，随时告诉我 😊`;

  const res = extractActions(input);
  assert.equal(res.actions.length, 2);
  assert.equal(res.actions[0].title, '清理待办清单中的僵尸任务');
  assert.equal(res.actions[1].title, '梳理项目文档结构');
  assert.ok(!res.text.includes('create_batch'));
  assert.ok(res.text.includes('点下面卡片一键批量入库 👇'));
  assert.ok(res.text.includes('这 20 条都是新内容'));
}

// 5. Bare JSON single item
{
  const input = `好的：
{"action": "create", "title": "单项待办", "scheduled_at": "2026-11-14T12:00:00+08:00"}
请点击确认`;
  const res = extractActions(input);
  assert.equal(res.actions.length, 1);
  assert.equal(res.actions[0].title, '单项待办');
  assert.ok(!res.text.includes('单项待办'));
}

// 6. Non-action code blocks preserved
{
  const input = `这是一个普通的 JSON 配置：
\`\`\`json
{
  "name": "my-app",
  "version": "1.0.0"
}
\`\`\`
请勿修改。`;
  const res = extractActions(input);
  assert.equal(res.actions.length, 0);
  assert.ok(res.text.includes('```json'));
  assert.ok(res.text.includes('"version": "1.0.0"'));
}

console.log('✅ All AI Action tests passed successfully!');
