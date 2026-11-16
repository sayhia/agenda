<script setup lang="ts">
import { computed } from 'vue';
import { getSolarTermOnDate } from '../utils/shanshui';

const props = defineProps<{
  selectedDate: string | null; // "YYYY-MM-DD" or null
  dayCounts: Record<string, number>;
  nowTick?: number;
}>();

const emit = defineEmits<{
  (e: 'select-date', dateStr: string | null): void;
}>();

interface DayItem {
  key: string;       // "YYYY-MM-DD"
  weekDay: string;   // "周一"
  dayNum: number;    // 11
  isToday: boolean;
  count: number;
  solarTerm: string;
}

const days = computed<DayItem[]>(() => {
  props.nowTick;
  const result: DayItem[] = [];
  const now = new Date();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // Generate 7 days: starting from 2 days ago to 4 days ahead
  for (let offset = -1; offset <= 5; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${year}-${month}-${day}`;

    const isToday = offset === 0;
    const count = props.dayCounts[key] || 0;

    result.push({
      key,
      weekDay: isToday ? '今天' : weekDays[d.getDay()],
      dayNum: d.getDate(),
      isToday,
      count,
      solarTerm: getSolarTermOnDate(d)?.name || '',
    });
  }

  return result;
});

function toggleDay(key: string) {
  if (props.selectedDate === key) {
    emit('select-date', null);
  } else {
    emit('select-date', key);
  }
}
function handleStripKeydown(e: KeyboardEvent, index: number) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const container = (e.currentTarget as HTMLElement)?.parentElement;
  const buttons = Array.from(container?.querySelectorAll<HTMLButtonElement>('.day-card') || []);
  if (!buttons.length) return;
  e.preventDefault();
  let nextIdx = index;
  if (e.key === 'ArrowLeft') nextIdx = (index - 1 + buttons.length) % buttons.length;
  else if (e.key === 'ArrowRight') nextIdx = (index + 1) % buttons.length;
  else if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = buttons.length - 1;
  buttons[nextIdx]?.focus();
}
</script>

<template>
  <div class="weekstrip-wrap st-reticle">
    <button
      v-for="(d, idx) in days"
      :key="d.key"
      type="button"
      class="day-card"
      :class="{
        active: selectedDate === d.key,
        today: d.isToday,
      }"
      :title="d.solarTerm ? `${d.key} · 节气：${d.solarTerm}` : d.key"
      :aria-pressed="selectedDate === d.key"
      @click="toggleDay(d.key)"
      @keydown="handleStripKeydown($event, idx)"
    >
      <div class="day-label-row">
        <span class="day-label">{{ d.isToday ? '今天' : d.weekDay }}</span>
        <span v-if="d.solarTerm" class="solar-mini-tag">{{ d.solarTerm }}</span>
      </div>
      <span class="day-num tabular-nums">{{ d.dayNum }}</span>
      <span v-if="d.count > 0" class="day-count tabular-nums">{{ d.count }}</span>
      <span v-else class="day-dot"></span>
    </button>
  </div>
</template>

<style scoped>
.weekstrip-wrap {
  position: relative;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  padding: 8px 10px;
  border-radius: 13px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  box-shadow: var(--shadow-xs);
  margin-bottom: 12px;
}

.day-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 7px 4px;
  border-radius: 10px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.16s ease;
  position: relative;
  overflow: hidden;
}

.day-card:hover {
  background: var(--fill-hover);
  transform: translateY(-1px);
  border-color: var(--border-l2);
}

.day-card.today {
  border-color: var(--accent-border);
  background: color-mix(in srgb, var(--tide) 7%, transparent);
}

.day-card.active {
  background: var(--lime);
  border-color: var(--lime-strong);
  box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--lime) 42%, transparent);
  transform: translateY(-1px);
}

.day-card.active::after {
  content: "";
  position: absolute;
  bottom: 2px;
  width: 14px;
  height: 2.5px;
  border-radius: 2px;
  background: var(--ink-on-lime);
}

.day-label-row {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  max-width: 100%;
}

.day-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
}

.solar-mini-tag {
  padding: 0 3px;
  border-radius: 3px;
  font-size: 8.5px;
  font-weight: 700;
  color: var(--seal-red, #e05246);
  background: color-mix(in srgb, var(--seal-red, #e05246) 14%, transparent);
  line-height: 1.3;
}

.day-card.active .solar-mini-tag {
  color: var(--ink-on-lime);
  background: color-mix(in srgb, var(--ink-on-lime) 18%, transparent);
}

.day-card.today .day-label {
  color: var(--tide-text);
}

.day-card.active .day-label {
  color: var(--ink-on-lime);
}

.day-num {
  font-size: 14.5px;
  font-weight: 750;
  color: var(--text-primary);
}

.day-card.active .day-num {
  color: var(--ink-on-lime);
}

.day-count {
  min-width: 17px;
  height: 17px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  font: 700 9.5px/15px var(--font-mono);
  text-align: center;
  padding: 0 4px;
}

.day-card.active .day-count {
  background: var(--ink-on-lime);
  border-color: transparent;
  color: var(--lime);
}

.day-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border-strong);
  margin: 6px 0;
}
</style>
