import type { Reminder } from '../../bindings/agenda/internal/agenda/models';

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

  // Suggest time right after the latest conflicting event + 5 min buffer,
  // and iteratively cascade past any subsequent back-to-back active reminders.
  let candidateStart = maxEndTime + 5 * 60 * 1000;
  for (let step = 0; step < 15; step++) {
    const candidateEnd = candidateStart + durMs;
    let nextMaxEnd = 0;
    for (const r of reminders) {
      if (r.id === excludeId || r.status !== 'active') continue;
      const rStart = new Date(r.scheduled_at).getTime();
      if (isNaN(rStart)) continue;
      const rDurMs = (r.duration_minutes > 0 ? r.duration_minutes : 30) * 60 * 1000;
      const rEnd = rStart + rDurMs;
      if (candidateStart < rEnd && rStart < candidateEnd) {
        if (rEnd > nextMaxEnd) nextMaxEnd = rEnd;
      }
    }
    if (nextMaxEnd > 0) {
      candidateStart = nextMaxEnd + 5 * 60 * 1000;
    } else {
      break;
    }
  }

  const suggestedDate = new Date(candidateStart);
  const pad = (n: number) => String(n).padStart(2, '0');
  const suggestedTimeLabel = `${pad(suggestedDate.getHours())}:${pad(suggestedDate.getMinutes())}`;

  return {
    hasConflict: true,
    conflicts,
    suggestedTime: suggestedDate.toISOString(),
    suggestedTimeLabel,
  };
}

export interface DayDensityInfo {
  totalBusyMinutes: number;
  densityPct: number;
  level: 'low' | 'medium' | 'high' | 'full';
  conflictsCount: number;
}

/**
 * Calculates calendar workload density for a given date string (YYYY-MM-DD).
 * Reference standard working day: 09:00 - 19:00 (10 hours = 600 minutes).
 */
export function calculateScheduleDensity(
  dateStr: string,
  reminders: Reminder[]
): DayDensityInfo {
  if (!dateStr) {
    return { totalBusyMinutes: 0, densityPct: 0, level: 'low', conflictsCount: 0 };
  }

  let totalBusyMinutes = 0;
  const intervals: Array<{ start: number; end: number }> = [];

  for (const r of reminders) {
    if (r.status !== 'active' || !r.scheduled_at) continue;
    const parsed = new Date(r.scheduled_at);
    const localKey = !isNaN(parsed.getTime())
      ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
      : '';
    if (localKey !== dateStr && !r.scheduled_at.startsWith(dateStr)) continue;

    const dur = r.duration_minutes > 0 ? r.duration_minutes : 30;
    totalBusyMinutes += dur;
    if (!isNaN(parsed.getTime())) {
      const start = parsed.getTime();
      intervals.push({ start, end: start + dur * 60 * 1000 });
    }
  }

  let conflictsCount = 0;
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (intervals[i].start < intervals[j].end && intervals[j].start < intervals[i].end) {
        conflictsCount++;
      }
    }
  }

  const standardWorkDayMinutes = 600; // 10 hours
  const densityPct = Math.min(100, Math.round((totalBusyMinutes / standardWorkDayMinutes) * 100));

  let level: 'low' | 'medium' | 'high' | 'full' = 'low';
  if (densityPct >= 85) level = 'full';
  else if (densityPct >= 50) level = 'high';
  else if (densityPct >= 25) level = 'medium';

  return {
    totalBusyMinutes,
    densityPct,
    level,
    conflictsCount,
  };
}
