<script setup lang="ts">
import { computed } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime } from '../utils/format';
import { handlePointerGlow, resetPointerGlow } from '../utils/pointerGlow';

const props = defineProps<{
  reminders: Reminder[];
  selectedDate: string | null;
  dayCounts: Record<string, number>;
  activeFilter: string;
  nowTick?: number;
}>();

const emit = defineEmits<{
  (e: 'select-date', dateStr: string | null): void;
  (e: 'select-filter', filter: string): void;
  (e: 'open-reminder', reminder: Reminder): void;
}>();

interface HorizonDay {
  key: string;
  weekDay: string;
  dayNum: number;
  isToday: boolean;
  count: number;
}

const days = computed<HorizonDay[]>(() => {
  props.nowTick;
  const result: HorizonDay[] = [];
  const now = new Date();
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  for (let offset = -1; offset <= 5; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const isToday = offset === 0;
    result.push({
      key,
      weekDay: isToday ? '今日' : `周${weekDays[d.getDay()]}`,
      dayNum: d.getDate(),
      isToday,
      count: props.dayCounts[key] || 0,
    });
  }
  return result;
});

const todayStats = computed(() => {
  props.nowTick;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let total = 0;
  let ended = 0;
  let activeAll = 0;

  for (const r of props.reminders) {
    if (r.status === 'active') activeAll++;
    const d = new Date(r.scheduled_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (key === todayKey) {
      total++;
      if (r.status === 'ended') ended++;
    }
  }

  const pct = total > 0 ? Math.round((ended / total) * 100) : (activeAll === 0 ? 100 : 0);
  const filledSegments = Math.round((pct / 100) * 10);
  return { total, ended, activeAll, pct, filledSegments };
});

const nextUpcoming = computed(() => {
  const nowMs = props.nowTick || Date.now();
  let bestFuture: Reminder | null = null;
  let bestFutureTime = Infinity;
  let bestOverdue: Reminder | null = null;
  let bestOverdueTime = -Infinity;

  for (const r of props.reminders) {
    if (r.status !== 'active') continue;
    const t = new Date(r.scheduled_at).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= nowMs - 60000) {
      if (t < bestFutureTime) {
        bestFutureTime = t;
        bestFuture = r;
      }
    } else {
      if (t > bestOverdueTime) {
        bestOverdueTime = t;
        bestOverdue = r;
      }
    }
  }

  const best = bestFuture || bestOverdue;
  if (!best) return null;
  const bestTime = bestFuture ? bestFutureTime : bestOverdueTime;
  const diffMin = Math.round((bestTime - nowMs) / 60000);
  let badge = '';
  let state: 'normal' | 'soon' | 'overdue' = 'normal';

  if (diffMin < 0) {
    const overdueMin = Math.abs(diffMin);
    if (overdueMin >= 60) {
      const hrs = Math.floor(overdueMin / 60);
      const mins = overdueMin % 60;
      badge = mins > 0 ? `逾期 ${hrs} 小时 ${mins} 分` : `逾期 ${hrs} 小时`;
    } else {
      badge = `逾期 ${overdueMin} 分钟`;
    }
    state = 'overdue';
  } else if (diffMin === 0) {
    badge = '即将开始';
    state = 'soon';
  } else if (diffMin < 60) {
    badge = `${diffMin} 分钟后`;
    state = diffMin <= 15 ? 'soon' : 'normal';
  } else if (diffMin < 24 * 60) {
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    badge = mins > 0 ? `${hrs} 小时 ${mins} 分后` : `${hrs} 小时后`;
  } else {
    badge = `${Math.floor(diffMin / (24 * 60))} 天后`;
  }

  return { reminder: best, badge, state, time: formatTime(best.scheduled_at) };
});

// Compute smooth SVG polyline path for the 7-day workload pulse wave (Project Roadmap style)
const pulseWave = computed(() => {
  const counts = days.value.map((d) => d.count);
  const max = Math.max(3, ...counts);
  const w = 132;
  const h = 30;
  const pts = counts.map((c, idx) => {
    const x = (idx / Math.max(1, counts.length - 1)) * w;
    const y = h - 4 - (c / max) * (h - 10);
    return { x, y, c };
  });

  const line = pts
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  return { line, area, pts };
});

function toggleDay(key: string) {
  emit('select-date', props.selectedDate === key ? null : key);
}
</script>

