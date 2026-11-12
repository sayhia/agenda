<script setup lang="ts" generic="T extends string | number = string | number">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

export interface ScrolltideSelectOption<V extends string | number = string | number> {
  value: V;
  label: string;
}

const props = withDefaults(defineProps<{
  modelValue: T;
  options: ScrolltideSelectOption<T>[];
  placeholder?: string;
  ariaLabel?: string;
  align?: 'left' | 'right';
  compact?: boolean;
  pill?: boolean;
}>(), {
  placeholder: '请选择',
  ariaLabel: undefined,
  align: 'left',
  compact: false,
  pill: false,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: T): void;
  (e: 'change', value: T): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);

const displayLabel = computed(() => {
  const matched = props.options.find((opt) => opt.value === props.modelValue);
  if (matched) return matched.label;
  if (props.modelValue !== '' && props.modelValue !== null && props.modelValue !== undefined) {
    return String(props.modelValue);
  }
  return props.placeholder;
});

function openAndFocus(focusLast = false) {
  isOpen.value = true;
  void nextTick(() => {
    const items = Array.from(menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    if (!items.length) return;
    const activeIndex = items.findIndex((el) => el.getAttribute('aria-selected') === 'true');
    const target = focusLast
      ? items[items.length - 1]
      : activeIndex >= 0
        ? items[activeIndex]
        : items[0];
    target?.focus();
  });
}

function toggleMenu() {
  if (isOpen.value) {
    isOpen.value = false;
  } else {
    openAndFocus(false);
  }
}

function selectOption(option: ScrolltideSelectOption<T>) {
  isOpen.value = false;
  triggerRef.value?.focus();
  if (option.value !== props.modelValue) {
    emit('update:modelValue', option.value);
    emit('change', option.value);
  }
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    openAndFocus(false);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    openAndFocus(true);
  }
}

function handleMenuKeydown(event: KeyboardEvent) {
  const items = Array.from(menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    items[(idx + delta + items.length) % items.length]?.focus();
  } else if (event.key === 'Home') {
    event.preventDefault();
    items[0]?.focus();
  } else if (event.key === 'End') {
    event.preventDefault();
    items[items.length - 1]?.focus();
  }
}

function handleOutsideClick(event: MouseEvent) {
  if (!isOpen.value || !rootRef.value) return;
  if (!rootRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    isOpen.value = false;
    triggerRef.value?.focus();
  }
}

watch(isOpen, (open) => {
  if (open) {
    window.addEventListener('mousedown', handleOutsideClick, true);
    window.addEventListener('keydown', handleEscape, true);
  } else {
    window.removeEventListener('mousedown', handleOutsideClick, true);
    window.removeEventListener('keydown', handleEscape, true);
  }
});

onUnmounted(() => {
  window.removeEventListener('mousedown', handleOutsideClick, true);
  window.removeEventListener('keydown', handleEscape, true);
});
</script>

<template>
  <div ref="rootRef" class="st-select-wrap" :class="{ open: isOpen, compact, pill }">
    <button
      ref="triggerRef"
      type="button"
      class="st-select-trigger"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      @click="toggleMenu"
      @keydown="handleTriggerKeydown"
    >
      <span class="st-select-value">{{ displayLabel }}</span>
      <svg class="st-select-caret" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
        <path d="M3 4.5 6 7.5 9 4.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div
      v-if="isOpen"
      ref="menuRef"
      class="st-select-menu"
      :class="`align-${align}`"
      role="listbox"
      :aria-label="ariaLabel"
      @keydown="handleMenuKeydown"
    >
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        type="button"
        role="option"
        :aria-selected="opt.value === modelValue"
        class="st-select-option"
        :class="{ active: opt.value === modelValue }"
        @click="selectOption(opt)"
      >
        <span class="st-opt-label">{{ opt.label }}</span>
        <span v-if="opt.value === modelValue" class="st-opt-check">✓</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.st-select-wrap {
  position: relative;
  width: 100%;
}

.st-select-wrap.compact {
  width: auto;
  min-width: 168px;
}

.st-select-wrap.compact.pill {
  min-width: 108px;
}

.st-select-trigger {
  width: 100%;
  height: 36px;
  padding: 0 11px;
  border-radius: 9px;
  border: 1px solid var(--border-subtle);
  background: var(--input-bg);
  color: var(--text-primary);
  font: 500 12.5px var(--font-family);
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  text-align: left;
  transition: border-color var(--motion-fast), background var(--motion-fast), box-shadow var(--motion-fast);
}

.st-select-wrap.compact .st-select-trigger {
  height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.st-select-wrap.pill .st-select-trigger {
  border-radius: 999px;
  padding: 0 12px;
}

.st-select-wrap.compact.pill .st-select-trigger {
  height: 27px;
  padding: 0 10px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
}

.st-select-wrap.compact.pill .st-select-trigger:hover,
.st-select-wrap.compact.pill.open .st-select-trigger {
  color: var(--text-primary);
}

.st-select-trigger:hover {
  border-color: var(--border-strong);
  background: var(--fill-hover);
}

.st-select-wrap.open .st-select-trigger {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.st-select-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-select-caret {
  width: 12px;
  height: 12px;
  flex: none;
  color: var(--text-tertiary);
  transition: transform 0.16s ease, color 0.16s ease;
}

.st-select-wrap.open .st-select-caret {
  transform: rotate(180deg);
  color: var(--tide-text);
}

.st-select-menu {
  position: absolute;
  top: calc(100% + 6px);
  min-width: 100%;
  width: max-content;
  max-height: 240px;
  overflow-y: auto;
  z-index: var(--z-float, 80);
  padding: 5px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--surface-overlay);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: st-pour-in 0.14s cubic-bezier(0.16, 1, 0.3, 1);
}

.st-select-menu.align-left {
  left: 0;
}

.st-select-menu.align-right {
  right: 0;
}

@keyframes st-pour-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.st-select-option {
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font: 500 12px var(--font-family);
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  transition: background var(--motion-fast), color var(--motion-fast);
}

.st-opt-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-select-option:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

.st-select-option.active {
  background: var(--accent-soft);
  color: var(--tide-text);
  font-weight: 650;
}

.st-opt-check {
  flex: none;
  font-size: 11px;
  color: var(--tide-text);
}
</style>
