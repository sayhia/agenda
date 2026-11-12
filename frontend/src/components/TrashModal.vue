<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  GetTrashReminders,
  RestoreReminder,
  PermanentDelete,
  EmptyTrash,
} from '../../bindings/agenda/internal/agenda/agendaservice';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { formatTime, formatDateLabel } from '../utils/format';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'restored'): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
}>();

const trashList = ref<Reminder[]>([]);
const isLoading = ref(false);
const actionId = ref<string | null>(null);
const confirmDeleteId = ref<string | null>(null);
const confirmEmpty = ref(false);
const isEmptying = ref(false);

async function loadTrash() {
  isLoading.value = true;
  try {
    const res = await GetTrashReminders();
    trashList.value = res || [];
  } catch (err: any) {
    emit('toast', `加载废纸篓失败: ${err.message || err}`, 'error');
  } finally {
    isLoading.value = false;
  }
}

async function handleRestore(id: string) {
  if (actionId.value) return;
  actionId.value = id;
  try {
    await RestoreReminder(id);
    emit('toast', '日程已还原', 'success');
    await loadTrash();
    emit('restored');
  } catch (err: any) {
    emit('toast', `还原失败: ${err.message || err}`, 'error');
  } finally {
    actionId.value = null;
  }
}

async function handlePermanentDelete(id: string) {
  if (confirmDeleteId.value !== id) {
    confirmDeleteId.value = id;
    return;
  }
  if (actionId.value) return;
  actionId.value = id;
  confirmDeleteId.value = null;
  try {
    await PermanentDelete(id);
    emit('toast', '日程已永久删除', 'info');
    await loadTrash();
  } catch (err: any) {
    emit('toast', `删除失败: ${err.message || err}`, 'error');
  } finally {
    actionId.value = null;
  }
}

async function handleEmptyTrash() {
  if (!trashList.value.length || isEmptying.value) return;
  if (!confirmEmpty.value) {
    confirmEmpty.value = true;
    return;
  }
  confirmEmpty.value = false;
  isEmptying.value = true;
  try {
    await EmptyTrash();
    emit('toast', '已永久清空废纸篓', 'success');
    await loadTrash();
  } catch (err: any) {
    emit('toast', `清空失败: ${err.message || err}`, 'error');
  } finally {
    isEmptying.value = false;
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      confirmDeleteId.value = null;
      confirmEmpty.value = false;
      void loadTrash();
    }
  }
);
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="trash-card st-reticle" role="dialog" aria-modal="true" aria-label="废纸篓">
      <div class="card-head">
        <div class="head-left">
          <div class="vault-signal" aria-hidden="true"><span></span></div>
          <div>
            <span class="head-eyebrow">QUARANTINE VAULT</span>
            <h3 class="head-title">废纸篓 · 已删除日程 <span class="count-pill tabular-nums">{{ trashList.length }} 项</span></h3>
          </div>
        </div>
        <div class="head-right">
          <button
            v-if="trashList.length > 0"
            class="empty-btn"
            :class="{ confirming: confirmEmpty }"
            :disabled="isEmptying"
            :title="confirmEmpty ? '再次点击确认永久清空' : '永久清空全部'"
            @click="handleEmptyTrash"
          >
            {{ isEmptying ? '清空中…' : confirmEmpty ? '确认永久清空' : '清空废纸篓' }}
          </button>
          <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
        </div>
      </div>

      <div class="trash-body">
        <div v-if="trashList.length === 0" class="empty-state">
          <span class="empty-icon">—</span>
          <p>废纸篓空空如也，无已删除日程</p>
        </div>

        <div v-for="r in trashList" :key="r.id" class="trash-item">
          <div class="item-left">
            <div class="title-row">
              <span class="task-title">{{ r.title }}</span>
              <span class="pri-tag" :class="[`pri-${r.priority || 'p2'}`]">
                {{ (r.priority || 'P2').toUpperCase() }}
              </span>
            </div>
            <div class="meta-row">
              <span class="time-hint tabular-nums">{{ formatDateLabel(r.scheduled_at).label }} {{ formatTime(r.scheduled_at) }}</span>
              <span v-if="r.notes" class="notes-hint">· {{ r.notes }}</span>
            </div>
          </div>

          <div class="item-actions">
            <button class="action-btn restore-btn" :disabled="Boolean(actionId)" title="还原回待办列表" @click="handleRestore(r.id)">
              {{ actionId === r.id ? '处理中…' : '还原' }}
            </button>
            <button class="action-btn perm-delete-btn" :class="{ confirming: confirmDeleteId === r.id }" :disabled="Boolean(actionId)" :title="confirmDeleteId === r.id ? '再次点击确认永久删除' : '永久删除'" @click="handlePermanentDelete(r.id)">
              {{ confirmDeleteId === r.id ? '确认删除' : '永久删除' }}
            </button>
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
  background: rgba(3, 5, 8, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
}

.trash-card {
  position: relative;
  width: 580px;
  max-width: 92vw;
  max-height: 82vh;
  border-radius: 18px;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(65% 45% at 100% 0%, color-mix(in srgb, var(--danger) 8%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.head-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vault-signal {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
}

.vault-signal span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 8px var(--danger);
}

.head-eyebrow {
  display: block;
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--danger);
}

.head-title {
  margin: 2px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15.5px;
  font-weight: 750;
  color: var(--text-primary);
}

.count-pill {
  font: 700 10px var(--font-mono);
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
}

.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.empty-btn {
  height: 28px;
  font-size: 11px;
  font-weight: 650;
  padding: 0 11px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
  color: var(--danger);
  cursor: pointer;
  transition: all 0.16s ease;
}

.empty-btn:hover {
  background: color-mix(in srgb, var(--danger) 20%, transparent);
}

.trash-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
  padding-right: 4px;
}

.trash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 14px;
  border-radius: 11px;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.trash-item:hover {
  border-color: var(--border-strong);
  background: var(--fill-hover);
}

.item-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pri-tag {
  font: 700 9.5px var(--font-mono);
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.pri-tag.pri-p0 {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 32%, transparent);
}
.pri-tag.pri-p1 {
  background: color-mix(in srgb, var(--lime) 14%, transparent);
  color: var(--lime-strong);
  border-color: color-mix(in srgb, var(--lime) 34%, transparent);
}
.pri-tag.pri-p2 {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: var(--accent-border);
}
.pri-tag.pri-p3 {
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  border-color: var(--border-subtle);
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}

.notes-hint {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  height: 27px;
  font-size: 11px;
  font-weight: 650;
  padding: 0 11px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.restore-btn {
  background: color-mix(in srgb, var(--success) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 34%, transparent);
  color: var(--success);
}

.restore-btn:hover {
  background: var(--success);
  color: var(--ink-on-success);
}

.perm-delete-btn {
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.perm-delete-btn:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  border-color: color-mix(in srgb, var(--danger) 34%, transparent);
  color: var(--danger);
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--text-tertiary);
  font-size: 12.5px;
}

.empty-icon {
  font: 400 22px var(--font-mono);
  display: block;
  margin-bottom: 6px;
}
</style>
