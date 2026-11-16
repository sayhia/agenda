<script setup lang="ts">
import { computed } from 'vue';
import DesktopIcon from './DesktopIcon.vue';
import {
  dismissFloatingFocusWidget,
  focusDisplayClock,
  focusEngineState,
  focusProgressPercent,
  hasLiveFocusActivity,
  skipToNextFocusPhase,
  toggleFocusTimer,
} from '../utils/focusEngine';

const props = defineProps<{
  modalVisible: boolean;
}>();

defineEmits<{
  (e: 'open-modal'): void;
}>();

const visible = computed(
  () =>
    !props.modalVisible &&
    hasLiveFocusActivity.value &&
    !focusEngineState.floatingWidgetDismissed,
);

const ringRadius = 11;
const ringCircumference = 2 * Math.PI * ringRadius;
const ringOffset = computed(() => ringCircumference * (1 - focusProgressPercent.value / 100));

const modeLabel = computed(() => {
  if (focusEngineState.mode === 'shortBreak') return '短休';
  if (focusEngineState.mode === 'longBreak') return '长休';
  return '专注';
});
</script>

<template>
  <Transition name="float-dock-fade">
    <aside
      v-if="visible"
      class="focus-floating-dock st-reticle"
      :class="{
        running: focusEngineState.isRunning,
        'is-break': focusEngineState.mode === 'shortBreak',
        'is-long-break': focusEngineState.mode === 'longBreak',
      }"
      aria-label="迷你专注悬浮计时条"
    >
      <button
        type="button"
        class="dock-main-trigger"
        title="点击展开专注主窗口"
        @click="$emit('open-modal')"
      >
        <svg class="dock-mini-ring" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <circle
            cx="14"
            cy="14"
            :r="ringRadius"
            fill="none"
            stroke="var(--border-strong)"
            stroke-width="2.5"
          />
          <circle
            class="dock-ring-progress"
            cx="14"
            cy="14"
            :r="ringRadius"
            fill="none"
            stroke-width="2.5"
            stroke-linecap="round"
            :stroke-dasharray="ringCircumference"
            :stroke-dashoffset="ringOffset"
            transform="rotate(-90 14 14)"
          />
        </svg>

        <div class="dock-copy">
          <div class="dock-top-line">
            <span class="dock-phase">{{ modeLabel }}</span>
            <span class="dock-clock tabular-nums">{{ focusDisplayClock }}</span>
          </div>
          <span class="dock-task-name">{{ focusEngineState.reminderTitle || '自由沉浸专注' }}</span>
        </div>
      </button>

      <div class="dock-actions">
        <button
          type="button"
          class="dock-btn primary"
          :title="focusEngineState.isRunning ? '暂停计时' : '继续计时'"
          :aria-label="focusEngineState.isRunning ? '暂停专注计时' : '继续专注计时'"
          @click="toggleFocusTimer"
        >
          <DesktopIcon :name="focusEngineState.isRunning ? 'pause' : 'play'" :size="11" :strokeWidth="2.1" />
        </button>
        <button
          type="button"
          class="dock-btn"
          title="进入下一阶段"
          aria-label="进入下一专注阶段"
          @click="skipToNextFocusPhase"
        >
          <DesktopIcon name="skip" :size="11" />
        </button>
        <button
          type="button"
          class="dock-btn dismiss"
          title="隐藏悬浮条（可从顶部栏随时恢复）"
          aria-label="隐藏迷你悬浮计时条"
          @click="dismissFloatingFocusWidget"
        >
          <DesktopIcon name="close" :size="11" />
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.focus-floating-dock {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: var(--z-float);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px 7px 10px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-overlay) 92%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--accent-border);
  box-shadow: var(--shadow-lg);
  max-width: 300px;
}

.focus-floating-dock.running {
  box-shadow:
    var(--shadow-lg),
    0 0 22px -6px color-mix(in srgb, var(--tide) 45%, transparent);
}

.focus-floating-dock.is-break {
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
}

.focus-floating-dock.is-long-break {
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
}

.dock-main-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  padding: 0;
  color: inherit;
  cursor: pointer;
  min-width: 0;
  text-align: left;
}

.dock-mini-ring {
  flex-shrink: 0;
}

.dock-ring-progress {
  stroke: var(--tide);
  transition: stroke-dashoffset 0.35s linear;
}

.is-break .dock-ring-progress {
  stroke: var(--success);
}

.is-long-break .dock-ring-progress {
  stroke: var(--warning);
}

.dock-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dock-top-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.dock-phase {
  font-size: 10px;
  font-weight: 700;
  color: var(--tide-text);
}

.is-break .dock-phase {
  color: var(--success);
}

.is-long-break .dock-phase {
  color: var(--warning);
}

.dock-clock {
  font-family: var(--font-mono);
  font-size: 13.5px;
  font-weight: 800;
  color: var(--text-primary);
}

.dock-task-name {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.dock-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.dock-btn {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.14s ease;
}

.dock-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
  background: var(--fill-hover);
}

.dock-btn.primary {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--tide-text);
}

.float-dock-fade-enter-active,
.float-dock-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}

.float-dock-fade-enter-from,
.float-dock-fade-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.96);
}
</style>
