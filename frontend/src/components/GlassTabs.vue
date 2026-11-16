<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue';

export interface GlassTabItem {
  id: string;
  label: string;
  badge?: string | number;
  title?: string;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  items: GlassTabItem[];
  size?: 'sm' | 'md';
  ariaLabel?: string;
}>(), {
  size: 'md',
  ariaLabel: '切换视图',
});

const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void;
  (e: 'change', id: string): void;
}>();

const trackRef = ref<HTMLElement | null>(null);
const thumbStyle = ref<{ transform: string; width: string; opacity: number }>({
  transform: 'translateX(0px)',
  width: '0px',
  opacity: 0,
});
const isStretching = ref(false);
let stretchTimer: ReturnType<typeof setTimeout> | null = null;
let resizeObserver: ResizeObserver | null = null;

async function syncThumb(animateStretch = false) {
  await nextTick();
  const track = trackRef.value;
  if (!track) return;
  const activeBtn = track.querySelector<HTMLElement>(`[data-tab-id="${props.modelValue}"]`);
  if (!activeBtn) {
    thumbStyle.value = { transform: 'translateX(0px)', width: '0px', opacity: 0 };
    return;
  }
  const x = activeBtn.offsetLeft - 3;
  const w = activeBtn.offsetWidth;

  if (animateStretch) {
    isStretching.value = true;
    if (stretchTimer) clearTimeout(stretchTimer);
    stretchTimer = setTimeout(() => { isStretching.value = false; }, 220);
  }

  thumbStyle.value = {
    transform: `translateX(${Math.max(0, x)}px)`,
    width: `${w}px`,
    opacity: 1,
  };
}

function selectTab(id: string) {
  if (id === props.modelValue) return;
  emit('update:modelValue', id);
  emit('change', id);
}

watch(() => props.modelValue, () => void syncThumb(true));
watch(() => props.items, () => void syncThumb(false), { deep: true });

onMounted(() => {
  void syncThumb(false);
  if (typeof ResizeObserver !== 'undefined' && trackRef.value) {
    resizeObserver = new ResizeObserver(() => void syncThumb(false));
    resizeObserver.observe(trackRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  if (stretchTimer) clearTimeout(stretchTimer);
});
</script>

<template>
  <div
    ref="trackRef"
    class="glass-tabs-track"
    :class="[`size-${size}`]"
    role="tablist"
    :aria-label="ariaLabel"
  >
    <!-- Sliding Refractive Glass Lens -->
    <div
      class="glass-tabs-lens"
      :class="{ stretching: isStretching }"
      :style="thumbStyle"
      aria-hidden="true"
    >
      <span class="lens-glint"></span>
    </div>

    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      role="tab"
      :data-tab-id="item.id"
      :aria-selected="modelValue === item.id"
      :title="item.title || item.label"
      class="glass-tab-btn"
      :class="{ active: modelValue === item.id }"
      @click="selectTab(item.id)"
    >
      <span class="tab-label">{{ item.label }}</span>
      <span v-if="item.badge !== undefined" class="tab-badge tabular-nums">{{ item.badge }}</span>
    </button>
  </div>
</template>

<style scoped>
.glass-tabs-track {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: 999px;
  background: var(--glass-track-bg, rgba(255, 255, 255, 0.035));
  border: 1px solid var(--border-subtle);
  box-shadow: var(--glass-track-shadow, inset 0 1px 2px rgba(0, 0, 0, 0.32));
  user-select: none;
  isolation: isolate;
}

.glass-tabs-track.size-md {
  height: 34px;
}

.glass-tabs-track.size-sm {
  height: 28px;
}

.glass-tabs-lens {
  position: absolute;
  top: 3px;
  left: 3px;
  bottom: 3px;
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    color-mix(in oklab, var(--surface-overlay) 92%, white 8%),
    var(--surface-raised)
  );
  border: 1px solid var(--border-strong);
  box-shadow:
    var(--glass-lens-shadow, 0 4px 14px rgba(0, 0, 0, 0.38)),
    0 0 18px color-mix(in srgb, var(--tide, #46b7ff) 18%, transparent),
    inset 0 1px 0 var(--highlight-edge);
  backdrop-filter: blur(12px) saturate(160%);
  -webkit-backdrop-filter: blur(12px) saturate(160%);
  transition:
    transform 0.34s cubic-bezier(0.32, 1.28, 0.5, 1),
    width 0.32s cubic-bezier(0.32, 1.28, 0.5, 1),
    opacity 0.16s ease;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.glass-tabs-lens.stretching {
  box-shadow:
    var(--glass-lens-shadow-stretch, 0 4px 18px rgba(0, 0, 0, 0.45)),
    0 0 22px color-mix(in srgb, var(--tide, #46b7ff) 32%, transparent),
    inset 0 1px 0 var(--highlight-edge);
}

/* Chromatic rim glint modeled after Scrolltide Glass Tabs */
.lens-glint {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--tide) 16%, transparent) 0%,
    var(--highlight-edge) 45%,
    color-mix(in srgb, var(--theme-secondary, var(--lime)) 14%, transparent) 100%
  );
  opacity: 0.7;
}

.glass-tab-btn {
  position: relative;
  z-index: 1;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 550;
  letter-spacing: -0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.18s ease;
}

.size-sm .glass-tab-btn {
  padding: 0 9px;
  font-size: 10px;
}

.glass-tab-btn:hover {
  color: var(--text-primary);
}

.glass-tab-btn.active {
  color: var(--text-primary);
  font-weight: 650;
}

.tab-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--fill-hover);
  color: var(--text-tertiary);
}

.glass-tab-btn.active .tab-badge {
  background: color-mix(in srgb, var(--tide, #46b7ff) 18%, transparent);
  color: var(--accent-text);
}
</style>