<template>
  <section class="horizon-bento" aria-label="今日节奏与日程地平线">
    <!-- Bento 1: Dark Wallet / Sundrel Hero Completion Rhythm Tile -->
    <button
      type="button"
      class="bento-tile bento-hero-rhythm st-reticle"
      :class="{ active: activeFilter === 'today' }"
      title="点击筛选今日待办"
      @pointermove="handlePointerGlow"
      @pointerleave="resetPointerGlow"
      @click="$emit('select-filter', activeFilter === 'today' ? 'all' : 'today')"
    >
      <div class="hero-copy">
        <span class="mono-kicker">01 · TODAY RHYTHM</span>
        <div class="hero-metric-row">
          <strong class="hero-pct tabular-nums">{{ todayStats.pct }}<small>%</small></strong>
          <span class="hero-sub tabular-nums">
            <template v-if="todayStats.total > 0">{{ todayStats.ended }}/{{ todayStats.total }} 已完结</template>
            <template v-else>{{ todayStats.activeAll }} 项待推进</template>
          </span>
        </div>
      </div>

      <!-- Hand-drawn 10-segment dial inspired by Scrolltide /ui gauges -->
      <svg class="segmented-arc-gauge" viewBox="0 0 64 42" aria-hidden="true">
        <g v-for="seg in 10" :key="seg">
          <line
            :x1="32 + Math.cos(((180 + (seg - 1) * 20) * Math.PI) / 180) * 20"
            :y1="34 + Math.sin(((180 + (seg - 1) * 20) * Math.PI) / 180) * 20"
            :x2="32 + Math.cos(((180 + (seg - 1) * 20) * Math.PI) / 180) * 27"
            :y2="34 + Math.sin(((180 + (seg - 1) * 20) * Math.PI) / 180) * 27"
            stroke-width="3.2"
            stroke-linecap="round"
            :class="['gauge-seg', { filled: seg <= todayStats.filledSegments }]"
          />
        </g>
      </svg>
    </button>

    <!-- Bento 2: Project Roadmap Horizontal Date Carousel -->
    <div
      class="bento-tile bento-date-carousel"
      role="group"
      aria-label="未来七天日期筛选"
      @pointermove="handlePointerGlow"
      @pointerleave="resetPointerGlow"
    >
      <button
        v-for="d in days"
        :key="d.key"
        type="button"
        class="horizon-day-pill"
        :class="{ active: selectedDate === d.key, today: d.isToday }"
        :title="`${d.key} · ${d.count} 项日程`"
        @click="toggleDay(d.key)"
      >
        <span class="pill-weekday">{{ d.weekDay }}</span>
        <span class="pill-day-circle tabular-nums">{{ d.dayNum }}</span>
        <span v-if="d.count > 0" class="pill-load-dot tabular-nums">{{ d.count }}</span>
        <span v-else class="pill-empty-tick" aria-hidden="true"></span>
      </button>
    </div>

    <!-- Bento 3: Project Roadmap Efficiency Wave + Next Up Signal Card -->
    <button
      type="button"
      class="bento-tile bento-next-signal st-reticle"
      :class="nextUpcoming?.state"
      :disabled="!nextUpcoming"
      :title="nextUpcoming ? `打开临近日程：${nextUpcoming.reminder.title}` : '当前暂无待办日程'"
      @pointermove="handlePointerGlow"
      @pointerleave="resetPointerGlow"
      @click="nextUpcoming && $emit('open-reminder', nextUpcoming.reminder)"
    >
      <div class="signal-top-row">
        <span class="mono-kicker">
          <i class="signal-led" :class="nextUpcoming?.state"></i>
          NEXT UP
        </span>
        <span v-if="nextUpcoming" class="next-badge tabular-nums" :class="nextUpcoming.state">
          {{ nextUpcoming.badge }}
        </span>
      </div>

      <div class="signal-body">
        <span class="next-title">
          {{ nextUpcoming ? `${nextUpcoming.time} · ${nextUpcoming.reminder.title}` : '所有待办已清空' }}
        </span>

        <!-- Mini 7-day SVG Pulse Wave -->
        <svg class="workload-wave-svg" viewBox="0 0 132 30" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="st-wave-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="currentColor" stop-opacity="0.34" />
              <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path :d="pulseWave.area" fill="url(#st-wave-grad)" />
          <path :d="pulseWave.line" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </button>
  </section>
</template>

<style scoped>
.horizon-bento {
  display: grid;
  grid-template-columns: minmax(170px, 0.72fr) minmax(280px, 1.38fr) minmax(210px, 0.9fr);
  gap: 8px;
  align-items: stretch;
}

