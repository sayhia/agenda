import type { Reminder, UpdateReminderRequest } from '../../bindings/agenda/internal/agenda/models';

export type ReminderStatus = 'active' | 'paused' | 'ended';
export type ReminderPriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export function parseReminderTags(value?: string): string[] {
  if (!value) return [];
  return Array.from(new Set(value
    .split(/[,，\s]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean)));
}

export function parseReminderSubtasks(value?: string): Subtask[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, index) => ({
        id: typeof item.id === 'string' && item.id ? item.id : `subtask-${index}`,
        title: typeof item.title === 'string' ? item.title : '',
        done: item.done === true || item.completed === true,
      }))
      .filter((item) => item.title.trim());
  } catch {
    return [];
  }
}

/** Keeps generated Wails DTO details out of UI event handlers. */
export function toUpdateReminderRequest(
  reminder: Reminder,
  patch: Partial<Omit<UpdateReminderRequest, 'id'>> = {},
): UpdateReminderRequest {
  return {
    id: reminder.id,
    title: reminder.title,
    scheduled_at: reminder.scheduled_at,
    repeat_rule: reminder.repeat_rule || '',
    lead_minutes: reminder.lead_minutes || 0,
    notes: reminder.notes || '',
    duration_minutes: reminder.duration_minutes || 30,
    timezone: reminder.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    prompt: reminder.prompt || '',
    status: reminder.status || 'active',
    priority: reminder.priority || 'p2',
    tags: reminder.tags || '',
    subtasks: reminder.subtasks || '',
    is_pinned: Boolean(reminder.is_pinned),
    ...patch,
  };
}
