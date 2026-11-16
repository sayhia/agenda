<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime } from '../utils/format';
import { getApproxSolarTerm, getChineseShichen, getSeasonalAtmosphere, getSolarTermOnDate } from '../utils/shanshui';
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
  (e: 'open-solar-terms'): void;
}>();

interface HorizonDay {
  key: string;
  weekDay: string;
  dayNum: number;
  isToday: boolean;
  count: number;
  solarTerm: string;
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
      weekDay: isToday ? '今日' : (offset === -1 ? '昨日' : `周${weekDays[d.getDay()]}`),
      dayNum: d.getDate(),
      isToday,
      count: props.dayCounts[key] || 0,
      solarTerm: getSolarTermOnDate(d)?.name || '',
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
  let overdue = 0;
  let activeAll = 0;
  const nowMs = localTick.value;

  for (const r of props.reminders) {
    if (r.status === 'active') activeAll++;
    const d = new Date(r.scheduled_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (key === todayKey) {
      total++;
      if (r.status === 'ended') ended++;
      else if (r.status === 'expired' || (r.status === 'active' && d.getTime() < nowMs)) overdue++;
    }
  }

  const pct = total > 0 ? Math.round((ended / total) * 100) : (activeAll === 0 ? 100 : 0);
  const filledSegments = Math.round((pct / 100) * 10);
  return { total, ended, overdue, activeAll, pct, filledSegments };
});

const localTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

function setupTicker() {
  if (timer) clearInterval(timer);
  const intervalMs = typeof document !== 'undefined' && document.hidden ? 5000 : 1000;
  timer = setInterval(() => {
    localTick.value = Date.now();
  }, intervalMs);
}

function handleVisibilityChange() {
  localTick.value = Date.now();
  setupTicker();
}

onMounted(() => {
  setupTicker();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
});

