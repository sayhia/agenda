import type { Reminder } from '../../bindings/agenda-desktop/models';
import { formatTime, formatDateLabel, formatRepeatLabel } from './format';

/**
 * Exports current reminders into an elegant, formatted Markdown Planner document.
 */
export function exportToMarkdown(reminders: Reminder[]): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let md = `# 📅 日程管家 · 个人日程清单 (${dateStr})\n\n`;
  md += `> 导出时间：${now.toLocaleString('zh-CN')} · 共 ${reminders.length} 项日程\n\n`;

  const active = reminders.filter((r) => r.status === 'active');
  const paused = reminders.filter((r) => r.status === 'paused');
  const ended = reminders.filter((r) => r.status === 'ended');

  md += `## ⏳ 待办排期 (${active.length})\n\n`;
  if (active.length === 0) {
    md += `*暂无待办日程*\n\n`;
  } else {
    for (const r of active) {
      const d = formatDateLabel(r.scheduled_at);
      const t = formatTime(r.scheduled_at);
      const pri = r.priority ? ` \`[${r.priority.toUpperCase()}]\`` : '';
      const tags = r.tags ? ` #${r.tags.split(',').join(' #')}` : '';
      const rep = r.repeat_rule ? ` (🔄 ${formatRepeatLabel(r.repeat_rule)})` : '';
      md += `- [ ] **${t}** (${d.label}) **${r.title}**${pri}${rep}${tags}\n`;
      if (r.notes) {
        md += `  > 备注: ${r.notes}\n`;
      }
      if (r.subtasks) {
        try {
          const subs = JSON.parse(r.subtasks);
          for (const s of subs) {
            md += `  - [${s.done ? 'x' : ' '}] ${s.title}\n`;
          }
        } catch {}
      }
    }
    md += `\n`;
  }

  if (paused.length > 0) {
    md += `## ⏸ 已暂停 (${paused.length})\n\n`;
    for (const r of paused) {
      md += `- [ ] ~~${r.title}~~ (暂停中)\n`;
    }
    md += `\n`;
  }

  if (ended.length > 0) {
    md += `## ✅ 已完成 / 已结束 (${ended.length})\n\n`;
    for (const r of ended) {
      md += `- [x] ~~${r.title}~~ (${formatDateLabel(r.scheduled_at).label} ${formatTime(r.scheduled_at)})\n`;
    }
    md += `\n`;
  }

  return md;
}

/**
 * Exports reminders as Excel-compatible CSV with UTF-8 BOM.
 */
export function exportToCSV(reminders: Reminder[]): string {
  const headers = ['ID', '标题', '提醒时间', '状态', '优先级', '重复规则', '提前提醒(分)', '持续时长(分)', '标签', '备注', '子任务'];
  const rows: string[][] = [];

  for (const r of reminders) {
    rows.push([
      r.id,
      r.title,
      r.scheduled_at,
      r.status,
      r.priority || 'p2',
      r.repeat_rule || '无',
      String(r.lead_minutes || 0),
      String(r.duration_minutes || 30),
      r.tags || '',
      (r.notes || '').replace(/[\r\n]+/g, ' '),
      (r.subtasks || '').replace(/[\r\n]+/g, ' '),
    ]);
  }

  const csvContent =
    '\uFEFF' + // UTF-8 BOM for Excel
    [headers.join(','), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\r\n');

  return csvContent;
}

/**
 * Triggers client-side file download.
 */
export function triggerFileDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
