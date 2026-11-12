<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: number;
  presets?: number[];
  compact?: boolean;
}>(), {
  presets: () => [15, 25, 30, 45, 60, 90, 120],
  compact: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', minutes: number): void;
}>();

const currentIndex = computed(() => {
  const exact = props.presets.indexOf(props.modelValue);
  if (exact !== -1) return exact;
  let closest = 0;
  let minDiff = Infinity;
  props.presets.forEach((p, idx) => {
    const diff = Math.abs(p - props.modelValue);
    if (diff < minDiff) {
      minDiff = diff;
      closest = idx;
    }
  });
  return closest;
});

function selectPreset(minutes: number) {
  emit('update:modelValue', minutes);
}

function handleWheel(event: WheelEvent) {
  event.preventDefault();
  const dir = event.deltaY > 0 || event.deltaX > 0 ? 1 : -1;
  const next = Math.max(0, Math.min(props.presets.length - 1, currentIndex.value + dir));
  if (next !== currentIndex.value) {
    emit('update:modelValue', props.presets[next]);
  }
}

function formatDuration(mins: number): string {
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}
</script>

<template>
  <div
    class="tuner-dial"
    :class="{ compact }"
    title="滚动滚轮或点击刻度调节时长（Scrolltide Tuner 刻度尺）"
    @wheel="handleWheel"
  >
    <div class="tuner-readout tabular-nums">
      <span class="tuner-needle-pip" aria-hidden="true"></span>
      <strong>{{ modelValue }}</strong>
      <small>MIN</small>
    </div>

    <div class="tuner-tape" role="radiogroup" aria-label="持续时长选择">
      <button
        v-for="(val, idx) in presets"
        :key="val"
        type="button"
        role="radio"
        :aria-checked="modelValue === val"
        class="tuner-stop"
        :class="{ active: idx === currentIndex }"
        @click="selectPreset(val)"
      >
        <span class="tick-marks" aria-hidden="true">
          <i class="tick minor"></i>
          <i class="tick major"></i>
          <i class="tick minor"></i>
        </span>
        <span class="stop-label tabular-nums">{{ formatDuration(val) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tuner-dial {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 2px 6px;
  border-radius: 8px;
  background: var(--input-bg);
  border: 1px solid var(--border-subtle);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
  user-select: none;
}

.tuner-readout {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--vermilion, #ff5a36) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--vermilion, #ff5a36) 35%, transparent);
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.tuner-needle-pip {
  width: 5px;
  height: 5px;
  align-self: center;
  border-radius: 50%;
  background: var(--vermilion, #ff5a36);
  box-shadow: 0 0 6px var(--vermilion, #ff5a36);
}

.tuner-readout strong {
  font-size: 10.5px;
  font-weight: 750;
}

.tuner-readout small {
  font-size: 8px;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.tuner-tape {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tuner-stop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 2px 5px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-quaternary);
  cursor: pointer;
  transition: color 0.14s ease, background 0.14s ease, transform 0.14s ease;
}

.tuner-stop:hover {
  color: var(--text-secondary);
  background: var(--fill-hover);
}

.tick-marks {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 6px;
}

.tick {
  display: block;
  width: 1px;
  background: currentColor;
  opacity: 0.35;
  transition: height 0.15s ease, opacity 0.15s ease, background 0.15s ease;
}

.tick.minor {
  height: 3px;
}

.tick.major {
  height: 6px;
  opacity: 0.55;
}

.stop-label {
  font-family: var(--font-mono);
  font-size: 8.5px;
  font-weight: 600;
  line-height: 1;
}

.tuner-stop.active {
  color: var(--text-primary);
  background: var(--fill-active);
}

.tuner-stop.active .tick.major {
  width: 2px;
  height: 8px;
  opacity: 1;
  background: var(--vermilion, #ff5a36);
  box-shadow: 0 0 5px color-mix(in srgb, var(--vermilion, #ff5a36) 70%, transparent);
}

.tuner-stop.active .stop-label {
  color: var(--vermilion-text, #ff967d);
  font-weight: 750;
}

.tuner-dial.compact .tuner-stop {
  padding: 2px 3.5px;
}
</style>
