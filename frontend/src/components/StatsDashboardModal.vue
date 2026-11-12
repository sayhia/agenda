<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { Reminder } from '../../bindings/agenda-desktop/internal/agenda/models';
import { GetDatabaseStats, VacuumDatabase } from '../../bindings/agenda-desktop/internal/agenda/agendaservice';
import { handlePointerGlow, resetPointerGlow } from '../utils/pointerGlow';

const props = defineProps<{
  visible: boolean;
  reminders: Reminder[];
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const dbStats = ref<any>(null);
const isVacuuming = ref(false);

async function loadDbStats() {
  try {
    const res = await GetDatabaseStats();
    dbStats.value = res;
  } catch {
    // ignore
  }
}

async function handleVacuum() {
  isVacuuming.value = true;
  try {
    await VacuumDatabase();
    await loadDbStats();
  } catch {
    // ignore
  } finally {
    isVacuuming.value = false;
  }
}

watch(() => props.visible, (v) => {
  if (v) loadDbStats();
});

const total = computed(() => props.reminders.length);
const completedCount = computed(() => props.reminders.filter((r) => r.status === 'ended').length);
const activeCount = computed(() => props.reminders.filter((r) => r.status === 'active').length);
const pausedCount = computed(() => props.reminders.filter((r) => r.status === 'paused').length);

const completionRate = computed(() => {
  if (total.value === 0) return 0;
  return Math.round((completedCount.value / total.value) * 100);
});

// Priority breakdown
const priorityStats = computed(() => {
  const p0 = props.reminders.filter((r) => r.priority === 'p0').length;
  const p1 = props.reminders.filter((r) => r.priority === 'p1').length;
  const p2 = props.reminders.filter((r) => !r.priority || r.priority === 'p2').length;
  const p3 = props.reminders.filter((r) => r.priority === 'p3').length;
  return { p0, p1, p2, p3 };
});

// 28-day activity heatmap
const heatmapDays = computed(() => {
  const list: { dateStr: string; label: string; count: number; level: number }[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Group ended reminders by date
  const counts: Record<string, number> = {};
  for (const r of props.reminders) {
    if (r.status !== 'ended') continue;
    const d = new Date(r.updated_at || r.scheduled_at);
    if (!isNaN(d.getTime())) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const count = counts[key] || 0;
    let level = 0;
    if (count > 0 && count <= 1) level = 1;
    else if (count >= 2 && count <= 3) level = 2;
    else if (count >= 4) level = 3;

    list.push({
      dateStr: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count,
      level,
    });
  }
  return list;
});

// Peak hours distribution
const peakHours = computed(() => {
  let night = 0;     // 00:00 - 06:00
  let morning = 0;   // 06:00 - 12:00
  let noon = 0;      // 12:00 - 14:00
  let afternoon = 0; // 14:00 - 18:00
  let evening = 0;   // 18:00 - 24:00

  for (const r of props.reminders) {
    const d = new Date(r.scheduled_at);
    if (isNaN(d.getTime())) continue;
    const h = d.getHours();
    if (h < 6) night++;
    else if (h < 12) morning++;
    else if (h < 14) noon++;
    else if (h < 18) afternoon++;
    else evening++;
  }

  const maxVal = Math.max(1, night, morning, noon, afternoon, evening);
  return [
    { label: '凌晨 (00-06)', count: night, percent: Math.round((night / maxVal) * 100) },
    { label: '早间 (06-12)', count: morning, percent: Math.round((morning / maxVal) * 100) },
    { label: '午间 (12-14)', count: noon, percent: Math.round((noon / maxVal) * 100) },
    { label: '下午 (14-18)', count: afternoon, percent: Math.round((afternoon / maxVal) * 100) },
    { label: '晚间 (18-24)', count: evening, percent: Math.round((evening / maxVal) * 100) },
  ];
});
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card st-reticle" role="dialog" aria-modal="true" aria-label="数据看板">
      <!-- Head -->
      <div class="modal-head">
        <div class="head-title-row">
          <span class="telemetry-eyebrow">COMMERCE TELEMETRY</span>
          <h3 class="modal-title">生产力与时间洞察看板</h3>
        </div>
        <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
      </div>

      <!-- Overview 4 KPI cards (Scrolltide Dark Wallet / Commerce Analytics) -->
      <div class="kpi-grid">
        <div class="kpi-box st-reticle" @pointermove="handlePointerGlow" @pointerleave="resetPointerGlow">
          <div class="kpi-index">01 · TOTAL</div>
          <div class="kpi-num tabular-nums">{{ total }}</div>
          <div class="kpi-label">全部日程总数</div>
        </div>
        <div class="kpi-box st-reticle highlight-success" @pointermove="handlePointerGlow" @pointerleave="resetPointerGlow">
          <div class="kpi-index">02 · ARCHIVED</div>
          <div class="kpi-num tabular-nums">{{ completedCount }}</div>
          <div class="kpi-label">已完成 / 归档</div>
        </div>
        <div class="kpi-box st-reticle highlight-brand" @pointermove="handlePointerGlow" @pointerleave="resetPointerGlow">
          <div class="kpi-index">03 · QUEUE</div>
          <div class="kpi-num tabular-nums">{{ activeCount }}</div>
          <div class="kpi-label">活跃排期中</div>
        </div>
        <div class="kpi-box st-reticle highlight-rate" @pointermove="handlePointerGlow" @pointerleave="resetPointerGlow">
          <div class="kpi-index">04 · RATIO</div>
          <div class="kpi-num tabular-nums">{{ completionRate }}%</div>
          <div class="kpi-label">总完成达成率</div>
        </div>
      </div>

      <!-- 28 Days Activity Heatmap -->
      <div class="section-card">
        <div class="section-head-row">
          <span class="section-title">近 28 天已完成日程热力图</span>
          <span class="section-tag">ACTIVITY MATRIX</span>
        </div>
        <div class="heatmap-grid">
          <div
            v-for="cell in heatmapDays"
            :key="cell.dateStr"
            class="heatmap-cell"
            :class="'level-' + cell.level"
            :title="`${cell.dateStr}: 完成 ${cell.count} 项`"
          >
            <span class="cell-tip">{{ cell.label }}</span>
          </div>
        </div>
        <div class="heatmap-legend">
          <span>LOW</span>
          <div class="heatmap-cell level-0"></div>
          <div class="heatmap-cell level-1"></div>
          <div class="heatmap-cell level-2"></div>
          <div class="heatmap-cell level-3"></div>
          <span>PEAK</span>
        </div>
      </div>

      <!-- Lower Grid: Priority & Peak Hours -->
      <div class="lower-grid">
        <!-- Priority Breakdown -->
        <div class="section-card">
          <div class="section-title">任务优先级分布</div>
          <div v-if="total > 0" class="priority-split-bar" aria-label="优先级占比分布条">
            <span v-if="priorityStats.p0" class="split-seg p0" :style="{ flex: priorityStats.p0 }" :title="`P0 ${priorityStats.p0}`"></span>
            <span v-if="priorityStats.p1" class="split-seg p1" :style="{ flex: priorityStats.p1 }" :title="`P1 ${priorityStats.p1}`"></span>
            <span v-if="priorityStats.p2" class="split-seg p2" :style="{ flex: priorityStats.p2 }" :title="`P2 ${priorityStats.p2}`"></span>
            <span v-if="priorityStats.p3" class="split-seg p3" :style="{ flex: priorityStats.p3 }" :title="`P3 ${priorityStats.p3}`"></span>
          </div>
          <div class="priority-bars-list">
            <div class="pri-row">
              <span class="pri-tag p0">P0 紧急高危</span>
              <span class="pri-val tabular-nums">{{ priorityStats.p0 }} 项</span>
            </div>
            <div class="pri-row">
              <span class="pri-tag p1">P1 重要事项</span>
              <span class="pri-val tabular-nums">{{ priorityStats.p1 }} 项</span>
            </div>
            <div class="pri-row">
              <span class="pri-tag p2">P2 普通任务</span>
              <span class="pri-val tabular-nums">{{ priorityStats.p2 }} 项</span>
            </div>
            <div class="pri-row">
              <span class="pri-tag p3">P3 低优先级</span>
              <span class="pri-val tabular-nums">{{ priorityStats.p3 }} 项</span>
            </div>
          </div>
        </div>

        <!-- Peak Hours -->
        <div class="section-card">
          <div class="section-title">日程高频忙碌时段</div>
          <div class="peak-hours-list">
            <div v-for="slot in peakHours" :key="slot.label" class="slot-row">
              <div class="slot-info">
                <span class="slot-name">{{ slot.label }}</span>
                <span class="slot-count tabular-nums">{{ slot.count }} 项</span>
              </div>
              <div class="slot-bar-track">
                <div class="slot-bar-fill" :style="{ width: slot.percent + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Database Health & Storage -->
      <div v-if="dbStats" class="section-card db-health-card">
        <div class="section-title-row">
          <span class="section-title">SQLite 数据库健康与存储状态</span>
          <span class="integrity-badge" :class="{ 'is-ok': dbStats.integrity === 'ok' }">
            <i aria-hidden="true"></i>
            {{ dbStats.integrity === 'ok' ? '数据库完整度正常' : '需检查完整性' }}
          </span>
        </div>
        <div class="db-metrics-row">
          <div class="db-metric">
            <span class="db-metric-label">存储占用</span>
            <span class="db-metric-val tabular-nums">{{ Math.round((dbStats.file_size || 0) / 1024) }} KB</span>
          </div>
          <div class="db-metric">
            <span class="db-metric-label">当前活跃</span>
            <span class="db-metric-val tabular-nums">{{ dbStats.active }} 项</span>
          </div>
          <div class="db-metric">
            <span class="db-metric-label">已逾期待办</span>
            <span class="db-metric-val tabular-nums" :class="{ 'warn-text': dbStats.overdue > 0 }">{{ dbStats.overdue }} 项</span>
          </div>
          <button
            class="vacuum-btn"
            :disabled="isVacuuming"
            @click="handleVacuum"
          >
            {{ isVacuuming ? '压缩中…' : '整理压缩 (VACUUM)' }}
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <button class="primary-btn" @click="$emit('close')">完成阅览</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(3, 5, 8, 0.72);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
}

.modal-card {
  position: relative;
  width: 660px;
  max-width: 92vw;
  max-height: 86vh;
  border-radius: 18px;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  background:
    radial-gradient(65% 45% at 15% 0%, color-mix(in srgb, var(--lime) 7%, transparent), transparent 65%),
    radial-gradient(65% 45% at 90% 0%, color-mix(in srgb, var(--tide) 10%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.head-title-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.telemetry-eyebrow {
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--tide-text);
}

.modal-title {
  margin: 0;
  font-size: 16.5px;
  font-weight: 750;
  letter-spacing: -0.025em;
  color: var(--text-primary);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.kpi-box {
  position: relative;
  padding: 13px 12px;
  border-radius: 12px;
  background: radial-gradient(150px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--tide) 11%, transparent), transparent 72%), var(--surface);
  border: 1px solid var(--border-subtle);
  border-top: 2px solid var(--border-strong);
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: var(--shadow-xs);
}

.kpi-index {
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.1em;
  color: var(--text-quaternary);
}

.kpi-num {
  font: 800 22px/1.15 var(--font-display);
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.kpi-label {
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.highlight-success {
  border-top-color: var(--success);
  background: radial-gradient(70% 50% at 100% 0%, color-mix(in srgb, var(--success) 10%, transparent), transparent 65%), var(--surface);
}
.highlight-success .kpi-num { color: var(--success); }

.highlight-brand {
  border-top-color: var(--tide);
  background: radial-gradient(70% 50% at 100% 0%, color-mix(in srgb, var(--tide) 11%, transparent), transparent 65%), var(--surface);
}
.highlight-brand .kpi-num { color: var(--tide-text); }

.highlight-rate {
  border-top-color: var(--lime-strong);
  background: radial-gradient(70% 50% at 100% 0%, color-mix(in srgb, var(--lime) 10%, transparent), transparent 65%), var(--surface);
}
.highlight-rate .kpi-num { color: var(--lime-strong); }

.section-card {
  padding: 14px;
  border-radius: 13px;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-tag {
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.12em;
  color: var(--text-quaternary);
}

.section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.heatmap-grid {
  display: grid;
  grid-template-columns: repeat(14, 1fr);
  gap: 5px;
}

.heatmap-cell {
  aspect-ratio: 1;
  border-radius: 5px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  transition: transform 0.14s ease, border-color 0.14s ease;
}

.heatmap-cell:hover {
  transform: scale(1.12);
  border-color: var(--tide);
}

.cell-tip {
  font: 600 8px var(--font-mono);
  color: var(--text-tertiary);
  opacity: 0.72;
}

.heatmap-cell.level-1 {
  background: color-mix(in srgb, var(--tide) 24%, transparent);
  border-color: color-mix(in srgb, var(--tide) 42%, transparent);
}

.heatmap-cell.level-2 {
  background: color-mix(in srgb, var(--tide) 58%, transparent);
  border-color: var(--tide);
}
.heatmap-cell.level-2 .cell-tip { color: var(--text-primary); }

.heatmap-cell.level-3 {
  background: var(--lime);
  border-color: var(--lime-strong);
}
.heatmap-cell.level-3 .cell-tip { color: var(--ink-on-lime); opacity: 0.95; font-weight: 700; }

.heatmap-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  font: 600 8.5px var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--text-quaternary);
}

.heatmap-legend .heatmap-cell {
  width: 12px;
  height: 12px;
}

.lower-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.priority-split-bar {
  height: 7px;
  display: flex;
  gap: 2px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--fill-subtle);
  padding: 1px;
  border: 1px solid var(--border-subtle);
}

.split-seg {
  height: 100%;
  border-radius: 999px;
  min-width: 6px;
}

.split-seg.p0 { background: var(--danger); }
.split-seg.p1 { background: var(--lime-strong); }
.split-seg.p2 { background: var(--tide); }
.split-seg.p3 { background: var(--border-strong); }

.priority-bars-list,
.peak-hours-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pri-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
}

.pri-tag {
  font: 700 10px var(--font-mono);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.pri-tag.p0 {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 34%, transparent);
}
.pri-tag.p1 {
  background: color-mix(in srgb, var(--lime) 14%, transparent);
  color: var(--lime-strong);
  border-color: color-mix(in srgb, var(--lime) 34%, transparent);
}
.pri-tag.p2 {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: var(--accent-border);
}
.pri-tag.p3 {
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  border-color: var(--border-subtle);
}

.pri-val {
  font: 700 11.5px var(--font-mono);
  color: var(--text-primary);
}

.slot-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.slot-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.slot-name { color: var(--text-secondary); }
.slot-count { font: 700 11px var(--font-mono); color: var(--text-primary); }

.slot-bar-track {
  height: 6px;
  background: var(--fill-hover);
  border-radius: 999px;
  overflow: hidden;
}

.slot-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--tide), var(--lime-strong));
  border-radius: 999px;
  transition: width 0.3s ease;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 6px;
}

.db-health-card { gap: 10px; }

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.integrity-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 700 10px var(--font-mono);
  padding: 2px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 32%, transparent);
}

.integrity-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.integrity-badge.is-ok {
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 32%, transparent);
}

.db-metrics-row {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.db-metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.db-metric-label {
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.db-metric-val {
  font: 700 13px var(--font-mono);
  color: var(--text-primary);
}

.db-metric-val.warn-text {
  color: var(--danger);
}

.vacuum-btn {
  margin-left: auto;
  height: 30px;
  padding: 0 13px;
  font-size: 11px;
  font-weight: 650;
  background: var(--fill-subtle);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.vacuum-btn:hover:not(:disabled) {
  background: var(--tide);
  border-color: var(--tide);
  color: var(--ink-on-accent);
}

.vacuum-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
