<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Events } from '@wailsio/runtime';
import {
  CloseDesktopWindow,
  GetReminders,
  OpenDesktopWindow,
  SetDesktopWindowAlwaysOnTop,
} from '../../../bindings/agenda/internal/agenda/agendaservice';
import type { Reminder } from '../../../bindings/agenda/internal/agenda/models';
import { executeAIAction } from '../../utils/aiActionExecutor';
import type { ActionItem } from '../../utils/aiAction';
import AIAssistantDrawer from '../AIAssistantDrawer.vue';
import DesktopIcon from '../DesktopIcon.vue';
import ToastNotice from '../ToastNotice.vue';

const reminders = ref<Reminder[]>([]);
const alwaysOnTop = ref(false);
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform);

const toastVisible = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error' | 'info'>('info');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribeEvents: Array<() => void> = [];

const overdueCount = computed(() => {
  const now = Date.now();
  return reminders.value.filter(
    (r) => r.status === 'expired' || (r.status === 'active' && new Date(r.scheduled_at).getTime() < now),
  ).length;
});

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  clearTimeout(toastTimer);
  toastMessage.value = msg;
  toastType.value = type;
  toastVisible.value = true;
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2600);
}

async function loadReminders() {
  try {
    reminders.value = (await GetReminders()) || [];
  } catch {
    // Ignore transient failures.
  }
}

async function toggleAlwaysOnTop() {
  const next = !alwaysOnTop.value;
  alwaysOnTop.value = next;
  await SetDesktopWindowAlwaysOnTop('ai', next);
  showToast(next ? '已置顶 AI 窗口' : '已取消 AI 窗口置顶', 'info');
}

async function handleApplyAction(action: any) {
  try {
    const msg = await executeAIAction(action, reminders.value, loadReminders);
    if (msg) showToast(msg, 'success');
  } catch (err: any) {
    showToast(`执行失败: ${err?.message || err}`, 'error');
  }
}

async function handleEditAction(action: ActionItem) {
  await OpenDesktopWindow('main', '');
  void Events.Emit('open-ai-action-draft', JSON.stringify(action));
  showToast(`已切换至主窗口编辑「${action.title || '日程'}」`, 'info');
}

async function handleOpenSettings() {
  await OpenDesktopWindow('main', '');
  void Events.Emit('open-settings-tab', 'ai');
}

onMounted(async () => {
  await loadReminders();
  unsubscribeEvents.push(
    Events.On('reminders-updated', () => { void loadReminders(); }),
  );
});

onUnmounted(() => {
  clearTimeout(toastTimer);
  unsubscribeEvents.splice(0).forEach((u) => u());
});
</script>

<template>
  <div class="ai-win-shell" :class="{ 'is-mac': isMac }">
    <header class="ai-win-titlebar">
      <div class="titlebar-copy">
        <span class="titlebar-badge"><DesktopIcon name="sparkle" :size="14" /></span>
        <strong>AI 智能副驾驶 · 独立窗口</strong>
      </div>
      <div class="titlebar-actions">
        <button
          type="button"
          class="win-btn"
          :class="{ active: alwaysOnTop }"
          :title="alwaysOnTop ? '已置顶（点击取消）' : '置顶窗口'"
          @click="toggleAlwaysOnTop"
        >
          <DesktopIcon name="pin" :size="12" />
        </button>
        <button type="button" class="win-btn" title="打开主工作台" @click="OpenDesktopWindow('main', '')">
          <span>主窗口</span>
          <DesktopIcon name="popout" :size="11" />
        </button>
        <button type="button" class="win-btn" title="关闭窗口" @click="CloseDesktopWindow('ai')">
          <DesktopIcon name="close" :size="12" />
        </button>
      </div>
    </header>

    <div class="ai-win-content">
      <AIAssistantDrawer
        :visible="true"
        :standalone="true"
        :reminders="reminders"
        :overdueCount="overdueCount"
        @apply-action="handleApplyAction"
        @edit-action="handleEditAction"
        @open-settings="handleOpenSettings"
      />
    </div>

    <ToastNotice
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      :hasUndo="false"
    />
  </div>
</template>

<style scoped>
.ai-win-shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  color: var(--text-primary);
  overflow: hidden;
}

.ai-win-titlebar {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  --wails-draggable: drag;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.ai-win-shell.is-mac .ai-win-titlebar {
  padding-left: 78px;
}

.titlebar-copy {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
}

.titlebar-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  --wails-draggable: no-drag;
  -webkit-app-region: no-drag;
}

.win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  min-width: 24px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
}

.win-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.win-btn.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}

.ai-win-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
