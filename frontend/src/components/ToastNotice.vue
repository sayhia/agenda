<script setup lang="ts">
defineProps<{
  visible: boolean;
  message: string;
  type?: 'success' | 'error' | 'info';
  hasUndo?: boolean;
}>();

defineEmits<{
  (e: 'undo'): void;
}>();
</script>

<template>
  <Transition name="toast-slide">
    <div v-if="visible" class="toast-capsule" :class="type || 'info'" role="status" aria-live="polite">
    <div class="toast-icon">
      <svg v-if="type === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <svg v-else-if="type === 'error'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    </div>
    <span class="toast-text">{{ message }}</span>
    <button v-if="hasUndo" class="toast-undo-btn" @click="$emit('undo')">
      撤销
    </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast-capsule {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--surface-overlay);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-strong);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 550;
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  animation: toast-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-undo-btn {
  margin-left: 6px;
  font: 700 10.5px var(--font-mono);
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  cursor: pointer;
  transition: all 0.16s ease;
}

.toast-undo-btn:hover {
  background: var(--tide);
  border-color: var(--tide);
  color: var(--ink-on-accent);
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.toast-capsule.success {
  border-color: color-mix(in srgb, var(--success) 42%, transparent);
}
.toast-capsule.success .toast-icon {
  color: var(--success);
}

.toast-capsule.error {
  border-color: color-mix(in srgb, var(--danger) 42%, transparent);
}
.toast-capsule.error .toast-icon {
  color: var(--danger);
}

.toast-capsule.info .toast-icon {
  color: var(--tide-text);
}

.toast-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