const nextUpcoming = computed(() => {
  const nowMs = localTick.value;
  let bestFuture: Reminder | null = null;
  let bestFutureTime = Infinity;
  let bestOverdue: Reminder | null = null;
  let bestOverdueTime = -Infinity;

  for (const r of props.reminders) {
    if (r.status !== 'active' && r.status !== 'expired') continue;
    const t = new Date(r.scheduled_at).getTime();
    if (Number.isNaN(t)) continue;
    if (r.status === 'active' && t >= nowMs - 60000) {
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
  const diffSec = Math.round((bestTime - nowMs) / 1000);
  const diffMin = Math.round((bestTime - nowMs) / 60000);
  let badge = '';
  let state: 'normal' | 'soon' | 'overdue' = 'normal';

  if (diffSec < 0) {
    const overdueSec = Math.abs(diffSec);
    if (overdueSec < 60) {
      badge = `已逾期 ${overdueSec} 秒`;
    } else {
      const overdueMin = Math.floor(overdueSec / 60);
      if (overdueMin >= 60) {
        const hrs = Math.floor(overdueMin / 60);
        const mins = overdueMin % 60;
        badge = mins > 0 ? `逾期 ${hrs} 小时 ${mins} 分` : `逾期 ${hrs} 小时`;
      } else {
        badge = `逾期 ${overdueMin} 分钟`;
      }
    }
    state = 'overdue';
  } else if (diffSec <= 15) {
    badge = '即将开始';
    state = 'soon';
  } else if (diffSec < 60) {
    badge = `${diffSec} 秒后`;
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

function toggleDay(key: string) {
  emit('select-date', props.selectedDate === key ? null : key);
}

function handleCarouselKeydown(event: KeyboardEvent, index: number) {
  const navKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!navKeys.includes(event.key)) return;
  const container = (event.currentTarget as HTMLElement | null)?.parentElement;
  const pills = Array.from(container?.querySelectorAll<HTMLButtonElement>('.horizon-day-pill') || []);
  if (!pills.length) return;
  event.preventDefault();
  let targetIndex = index;
  if (event.key === 'ArrowLeft') targetIndex = (index - 1 + pills.length) % pills.length;
  else if (event.key === 'ArrowRight') targetIndex = (index + 1) % pills.length;
  else if (event.key === 'Home') targetIndex = 0;
  else if (event.key === 'End') targetIndex = pills.length - 1;
  pills[targetIndex]?.focus();
}

const shanshuiMoment = computed(() => {
  props.nowTick;
  const now = new Date();
  return {
    shichen: getChineseShichen(now),
    solar: getApproxSolarTerm(now),
    seasonal: getSeasonalAtmosphere(now),
  };
});
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
        <span class="mono-kicker">
          <span>01 · TODAY RHYTHM</span>
          <span
            class="kicker-shanshui"
            role="button"
            tabindex="0"
            :title="`${shanshuiMoment.solar.verse} · ${shanshuiMoment.shichen.poeticHint} · ${shanshuiMoment.seasonal.auraLabel}（点击打开廿四节气与四季图鉴）`"
            @click.stop="$emit('open-solar-terms')"
            @keydown.enter.stop.prevent="$emit('open-solar-terms')"
          >
            <span class="kicker-chip">{{ shanshuiMoment.solar.season }}令·{{ shanshuiMoment.solar.name }}</span>
            <span class="kicker-chip">{{ shanshuiMoment.shichen.branch }}时</span>
          </span>
        </span>
        <div class="hero-metric-row">
          <strong class="hero-pct tabular-nums">{{ todayStats.pct }}<small>%</small></strong>
          <span class="hero-sub tabular-nums">
            <template v-if="todayStats.total > 0">{{ todayStats.ended }}/{{ todayStats.total }} 已完结</template>
            <template v-else>{{ todayStats.activeAll }} 项待推进</template>
          </span>
          <span v-if="todayStats.overdue > 0" class="hero-overdue-pill tabular-nums">逾期 {{ todayStats.overdue }}</span>
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
        v-for="(d, idx) in days"
        :key="d.key"
        type="button"
        class="horizon-day-pill"
        :class="{ active: selectedDate === d.key, today: d.isToday, 'has-solar': Boolean(d.solarTerm) }"
        :title="`${d.key}${d.solarTerm ? ` · 节气：${d.solarTerm}` : ''} · ${d.count} 项日程`"
        :aria-pressed="selectedDate === d.key"
        @click="toggleDay(d.key)"
        @keydown="handleCarouselKeydown($event, idx)"
      >
        <span class="pill-weekday-row">
          <span class="pill-weekday">{{ d.weekDay }}</span>
          <span v-if="d.solarTerm" class="pill-solar-badge">{{ d.solarTerm }}</span>
        </span>
        <span class="pill-day-circle tabular-nums">{{ d.dayNum }}</span>
        <span v-if="d.count > 0" class="pill-load-dot tabular-nums">{{ d.count }}</span>
        <span v-else class="pill-empty-tick" aria-hidden="true"></span>
      </button>
    </div>

    <!-- Bento 3: Project Roadmap Efficiency Wave + Next Up Signal Card (Pixel-perfect match to Cyberpunk Telemetry Card) -->
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
        <div class="next-title-group" v-if="nextUpcoming">
          <span class="next-time tabular-nums">{{ nextUpcoming.time }}</span>
          <span class="next-dot">·</span>
          <span class="next-title">{{ nextUpcoming.reminder.title }}</span>
        </div>
        <span v-else class="next-empty-label">所有待办已清空</span>

        <!-- Sleek Angled Telemetry Ramp Graphic with Soft Gradient Underglow -->
        <div class="telemetry-wrapper" aria-hidden="true">
          <svg class="telemetry-slope-svg" viewBox="0 0 96 28" fill="none" preserveAspectRatio="none">
            <defs>
              <linearGradient id="st-slope-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--signal-color)" stop-opacity="0.32" />
                <stop offset="100%" stop-color="var(--signal-color)" stop-opacity="0.0" />
              </linearGradient>
            </defs>
            <path d="M 0 4 L 16 22 L 96 22 L 96 28 L 0 28 Z" fill="url(#st-slope-grad)" />
            <path d="M 0 4 L 16 22 L 96 22" fill="none" stroke="var(--signal-color)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="reticle-corner-plus">+</span>
        </div>
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
  box-shadow: inset 0 1px 0 var(--highlight-edge);
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
  flex-wrap: wrap;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-quaternary);
  text-transform: uppercase;
}
.kicker-shanshui {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--tide-text);
  letter-spacing: 0.05em;
  opacity: 0.9;
}

.kicker-chip {
  white-space: nowrap;
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

.hero-overdue-pill {
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--danger) 38%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font: 700 9px/1.3 var(--font-mono);
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
  box-shadow: inset 0 1px 0 var(--highlight-edge);
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

.pill-weekday-row {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  max-width: 100%;
  min-width: 0;
}

.pill-weekday {
  font-size: 9px;
  font-weight: 600;
  color: var(--text-quaternary);
  line-height: 1;
}

.pill-solar-badge {
  padding: 0 3px;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 700;
  color: var(--seal-red, #e05246);
  background: color-mix(in srgb, var(--seal-red, #e05246) 14%, transparent);
  line-height: 1.25;
  white-space: nowrap;
}

.horizon-day-pill.active .pill-solar-badge {
  color: var(--ink-on-lime, #07080a);
  background: color-mix(in srgb, var(--ink-on-lime, #07080a) 16%, transparent);
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
  background: color-mix(in srgb, var(--ink-on-lime, #07080a) 15%, transparent);
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
  background: var(--ink-on-lime, #07080a);
  color: var(--lime, #d9ff54);
}

.pill-empty-tick {
  width: 3px;
  height: 3px;
  margin: 4.5px 0;
  border-radius: 50%;
  background: var(--border-strong);
}

/* Tile 3: Telemetry / Seal Next Up Signal Card */
.bento-next-signal {
  --signal-color: var(--vermilion, #f97316);
  --signal-text: var(--vermilion-text, #fdba74);
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 15px;
  background:
    radial-gradient(220px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--signal-color) 14%, transparent), transparent 72%),
    linear-gradient(180deg, var(--highlight-edge) 0%, transparent 100%),
    var(--surface-raised);
  border-radius: 14px;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  overflow: hidden;
  box-shadow: var(--shadow-xs), inset 0 1px 0 var(--highlight-edge);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

:global([data-theme^="shanshui-"]) .bento-next-signal {
  --signal-color: var(--seal-red, #e05246);
  --signal-text: var(--seal-red, #e05246);
}

.bento-next-signal::before {
  content: '+';
  position: absolute;
  top: 6px;
  left: 9px;
  font-size: 11px;
  line-height: 1;
  font-weight: 300;
  color: var(--text-quaternary);
  opacity: 0.55;
  font-family: var(--font-mono);
  pointer-events: none;
}

.bento-next-signal.overdue {
  --signal-color: var(--danger);
  --signal-text: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border-subtle));
}

.bento-next-signal:disabled {
  cursor: default;
  opacity: 0.75;
  --signal-color: var(--text-quaternary);
  --signal-text: var(--text-tertiary);
}

.bento-next-signal:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--signal-color) 52%, var(--border-strong));
  transform: translateY(-1.5px);
  box-shadow: var(--shadow-sm), 0 0 16px color-mix(in srgb, var(--signal-color) 18%, transparent);
}

.signal-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  position: relative;
  z-index: 1;
}

.signal-top-row .mono-kicker {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.signal-led {
  width: 7.5px;
  height: 7.5px;
  border-radius: 50%;
  background: var(--signal-color);
  box-shadow:
    0 0 8px var(--signal-color),
    0 0 16px color-mix(in srgb, var(--signal-color) 80%, transparent),
    0 0 24px color-mix(in srgb, var(--signal-color) 40%, transparent);
  flex: none;
  display: inline-block;
  animation: signal-glow-pulse 2.8s ease-in-out infinite;
}

@keyframes signal-glow-pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.75;
    transform: scale(0.92);
  }
}

.next-badge {
  font-family: var(--font-family);
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
  padding: 3.5px 10px;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--signal-color) 14%, var(--surface));
  color: var(--signal-text);
  border: 1px solid color-mix(in srgb, var(--signal-color) 28%, transparent);
  box-shadow: var(--shadow-xs);
}

.next-badge.urgent {
  background: color-mix(in srgb, var(--danger) 16%, var(--surface));
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 42%, transparent);
}

.bento-next-signal:disabled .signal-led {
  animation: none;
  opacity: 0.45;
  box-shadow: none;
}

:global([data-color-scheme="light"]) .bento-next-signal {
  background:
    radial-gradient(220px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--signal-color) 10%, transparent), transparent 72%),
    linear-gradient(180deg, var(--highlight-edge) 0%, var(--surface) 100%);
  border-color: var(--border-subtle);
  box-shadow: var(--shadow-xs), inset 0 1px 0 var(--highlight-edge);
}

:global([data-color-scheme="light"]) .next-badge {
  background: color-mix(in srgb, var(--signal-color) 11%, var(--surface-raised));
  color: var(--signal-text);
  border-color: color-mix(in srgb, var(--signal-color) 30%, transparent);
  box-shadow: none;
}

:global([data-color-scheme="light"]) .next-badge.urgent,
:global([data-color-scheme="light"]) .bento-next-signal.overdue .next-badge {
  background: color-mix(in srgb, var(--danger) 12%, var(--surface-raised));
  color: var(--danger);
}

.signal-body {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.next-title-group {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.next-time {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  flex: none;
}

.next-dot {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-quaternary);
  flex: none;
}

.next-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.next-empty-label {
  font-size: 13px;
  color: var(--text-tertiary);
}

.telemetry-wrapper {
  position: relative;
  display: flex;
  align-items: flex-end;
  flex: none;
}

.telemetry-slope-svg {
  width: 82px;
  height: 24px;
  flex: none;
}

.reticle-corner-plus {
  position: absolute;
  right: -6px;
  bottom: -4px;
  font-size: 10px;
  line-height: 1;
  font-weight: 300;
  color: var(--text-quaternary);
  opacity: 0.6;
  font-family: var(--font-mono);
  pointer-events: none;
}

@media (max-width: 1060px) {
  .horizon-bento {
    grid-template-columns: minmax(144px, 0.7fr) minmax(218px, 1.3fr) minmax(188px, 1fr);
    gap: 6px;
  }
  .telemetry-wrapper {
    display: none;
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
  .horizon-day-pill {
    min-width: 0;
    padding: 3px 1px;
  }
  .pill-solar-badge {
    display: none;
  }
}
</style>