.bento-tile {
  position: relative;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background:
    radial-gradient(220px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--tide, #46b7ff) 11%, transparent), transparent 72%),
    var(--surface);
  transition:
    border-color var(--motion-fast),
    background var(--motion-fast),
    transform var(--motion-fast),
    box-shadow var(--motion-fast);
  text-align: left;
}

/* Tile 1: Dark Wallet / Sundrel Hero Tile */
.bento-hero-rhythm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 13px;
  cursor: pointer;
  overflow: hidden;
  background:
    radial-gradient(200px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--lime, #d9ff54) 11%, transparent), transparent 72%),
    radial-gradient(circle at 92% 15%, color-mix(in srgb, var(--lime, #d9ff54) 16%, transparent), transparent 58%),
    linear-gradient(155deg, color-mix(in oklab, var(--surface-raised) 92%, var(--lime, #d9ff54) 8%), var(--surface));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.bento-hero-rhythm:hover {
  border-color: color-mix(in srgb, var(--lime, #d9ff54) 40%, var(--border-strong));
  transform: translateY(-1px);
}

.bento-hero-rhythm.active {
  border-color: color-mix(in srgb, var(--lime, #d9ff54) 65%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--lime, #d9ff54) 24%, transparent),
    0 8px 24px -8px color-mix(in srgb, var(--lime, #d9ff54) 26%, transparent);
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.mono-kicker {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-quaternary);
  text-transform: uppercase;
}

.hero-metric-row {
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.hero-pct {
  color: var(--text-primary);
  font-size: 21px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}

.hero-pct small {
  font-size: 11px;
  font-weight: 650;
  color: var(--text-tertiary);
  margin-left: 1px;
}

.hero-sub {
  font-size: 10px;
  font-weight: 550;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.segmented-arc-gauge {
  width: 58px;
  height: 38px;
  flex: none;
}

.gauge-seg {
  stroke: var(--border-strong);
  transition: stroke 0.28s ease;
}

.gauge-seg.filled {
  stroke: var(--lime-strong, var(--accent));
}

/* Tile 2: Project Roadmap Horizontal Date Pills */
.bento-date-carousel {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  padding: 5px;
  background:
    radial-gradient(220px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--tide, #46b7ff) 11%, transparent), transparent 72%),
    var(--surface);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.horizon-day-pill {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 4px 2px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  transition: background var(--motion-fast), border-color var(--motion-fast), transform var(--motion-fast);
}

.horizon-day-pill:hover {
  background: var(--fill-hover);
  border-color: var(--border-subtle);
}

.pill-weekday {
  font-size: 9px;
  font-weight: 600;
  color: var(--text-quaternary);
  line-height: 1;
}

.pill-day-circle {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-secondary);
  transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast);
}

.horizon-day-pill.today .pill-weekday {
  color: var(--tide-text, var(--accent-text));
}

.horizon-day-pill.today .pill-day-circle {
  background: color-mix(in srgb, var(--tide, var(--accent)) 18%, transparent);
  color: var(--tide-text, var(--accent-text));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tide, var(--accent)) 45%, transparent);
}

.horizon-day-pill.active {
  background: var(--lime, var(--accent));
  border-color: color-mix(in srgb, var(--lime, var(--accent)) 75%, white);
  box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--lime, var(--accent)) 55%, transparent);
}

.horizon-day-pill.active .pill-weekday {
  color: var(--ink-on-lime, #07080a);
  font-weight: 700;
}

.horizon-day-pill.active .pill-day-circle {
  background: rgba(7, 8, 10, 0.14);
  color: var(--ink-on-lime, #07080a);
  box-shadow: none;
}

.pill-load-dot {
  min-width: 14px;
  height: 12px;
  padding: 0 3px;
  border-radius: 99px;
  background: var(--fill-hover);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  line-height: 12px;
  text-align: center;
}

.horizon-day-pill.active .pill-load-dot {
  background: rgba(7, 8, 10, 0.85);
  color: var(--lime, #d9ff54);
}

.pill-empty-tick {
  width: 3px;
  height: 3px;
  margin: 4.5px 0;
  border-radius: 50%;
  background: var(--border-strong);
}

/* Tile 3: Efficiency Pulse + Next Up Signal Card */
.bento-next-signal {
  --signal-color: #ff8b1a;
  --signal-text: #ffa048;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 13px;
  background:
    radial-gradient(200px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--signal-color) 12%, transparent), transparent 72%),
    radial-gradient(circle at 8% 100%, color-mix(in srgb, var(--signal-color) 12%, transparent), transparent 62%),
    var(--surface);
  cursor: pointer;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.bento-next-signal.overdue {
  --signal-color: var(--danger);
  --signal-text: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 42%, var(--border-subtle));
}

:global([data-theme="daylight"]) .bento-next-signal {
  --signal-color: #d97706;
  --signal-text: #b45309;
}

:global([data-theme="daylight"]) .bento-next-signal.overdue {
  --signal-color: var(--danger);
  --signal-text: var(--danger);
}

.bento-next-signal:disabled {
  cursor: default;
  opacity: 0.75;
  --signal-color: var(--text-quaternary);
  --signal-text: var(--text-tertiary);
}

.bento-next-signal:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--signal-color) 48%, var(--border-strong));
  transform: translateY(-1px);
}

.signal-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.signal-led {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--signal-color);
  box-shadow: 0 0 10px var(--signal-color), 0 0 4px var(--signal-color);
  flex: none;
  display: inline-block;
}

.next-badge {
  font-family: var(--font-family);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
  padding: 2.5px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--signal-color) 16%, transparent);
  color: var(--signal-text);
  border: 1px solid color-mix(in srgb, var(--signal-color) 32%, transparent);
}

.signal-body {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.next-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
  line-height: 1.3;
}

.workload-wave-svg {
  width: 76px;
  height: 24px;
  flex: none;
  color: var(--signal-color);
}

@media (max-width: 920px) {
  .horizon-bento {
    grid-template-columns: minmax(150px, 0.7fr) minmax(230px, 1.3fr) minmax(190px, 0.85fr);
    gap: 6px;
  }
}

@media (max-width: 760px) {
  .horizon-bento {
    grid-template-columns: 1fr;
    gap: 6px;
  }
  .bento-hero-rhythm {
    display: none;
  }
}
</style>
