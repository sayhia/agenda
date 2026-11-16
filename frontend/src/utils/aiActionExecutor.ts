import {
  AddReminder,
  BatchSetStatus,
  DeleteReminder,
  SnoozeReminder,
  UpdateReminder,
} from '../../bindings/agenda/internal/agenda/agendaservice';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';

export function findReminderForAIAction(reminders: Reminder[], action: any): Reminder | null {
  const id = action.id || action.reminder_id || action.reminderID;
  if (id) {
    return reminders.find((r) => r.id === id) || null;
  }
  const title = String(action.reminder_title || action.title || '').trim().toLowerCase();
  if (!title) return null;
  return reminders.find((r) => r.title.trim().toLowerCase() === title) || null;
}

export async function executeAIAction(
  action: any,
  reminders: Reminder[],
  onAfterMutate?: () => Promise<void> | void,
): Promise<string | null> {
  const actionType = String(action.action || 'create').toLowerCase();

  if (actionType === 'create_batch' && Array.isArray(action.items)) {
    let count = 0;
    for (const item of action.items) {
      await AddReminder({
        title: item.title,
        scheduled_at: item.scheduled_at,
        repeat_rule: item.repeat_rule || '',
        lead_minutes: item.lead_minutes || 0,
        duration_minutes: item.duration_minutes || 15,
        notes: item.notes || '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
        prompt: `提醒您：${item.title}`,
        priority: item.priority || 'p2',
        tags: item.tags || '',
        subtasks: item.subtasks || '',
        is_pinned: Boolean(item.is_pinned),
      });
      action.__onItemApplied?.(count);
      count++;
    }
    await onAfterMutate?.();
    action.__onApplied?.();
    return `已通过 AI 智能批量安排 ${count} 项日程`;
  }

  if (actionType === 'delete') {
    const target = findReminderForAIAction(reminders, action);
    if (!target) throw new Error('未找到要删除的日程');
    await DeleteReminder(target.id);
    await onAfterMutate?.();
    action.__onApplied?.();
    return `已删除日程：${target.title}`;
  }

  if (actionType === 'snooze') {
    const target = findReminderForAIAction(reminders, action);
    if (!target) throw new Error('未找到要顺延的日程');
    const mins = Number(action.minutes) || 30;
    await SnoozeReminder(target.id, mins);
    await onAfterMutate?.();
    action.__onApplied?.();
    return `已顺延「${target.title}」 ${mins} 分钟`;
  }

  if (actionType === 'complete' || actionType === 'end') {
    const target = findReminderForAIAction(reminders, action);
    if (!target) throw new Error('未找到要完成的日程');
    await BatchSetStatus([target.id], 'ended');
    await onAfterMutate?.();
    action.__onApplied?.();
    return `已完成日程：${target.title}`;
  }

  if (actionType === 'pause' || actionType === 'resume') {
    const target = findReminderForAIAction(reminders, action);
    if (!target) throw new Error('未找到要更新状态的日程');
    await BatchSetStatus([target.id], actionType === 'pause' ? 'paused' : 'active');
    await onAfterMutate?.();
    action.__onApplied?.();
    return actionType === 'pause' ? `已暂停：${target.title}` : `已恢复：${target.title}`;
  }

  if (actionType === 'update') {
    const target = findReminderForAIAction(reminders, action);
    if (!target) throw new Error('未找到要修改的日程');
    await UpdateReminder({
      id: target.id,
      title: action.title || target.title,
      scheduled_at: action.scheduled_at || target.scheduled_at,
      repeat_rule: action.repeat_rule ?? target.repeat_rule,
      lead_minutes: action.lead_minutes ?? target.lead_minutes,
      duration_minutes: action.duration_minutes ?? target.duration_minutes,
      notes: action.notes ?? target.notes,
      timezone: action.timezone || target.timezone,
      prompt: action.prompt ?? target.prompt,
      status: action.status || target.status,
      priority: action.priority || target.priority || 'p2',
      tags: action.tags ?? target.tags,
      subtasks: action.subtasks ?? target.subtasks,
      is_pinned: action.is_pinned ?? target.is_pinned,
    });
    await onAfterMutate?.();
    action.__onApplied?.();
    return `已更新日程：${action.title || target.title}`;
  }

  if (actionType === 'create') {
    const created = await AddReminder({
      title: action.title,
      scheduled_at: action.scheduled_at,
      repeat_rule: action.repeat_rule || '',
      lead_minutes: action.lead_minutes || 0,
      duration_minutes: action.duration_minutes || 30,
      notes: action.notes || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      prompt: `提醒您：${action.title}`,
      priority: action.priority || 'p2',
      tags: action.tags || '',
      subtasks: action.subtasks || '',
      is_pinned: Boolean(action.is_pinned),
    });
    if (created) {
      await onAfterMutate?.();
      action.__onApplied?.();
      return `已通过 AI 智能安排日程: ${created.title}`;
    }
  }

  return null;
}
