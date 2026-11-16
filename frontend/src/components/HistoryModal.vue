<script setup lang="ts">
import type { DeliveryRecord } from '../../bindings/agenda/internal/agenda/models';

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
  if (Number.isNaN(d.getTime())) return iso;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${m}-${day} ${h}:${min}:${sec}`;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'created': return '已创建';
    case 'completed': return '已完结';
    case 'expired': return '已过期';
    case 'paused': return '已暂停';
    case 'lead_notice':
    case 'lead_sent': return '提前预警';
    case 'muted_dnd': return '免打扰静默';
    case 'success': case 'sent': return '已触发';
    case 'failed': return '触发失败';
    default: return status || '已记录';
  }
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal-card st-reticle" role="dialog" aria-modal="true" aria-label="通知历史">
        <div class="modal-head">
          <div class="head-title">
            <h3 class="modal-title st-inline-icon">
              <span class="shanshui-seal" title="投递审计印">审</span>
              <span>投递审计记录</span>
            </h3>
            <span v-if="title" class="sub-title">日程: {{ title }}</span>
          </div>
          <button class="modal-close-btn" title="关闭" aria-label="关闭" @click="$emit('close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div class="history-content">
          <div v-if="loading" class="empty-history" aria-live="polite">
            <span class="history-pulse-dot" aria-hidden="true"></span>
            <p>正在加载投递记录…</p>
          </div>
          <div v-else-if="records.length === 0" class="empty-history">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15.5 14" />
            </svg>
            <p>暂无投递触发记录</p>
          </div>

        <div v-else class="timeline">
          <div v-for="rec in records" :key="rec.id" class="timeline-item" :class="{ 'is-failed': rec.status === 'failed' }">
            <div class="timeline-marker"></div>
            <div class="timeline-body">
              <div class="timeline-header">
                <span class="delivery-time tabular-nums">{{ formatDeliveryTime(rec.delivered_at) }}</span>
                <span class="delivery-badge" :class="rec.status">{{ getStatusLabel(rec.status) }}</span>
              </div>
              <p class="delivery-prompt">{{ rec.prompt || '已发送桌面通知' }}</p>
              <p v-if="rec.error" class="delivery-error">{{ rec.error }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-scrim);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-overlay);
}

.modal-card {
  width: 490px;
  max-width: 92vw;
  max-height: min(82vh, 620px);
  border-radius: 18px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.modal-title {
  margin: 0;
  font-size: 16px;
  font-weight: 750;
  color: var(--text-primary);
}

.sub-title {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.empty-history {
  padding: 36px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.history-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tide);
  box-shadow: 0 0 10px var(--tide);
  animation: history-pulse 1.2s ease-in-out infinite;
}

@keyframes history-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
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

.delivery-badge.success,
.delivery-badge.completed {
  background: color-mix(in srgb, var(--success, #10b981) 16%, transparent);
  border-color: color-mix(in srgb, var(--success, #10b981) 36%, transparent);
  color: var(--success, #10b981);
}

.delivery-badge.created {
  background: color-mix(in srgb, var(--tide, #46b7ff) 16%, transparent);
  border-color: color-mix(in srgb, var(--tide, #46b7ff) 36%, transparent);
  color: var(--tide-text, #46b7ff);
}

.delivery-badge.paused,
.delivery-badge.lead_sent {
  background: color-mix(in srgb, var(--warning, #f59e0b) 16%, transparent);
  border-color: color-mix(in srgb, var(--warning, #f59e0b) 36%, transparent);
  color: var(--warning, #f59e0b);
}

.delivery-badge.failed,
.delivery-badge.expired {
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
