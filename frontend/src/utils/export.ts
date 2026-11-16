import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime, formatDateLabel, formatRepeatLabel } from './format.ts';

/**
 * Exports current reminders into an elegant, formatted Markdown Planner document.
 */
export function exportToMarkdown(reminders: Reminder[]): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let md = `# 📅 日程管家 · 个人日程清单 (${dateStr})\n\n`;
  md += `> 导出时间：${now.toLocaleString('zh-CN')} · 共 ${reminders.length} 项日程\n\n`;

  const active = reminders.filter((r) => r.status === 'active');
  const expired = reminders.filter((r) => r.status === 'expired');
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
      const tags = r.tags ? ` #${r.tags.split(',').map((s) => s.trim()).filter(Boolean).join(' #')}` : '';
      const rep = r.repeat_rule ? ` (🔄 ${formatRepeatLabel(r.repeat_rule)})` : '';
      const pinPrefix = r.is_pinned ? '📌 ' : '';
      md += `- [ ] **${t}** (${d.label}) ${pinPrefix}**${r.title}**${pri}${rep}${tags}\n`;
      if (r.notes) {
        const noteLines = r.notes.split(/\r?\n/).map((line, i) => (i === 0 ? `  > 备注: ${line}` : `  > ${line}`));
        md += `${noteLines.join('\n')}\n`;
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

  if (expired.length > 0) {
    md += `## ⏰ 已过期 (${expired.length})\n\n`;
    for (const r of expired) {
      md += `- [ ] **${r.title}** (${formatDateLabel(r.scheduled_at).label} ${formatTime(r.scheduled_at)} · 已过期)\n`;
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
  const headers = ['ID', '标题', '提醒时间', '状态', '优先级', '重复规则', '提前提醒(分)', '持续时长(分)', '标签', '备注', '子任务', '是否置顶'];
  const rows: string[][] = [];

  for (const r of reminders) {
    rows.push([
      r.id,
      r.title,
      r.scheduled_at,
      r.status,
      r.priority || 'p2',
      r.repeat_rule || '',
      String(r.lead_minutes || 0),
      String(r.duration_minutes || 30),
      r.tags || '',
      (r.notes || '').replace(/[\r\n]+/g, ' '),
      (r.subtasks || '').replace(/[\r\n]+/g, ' '),
      r.is_pinned ? '是' : '否',
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
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copies formatted Markdown tasks to system clipboard.
 */
export async function copyMarkdownToClipboard(reminders: Reminder[]): Promise<boolean> {
  const md = exportToMarkdown(reminders);
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(md);
      return true;
    }
  } catch {}
  return false;
}
