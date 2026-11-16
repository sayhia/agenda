<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
const trashSearch = ref('');

const filteredTrashList = computed(() => {
  const q = trashSearch.value.trim().toLowerCase();
  if (!q) return trashList.value;
  return trashList.value.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q) ||
      (r.tags || '').toLowerCase().includes(q),
  );
});

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
    emit('restored');
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
    emit('restored');
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
      trashSearch.value = '';
      void loadTrash();
    }
  }
);
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="trash-card st-reticle" role="dialog" aria-modal="true" aria-label="废纸篓">
      <div class="card-head">
        <div class="head-left">
          <div class="vault-signal" aria-hidden="true"><span></span></div>
          <div>
            <span class="head-eyebrow">QUARANTINE VAULT · 尘匣暂存</span>
            <h3 class="head-title">废纸篓 · 已删除日程 <span class="shanshui-seal" title="尘匣印章">藏</span> <span class="count-pill tabular-nums">{{ trashList.length }} 项</span></h3>
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
          <button class="modal-close-btn" title="关闭" aria-label="关闭" @click="$emit('close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div v-if="trashList.length > 0" class="trash-search-row">
        <svg class="trash-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          v-model="trashSearch"
          type="text"
          class="trash-search-input"
          placeholder="搜索已删除日程标题、备注或标签…"
        />
        <button v-if="trashSearch" type="button" class="trash-search-clear" title="清空搜索" aria-label="清空搜索" @click="trashSearch = ''">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="trash-body">
        <div v-if="trashList.length === 0" class="empty-state">
          <span class="shanshui-seal baiwen" aria-hidden="true">净</span>
          <p>纸静砚空，凡所过往皆无残留</p>
        </div>
        <div v-else-if="filteredTrashList.length === 0" class="empty-state">
          <span class="empty-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
          </span>
          <p>未找到匹配的已删除日程</p>
        </div>

        <div v-for="r in filteredTrashList" :key="r.id" class="trash-item">
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
            <button class="action-btn restore-btn st-inline-icon" :disabled="Boolean(actionId)" title="还原回待办列表" @click="handleRestore(r.id)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>{{ actionId === r.id ? '处理中…' : '还原' }}</span>
            </button>
            <button class="action-btn perm-delete-btn st-inline-icon" :class="{ confirming: confirmDeleteId === r.id }" :disabled="Boolean(actionId)" :title="confirmDeleteId === r.id ? '再次点击确认永久删除' : '永久删除'" @click="handlePermanentDelete(r.id)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>{{ confirmDeleteId === r.id ? '确认删除' : '永久删除' }}</span>
            </button>
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
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-overlay);
}

.trash-card {
  position: relative;
  width: 590px;
  max-width: 92vw;
  max-height: min(84vh, 660px);
  border-radius: 18px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  background:
    radial-gradient(65% 45% at 100% 0%, color-mix(in srgb, var(--danger) 8%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
}

.card-head {
  flex: none;
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
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.trash-search-row {
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
}

.trash-search-icon {
  position: absolute;
  left: 10px;
  color: var(--text-quaternary);
  pointer-events: none;
}

.trash-search-input {
  width: 100%;
  height: 34px;
  padding: 0 30px 0 30px;
  border-radius: 9px;
  border: 1px solid var(--border-subtle);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 12.5px;
  outline: none;
}

.trash-search-input:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.trash-search-clear {
  position: absolute;
  right: 7px;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  background: var(--fill-hover);
  color: var(--text-tertiary);
  cursor: pointer;
}

.trash-search-clear:hover {
  color: var(--text-primary);
}
</style>
