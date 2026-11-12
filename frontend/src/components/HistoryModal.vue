<script setup lang="ts">
import type { DeliveryRecord } from '../../bindings/agenda-desktop/internal/agenda/models';

defineProps<{
  visible: boolean;
  title: string;
  records: DeliveryRecord[];
  loading?: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

function formatDeliveryTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${m}-${day} ${h}:${min}:${sec}`;
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card st-reticle" role="dialog" aria-modal="true" aria-label="通知历史">
      <div class="modal-head">
        <div class="head-title">
          <h3 class="modal-title">投递审计记录</h3>
          <span v-if="title" class="sub-title">日程: {{ title }}</span>
        </div>
        <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
      </div>

      <div class="history-content">
        <div v-if="loading" class="empty-history" aria-live="polite">
          <p>正在加载投递记录…</p>
        </div>
        <div v-else-if="records.length === 0" class="empty-history">
          <p>暂无投递触发记录</p>
        </div>

        <div v-else class="timeline">
          <div v-for="rec in records" :key="rec.id" class="timeline-item" :class="{ 'is-failed': rec.status !== 'success' }">
            <div class="timeline-marker"></div>
            <div class="timeline-body">
              <div class="timeline-header">
                <span class="delivery-time tabular-nums">{{ formatDeliveryTime(rec.delivered_at) }}</span>
                <span class="delivery-badge" :class="rec.status">{{ rec.status === 'success' ? '已触发' : '失败' }}</span>
              </div>
              <p class="delivery-prompt">{{ rec.prompt || '已发送桌面通知' }}</p>
              <p v-if="rec.error" class="delivery-error">{{ rec.error }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-card {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  border-radius: 16px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-lg);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.modal-title {
  font-size: 16px;
  font-weight: 750;
  color: var(--text-primary);
}

.sub-title {
  font-size: 12px;
  color: var(--text-muted);
}

.history-content {
  overflow-y: auto;
  max-height: 55vh;
  padding-right: 4px;
}

.empty-history {
  padding: 32px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.timeline {
  position: relative;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 6px 0;
}

.timeline::before {
  content: "";
  position: absolute;
  left: 3px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--accent-border);
}

.timeline-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.timeline-marker {
  position: absolute;
  left: -21px;
  top: 4px;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  transform: rotate(45deg);
  background: var(--tide);
  box-shadow: 0 0 8px color-mix(in srgb, var(--tide) 75%, transparent);
}

.timeline-item.is-failed .timeline-marker {
  background: var(--danger, #ef4444);
  box-shadow: 0 0 8px color-mix(in srgb, var(--danger, #ef4444) 75%, transparent);
}

.timeline-body {
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  padding: 10px 12px;
  border-radius: 10px;
}

.timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.delivery-time {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.delivery-badge {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 650;
  border: 1px solid var(--border-l1);
  background: var(--fill-subtle);
  color: var(--text-secondary);
}

.delivery-badge.success {
  background: color-mix(in srgb, var(--success, #10b981) 16%, transparent);
  border-color: color-mix(in srgb, var(--success, #10b981) 36%, transparent);
  color: var(--success, #10b981);
}

.delivery-badge:not(.success) {
  background: color-mix(in srgb, var(--danger, #ef4444) 16%, transparent);
  border-color: color-mix(in srgb, var(--danger, #ef4444) 36%, transparent);
  color: var(--danger, #ef4444);
}

.delivery-prompt {
  font-size: 12.5px;
  color: var(--text-primary);
  line-height: 1.45;
  word-break: break-word;
}

.delivery-error {
  margin-top: 5px;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--danger, #ef4444);
  word-break: break-word;
}
</style>
