import type { Reminder } from '../../bindings/agenda-desktop/models';

export interface ConflictResult {
  hasConflict: boolean;
  conflicts: Reminder[];
  suggestedTime?: string;
  suggestedTimeLabel?: string;
}

/**
 * Checks if the proposed time interval [start, start + duration] overlaps
 * with any existing active reminders.
 */
export function checkTimeConflict(
  scheduledAt: string,
  durationMinutes: number,
  reminders: Reminder[],
  excludeId?: string
): ConflictResult {
  if (!scheduledAt) {
    return { hasConflict: false, conflicts: [] };
  }

  const start = new Date(scheduledAt).getTime();
  if (isNaN(start)) {
    return { hasConflict: false, conflicts: [] };
  }

  const durMs = (durationMinutes > 0 ? durationMinutes : 30) * 60 * 1000;
  const end = start + durMs;

  const conflicts: Reminder[] = [];
  let maxEndTime = end;

  for (const r of reminders) {
    if (r.id === excludeId || r.status !== 'active') continue;

    const rStart = new Date(r.scheduled_at).getTime();
    if (isNaN(rStart)) continue;

    const rDurMs = (r.duration_minutes > 0 ? r.duration_minutes : 30) * 60 * 1000;
    const rEnd = rStart + rDurMs;

    // Interval overlap condition: start < rEnd && rStart < end
    if (start < rEnd && rStart < end) {
      conflicts.push(r);
      if (rEnd > maxEndTime) {
        maxEndTime = rEnd;
      }
    }
  }

  if (conflicts.length === 0) {
    return { hasConflict: false, conflicts: [] };
  }

  // Suggest time right after the latest conflicting event + 5 min buffer
  const suggestedDate = new Date(maxEndTime + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const suggestedTimeLabel = `${pad(suggestedDate.getHours())}:${pad(suggestedDate.getMinutes())}`;

  return {
    hasConflict: true,
    conflicts,
    suggestedTime: suggestedDate.toISOString(),
    suggestedTimeLabel,
  };
}
