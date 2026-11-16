<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Events } from '@wailsio/runtime';
import {
  AddReminder,
  CloseDesktopWindow,
  GetDesktopRuntimeStatus,
  GetReminders,
  OpenDesktopWindow,
  SendMorningBriefingNow,
  SetSchedulerPaused,
  SetTrayPopoverPinned,
  SnoozeAllOverdue,
  SnoozeReminder,
  TogglePinReminder,
  TriggerOpenInMain,
  UpdateReminder,
  UpdateSubtasks,
} from '../../../bindings/agenda/internal/agenda/agendaservice';
import type { DesktopRuntimeStatus, Reminder } from '../../../bindings/agenda/internal/agenda/models';
import { parseReminderSubtasks, toUpdateReminderRequest } from '../../domain/reminder';
import { formatTime } from '../../utils/format';
import { parseNaturalReminder } from '../../utils/nlp';
import { getChineseShichen } from '../../utils/shanshui';
import {
  bindFocusReminder,
  focusDisplayClock,
  focusEngineState,
  hasLiveFocusActivity,
  initFocusEngine,
  stopFocusEngine,
  toggleFocusTimer,
} from '../../utils/focusEngine';
import DesktopIcon from '../DesktopIcon.vue';
import ToastNotice from '../ToastNotice.vue';

const reminders = ref<Reminder[]>([]);
const runtimeStatus = ref<DesktopRuntimeStatus | null>(null);
const isPinned = ref(false);
const activeTab = ref<'todo' | 'done'>('todo');
const filterScope = ref<'all' | 'overdue' | 'priority'>('all');
const searchQuery = ref('');
const quickInput = ref('');
const isSubmitting = ref(false);
const expandedSubtaskId = ref<string | null>(null);
const activeIdx = ref(-1);
const nowTick = ref(Date.now());

const toastVisible = ref(false);
const toastMessage = ref('');
const toastType = ref<'success' | 'error' | 'info'>('info');
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let unsubscribeEvents: Array<() => void> = [];

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  clearTimeout(toastTimer);
  toastMessage.value = msg;
  toastType.value = type;
  toastVisible.value = true;
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2400);
}

async function loadAll() {
  try {
    const [list, status] = await Promise.all([GetReminders(), GetDesktopRuntimeStatus()]);
    reminders.value = list || [];
    runtimeStatus.value = status;
  } catch {
    // Ignore transient errors.
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform);
const quickAddShortcutLabel = computed(() => {
  const raw = (runtimeStatus.value?.preferences?.quick_add_hotkey || 'CmdOrCtrl+Alt+A').trim();
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  if (isMac) {
    return parts
      .map((p) => {
        const lower = p.toLowerCase();
        if (lower === 'cmdorctrl' || lower === 'cmd' || lower === 'command') return '⌘';
        if (lower === 'alt' || lower === 'option') return '⌥';
        if (lower === 'shift') return '⇧';
        if (lower === 'ctrl' || lower === 'control') return '⌃';
        return p.toUpperCase();
      })
      .join('');
  }
  return parts
    .map((p) => (p.toLowerCase() === 'cmdorctrl' ? 'Ctrl' : p))
    .join('+');
});

const todayDateKey = computed(() => {
  const d = new Date(nowTick.value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isPastDue(r: Reminder): boolean {
  if (r.status === 'expired') return true;
  if (r.status !== 'active') return false;
  const t = new Date(r.scheduled_at).getTime();
  return Number.isFinite(t) && t < nowTick.value;
}

const headerStamp = computed(() => {
  const d = new Date(nowTick.value);
  const dateText = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short' }).format(d);
  const shichen = getChineseShichen(d);
  return `${dateText} · ${shichen.branch}时(${shichen.alias})`;
});

const baseTodoItems = computed(() => {
  const now = nowTick.value;
  const today = todayDateKey.value;
  return reminders.value
    .filter((r) => {
      if (r.status === 'expired') return true;
      if (r.status !== 'active') return false;
      const key = dateKeyOf(r.scheduled_at);
      const ts = new Date(r.scheduled_at).getTime();
      return key === today || (Number.isFinite(ts) && ts < now);
    })
    .sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      const aPast = isPastDue(a);
      const bPast = isPastDue(b);
      if (aPast !== bPast) return aPast ? -1 : 1;
      return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
    });
});

const todoItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return baseTodoItems.value.filter((r) => {
    if (filterScope.value === 'overdue' && !isPastDue(r)) return false;
    if (filterScope.value === 'priority' && r.priority !== 'p0' && r.priority !== 'p1') return false;
    if (q && !r.title.toLowerCase().includes(q) && !r.tags.toLowerCase().includes(q)) return false;
    return true;
  });
});

const upcomingLaterItems = computed(() => {
  const today = todayDateKey.value;
  return reminders.value
    .filter((r) => r.status === 'active' && dateKeyOf(r.scheduled_at) > today)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    .slice(0, 4);
});

const doneTodayItems = computed(() => {
  const today = todayDateKey.value;
  const q = searchQuery.value.trim().toLowerCase();
  return reminders.value
    .filter((r) => {
      if (r.status !== 'ended') return false;
      if (dateKeyOf(r.updated_at) !== today && dateKeyOf(r.scheduled_at) !== today) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
});

const overdueCount = computed(() => baseTodoItems.value.filter(isPastDue).length);
const isSchedulerPaused = computed(() => Boolean(runtimeStatus.value?.scheduler?.paused));
const pausedRemainingLabel = computed(() => {
  const sec = runtimeStatus.value?.scheduler?.paused_remaining_sec || 0;
  if (sec <= 0) return '';
  const mins = Math.ceil(sec / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  return `${mins}m`;
});
const quickInputRef = ref<HTMLInputElement | null>(null);
const miniSearchInputRef = ref<HTMLInputElement | null>(null);
const isDndActive = computed(() => Boolean(runtimeStatus.value?.scheduler?.dnd_active));

function getSubtasks(r: Reminder) {
  return parseReminderSubtasks(r.subtasks);
}

async function toggleSubtaskDone(r: Reminder, subIndex: number) {
  const subs = parseReminderSubtasks(r.subtasks);
  if (!subs[subIndex]) return;
  subs[subIndex] = { ...subs[subIndex], done: !subs[subIndex].done };
  try {
    await UpdateSubtasks(r.id, JSON.stringify(subs));
    await loadAll();
  } catch (err: any) {
    showToast(`更新子任务失败: ${err?.message || err}`, 'error');
  }
}

async function togglePinWindow() {
  const next = !isPinned.value;
  isPinned.value = next;
  await SetTrayPopoverPinned(next);
  showToast(next ? '已固定浮窗，失去焦点不自动收起' : '已取消固定，点击外部自动收起', 'info');
}

async function handleTogglePause() {
  try {
    await SetSchedulerPaused(!isSchedulerPaused.value);
    await loadAll();
    showToast(isSchedulerPaused.value ? '已暂停后台提醒守护' : '已恢复后台提醒守护', 'info');
  } catch (err: any) {
    showToast(`操作失败: ${err?.message || err}`, 'error');
  }
}

async function handleSnoozeAllOverdue() {
  try {
    const count = await SnoozeAllOverdue(15);
    await loadAll();
    showToast(count > 0 ? `已将 ${count} 项逾期日程统一顺延 15 分钟` : '暂无逾期日程需要顺延', 'success');
  } catch (err: any) {
    showToast(`批量顺延失败: ${err?.message || err}`, 'error');
  }
}

async function handleQuickCapture() {
  const text = quickInput.value.trim();
  if (!text || isSubmitting.value) return;
  isSubmitting.value = true;
  try {
    const parsed = parseNaturalReminder(text);
    const leadDefault = Number(localStorage.getItem('agenda_default_lead') || 10);
    await AddReminder({
      title: parsed.title || text,
      scheduled_at: parsed.scheduledAt,
      repeat_rule: parsed.repeatRule,
      lead_minutes: leadDefault,
      notes: '',
      duration_minutes: parsed.durationMinutes || 30,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      prompt: '',
      priority: parsed.priority || 'p2',
      tags: parsed.tags || '',
      subtasks: '',
      is_pinned: false,
    });
    quickInput.value = '';
    await loadAll();
    showToast(`已添加「${parsed.title || text}」`, 'success');
  } catch (err: any) {
    showToast(`添加失败: ${err?.message || err}`, 'error');
  } finally {
    isSubmitting.value = false;
  }
}

async function completeItem(r: Reminder) {
  try {
    await UpdateReminder(toUpdateReminderRequest(r, { status: r.status === 'ended' ? 'active' : 'ended' }));
    await loadAll();
    showToast(r.status === 'ended' ? '已恢复为待办' : `已完成「${r.title}」`, 'success');
  } catch (err: any) {
    showToast(`操作失败: ${err?.message || err}`, 'error');
  }
}

async function toggleReminderPin(r: Reminder) {
  try {
    await TogglePinReminder(r.id);
    await loadAll();
  } catch (err: any) {
    showToast(`置顶操作失败: ${err?.message || err}`, 'error');
  }
}

async function snoozeItem(r: Reminder, minutes: number) {
  try {
    await SnoozeReminder(r.id, minutes);
    await loadAll();
    showToast(`已推迟 ${minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`}`, 'info');
  } catch (err: any) {
    showToast(`推迟失败: ${err?.message || err}`, 'error');
  }
}

async function focusOnItem(r: Reminder) {
  bindFocusReminder(r, true);
  await OpenDesktopWindow('focus', '');
}

async function sendBriefing() {
  try {
    const summary = await SendMorningBriefingNow();
    showToast(summary || '已发送今日简报通知', 'success');
  } catch (err: any) {
    showToast(`发送失败: ${err?.message || err}`, 'error');
  }
}

async function openDesktopSettings() {
  await OpenDesktopWindow('main', '');
  void Events.Emit('open-settings-tab', 'desktop');
}

function handleKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (e.key === 'Escape' && !isPinned.value) {
    e.preventDefault();
    void CloseDesktopWindow('tray-popover');
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    miniSearchInputRef.value?.focus();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    quickInputRef.value?.focus();
    return;
  }
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === '/') {
    e.preventDefault();
    miniSearchInputRef.value?.focus();
    return;
  }
  const list = activeTab.value === 'todo' ? todoItems.value : doneTodayItems.value;
  if (!list.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIdx.value = (activeIdx.value + 1) % list.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx.value = (activeIdx.value - 1 + list.length) % list.length;
  } else if (e.key === 'Enter' && activeIdx.value >= 0 && list[activeIdx.value]) {
    e.preventDefault();
    void completeItem(list[activeIdx.value]);
  }
}

onMounted(async () => {
  initFocusEngine(showToast);
  await loadAll();
  tickTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 15_000);
  window.addEventListener('keydown', handleKeydown);
  unsubscribeEvents.push(
    Events.On('reminders-updated', () => { void loadAll(); }),
    Events.On('desktop-status-updated', () => { void loadAll(); }),
    Events.On('common:WindowShow', () => { void loadAll(); }),
  );
});

onUnmounted(() => {
  clearTimeout(toastTimer);
  if (tickTimer) clearInterval(tickTimer);
  window.removeEventListener('keydown', handleKeydown);
  unsubscribeEvents.splice(0).forEach((u) => u());
  stopFocusEngine();
});
</script>

<template>
  <div class="popover-shell">
    <!-- Top Header -->
    <header class="popover-header">
      <div class="popover-brand">
        <img src="/icon.svg" alt="" class="brand-icon" />
        <div class="brand-copy">
          <strong>今日速览</strong>
          <span>{{ headerStamp }}</span>
        </div>
      </div>

      <div class="popover-tools">
        <button type="button" class="tool-btn" :title="`快速新建浮窗 (${quickAddShortcutLabel})`" @click="OpenDesktopWindow('quick-add', '')">
          <DesktopIcon name="bolt" :size="13" />
        </button>
        <button type="button" class="tool-btn" title="独立番茄专注浮窗" @click="OpenDesktopWindow('focus', '')">
          <DesktopIcon name="timer" :size="13" />
        </button>
        <button type="button" class="tool-btn" title="独立 AI 助手窗口" @click="OpenDesktopWindow('ai', '')">
          <DesktopIcon name="sparkle" :size="13" />
        </button>
        <button
          type="button"
          class="tool-btn"
          :class="{ active: isPinned }"
          :title="isPinned ? '已固定（点击取消）' : '固定浮窗在桌面'"
          @click="togglePinWindow"
        >
          <DesktopIcon name="pin" :size="13" />
        </button>
        <button type="button" class="tool-main-btn" title="打开主工作台" @click="OpenDesktopWindow('main', '')">主窗口</button>
      </div>
    </header>

    <!-- Daemon & Focus Live Status Strip -->
    <div class="status-strip">
      <button
        type="button"
        class="daemon-pill"
        :class="{ paused: isSchedulerPaused }"
        :title="isSchedulerPaused ? '点击恢复后台提醒守护' : '点击暂停后台提醒守护'"
        @click="handleTogglePause"
      >
        <i class="status-dot"></i>
        <span>{{ isSchedulerPaused ? (pausedRemainingLabel ? `暂停中 ${pausedRemainingLabel}` : '后台已暂停') : '后台守护中' }}</span>
      </button>

      <span v-if="isDndActive" class="dnd-badge">
        <DesktopIcon name="moon" :size="11" />
        <span>免打扰</span>
      </span>

      <button
        v-if="overdueCount > 0"
        type="button"
        class="snooze-all-pill"
        title="将所有逾期日程统一推迟 15 分钟"
        @click="handleSnoozeAllOverdue"
      >
        <DesktopIcon name="clock-snooze" :size="11" />
        <span>逾期顺延 +15m ({{ overdueCount }})</span>
      </button>

      <div v-if="hasLiveFocusActivity" class="focus-mini-pill" @click="OpenDesktopWindow('focus', '')">
        <span class="focus-mini-clock tabular-nums">
          <DesktopIcon :name="focusEngineState.mode === 'focus' ? 'timer' : 'coffee'" :size="11" />
          <span>{{ focusDisplayClock }}</span>
        </span>
        <button type="button" class="focus-mini-btn" @click.stop="toggleFocusTimer">
          <DesktopIcon :name="focusEngineState.isRunning ? 'pause' : 'play'" :size="10" :strokeWidth="2.1" />
        </button>
      </div>
    </div>

    <!-- Inline Quick Capture -->
    <form class="popover-quick-form" @submit.prevent="handleQuickCapture">
      <input
        ref="quickInputRef"
        v-model="quickInput"
        type="text"
        class="popover-quick-input"
        placeholder="快速记录 (⌘N)：如 15分钟后 喝水 / 明早9点 晨会..."
        :disabled="isSubmitting"
      />
      <button type="submit" class="popover-quick-submit" :disabled="!quickInput.trim() || isSubmitting">+</button>
    </form>

    <!-- Tabs + Search/Scope Filter -->
    <div class="popover-controls-bar">
      <div class="popover-tabs">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'todo' }"
          @click="activeTab = 'todo'; activeIdx = -1"
        >
          <span>待处理</span>
          <em class="tab-count" :class="{ warn: overdueCount > 0 }">{{ baseTodoItems.length }}</em>
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'done' }"
          @click="activeTab = 'done'; activeIdx = -1"
        >
          <span>已完成</span>
          <em class="tab-count">{{ doneTodayItems.length }}</em>
        </button>
      </div>

      <div v-if="activeTab === 'todo'" class="scope-row">
        <div class="scope-chips">
          <button type="button" class="scope-chip" :class="{ active: filterScope === 'all' }" @click="filterScope = 'all'">全部</button>
          <button type="button" class="scope-chip" :class="{ active: filterScope === 'overdue' }" @click="filterScope = 'overdue'">逾期</button>
          <button type="button" class="scope-chip" :class="{ active: filterScope === 'priority' }" @click="filterScope = 'priority'">重要</button>
        </div>
        <input
          ref="miniSearchInputRef"
          v-model="searchQuery"
          type="search"
          class="mini-search-input"
          placeholder="筛选 (⌘K / /)..."
          aria-label="筛选今日日程"
        />
      </div>
    </div>

    <!-- Reminders Scroll List -->
    <main class="popover-list">
      <template v-if="activeTab === 'todo'">
        <div v-if="todoItems.length === 0" class="empty-box">
          <p>{{ searchQuery || filterScope !== 'all' ? '无匹配待办事项' : '今日待办已全部清零' }}</p>
          <small v-if="upcomingLaterItems.length > 0 && !searchQuery && filterScope === 'all'">
            接下来几天还有 {{ upcomingLaterItems.length }} 项排期
          </small>
        </div>

        <article
          v-for="(item, idx) in todoItems"
          :key="item.id"
          class="pop-item"
          :class="{ overdue: isPastDue(item), 'kb-active': idx === activeIdx }"
          @mouseenter="activeIdx = idx"
        >
          <div class="pop-item-main">
            <button
              type="button"
              class="item-check"
              title="标记完成"
              @click="completeItem(item)"
            ></button>

            <div class="item-body" @click="TriggerOpenInMain(item.id)">
              <div class="item-title-row">
                <span class="prio-dot" :class="item.priority"></span>
                <strong class="item-title">{{ item.title }}</strong>
              </div>
              <div class="item-meta">
                <span class="item-time tabular-nums">{{ formatTime(item.scheduled_at) }}</span>
                <span v-if="isPastDue(item)" class="overdue-pill">已逾期</span>
                <span v-if="item.repeat_rule" class="repeat-pill">循环</span>
                <button
                  v-if="getSubtasks(item).length > 0"
                  type="button"
                  class="subtask-badge"
                  @click.stop="expandedSubtaskId = expandedSubtaskId === item.id ? null : item.id"
                >
                  <DesktopIcon name="check" :size="10" />
                  <span>{{ getSubtasks(item).filter(s => s.done).length }}/{{ getSubtasks(item).length }}</span>
                </button>
              </div>
            </div>

            <div class="item-actions">
              <button
                type="button"
                class="act-btn"
                :class="{ pinned: item.is_pinned }"
                title="置顶/取消置顶"
                @click="toggleReminderPin(item)"
              >
                <DesktopIcon name="pin" :size="11" />
              </button>
              <button type="button" class="act-btn" title="推迟 10 分钟" @click="snoozeItem(item, 10)">+10m</button>
              <button type="button" class="act-btn" title="推迟 1 小时" @click="snoozeItem(item, 60)">+1h</button>
              <button type="button" class="act-btn" title="开始番茄专注" @click="focusOnItem(item)">
                <DesktopIcon name="timer" :size="11" />
              </button>
            </div>
          </div>

          <div v-if="expandedSubtaskId === item.id && getSubtasks(item).length > 0" class="subtasks-drawer">
            <label
              v-for="(sub, sIdx) in getSubtasks(item)"
              :key="sIdx"
              class="subtask-row"
            >
              <input type="checkbox" :checked="sub.done" @change="toggleSubtaskDone(item, sIdx)" />
              <span :class="{ done: sub.done }">{{ sub.title }}</span>
            </label>
          </div>
        </article>

        <div v-if="upcomingLaterItems.length > 0 && !searchQuery && filterScope === 'all'" class="upcoming-section">
          <div class="section-label">近期预告</div>
          <div
            v-for="up in upcomingLaterItems"
            :key="up.id"
            class="upcoming-row"
            @click="TriggerOpenInMain(up.id)"
          >
            <span class="up-title">{{ up.title }}</span>
            <span class="up-time tabular-nums">{{ dateKeyOf(up.scheduled_at).slice(5) }} {{ formatTime(up.scheduled_at) }}</span>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="doneTodayItems.length === 0" class="empty-box">
          <p>今日尚无已完结日程</p>
        </div>
        <article v-for="item in doneTodayItems" :key="item.id" class="pop-item done">
          <div class="pop-item-main">
            <button
              type="button"
              class="item-check checked"
              title="恢复为待办"
              @click="completeItem(item)"
            >
              <DesktopIcon name="check" :size="10" :strokeWidth="2.4" />
            </button>
            <div class="item-body" @click="TriggerOpenInMain(item.id)">
              <strong class="item-title">{{ item.title }}</strong>
              <div class="item-meta">
                <span class="item-time tabular-nums">{{ formatTime(item.scheduled_at) }}</span>
              </div>
            </div>
          </div>
        </article>
      </template>
    </main>

    <!-- Footer -->
    <footer class="popover-footer">
      <span class="footer-stats">
        今日 {{ baseTodoItems.length }} 待办
        <template v-if="overdueCount > 0"> · <b class="warn-text">{{ overdueCount }} 逾期</b></template>
      </span>
      <div class="footer-btns">
        <button type="button" class="footer-link-btn" @click="sendBriefing">发送早报</button>
        <button type="button" class="footer-link-btn" @click="openDesktopSettings">后台设置</button>
      </div>
    </footer>

    <ToastNotice
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      :hasUndo="false"
    />
  </div>
</template>

<style scoped>
.popover-shell {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--app-bg) 94%, transparent);
  color: var(--text-primary);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}

.popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 12px 9px;
  border-bottom: 1px solid var(--border-subtle);
  --wails-draggable: drag;
  -webkit-app-region: drag;
}

.popover-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.brand-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.brand-copy strong {
  font-size: 13px;
  font-weight: 750;
  line-height: 1.2;
}

.brand-copy span {
  font-size: 10.5px;
  color: var(--text-quaternary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.popover-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  --wails-draggable: no-drag;
  -webkit-app-region: no-drag;
}

.tool-btn {
  width: 25px;
  height: 25px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.tool-btn:hover {
  border-color: var(--border-strong);
  background: var(--fill-hover);
}

.tool-btn.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.tool-main-btn {
  height: 25px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.status-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface);
  flex-wrap: wrap;
}

.daemon-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;
}

.daemon-pill.paused {
  border-color: color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.dnd-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
}

.snooze-all-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
}

.focus-mini-pill {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 4px 0 8px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.focus-mini-clock {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.focus-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: none;
  background: var(--tide);
  color: #fff;
  cursor: pointer;
}

.popover-quick-form {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.popover-quick-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.popover-quick-input:focus {
  border-color: var(--accent-border);
}

.popover-quick-submit {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--cta-bg);
  color: var(--cta-ink);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
}

.popover-quick-submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.popover-controls-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.popover-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.tab-btn {
  height: 26px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11.5px;
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}

.tab-btn.active {
  background: var(--surface-raised);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

.tab-count {
  font-style: normal;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--fill-subtle);
  color: var(--text-secondary);
}

.tab-count.warn {
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  color: var(--danger);
}

.scope-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.scope-chips {
  display: flex;
  gap: 4px;
}

.scope-chip {
  height: 21px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 10.5px;
  cursor: pointer;
}

.scope-chip.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font-weight: 650;
}

.mini-search-input {
  width: 110px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 10.5px;
  outline: none;
}

.mini-search-input:focus {
  border-color: var(--accent-border);
}

.popover-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.empty-box {
  padding: 34px 16px;
  text-align: center;
  color: var(--text-tertiary);
}

.empty-box p {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
}

.empty-box small {
  font-size: 11px;
  color: var(--text-quaternary);
}

.pop-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 9px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  transition: border-color 0.14s ease, background 0.14s ease;
}

.pop-item:hover,
.pop-item.kb-active {
  border-color: var(--border-strong);
}

.pop-item.overdue {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border-subtle));
}

.pop-item.done {
  opacity: 0.72;
}

.pop-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-check {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  background: transparent;
  color: #fff;
  font-size: 10px;
  flex-shrink: 0;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.item-check:hover {
  border-color: var(--tide);
}

.item-check.checked {
  background: var(--success);
  border-color: var(--success);
}

.item-body {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.prio-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-quaternary);
  flex-shrink: 0;
}

.prio-dot.p0 { background: var(--danger); }
.prio-dot.p1 { background: var(--warning); }
.prio-dot.p2 { background: var(--tide); }

.item-title {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pop-item.done .item-title {
  text-decoration: line-through;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
}

.item-time {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.overdue-pill {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  padding: 1px 5px;
  border-radius: 4px;
}

.repeat-pill {
  font-size: 9.5px;
  color: var(--tide-text);
  background: var(--accent-soft);
  padding: 1px 5px;
  border-radius: 4px;
}

.subtask-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 4px;
  cursor: pointer;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  min-width: 22px;
  padding: 0 5px;
  border-radius: 6px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 10px;
  cursor: pointer;
}

.act-btn:hover {
  border-color: var(--accent-border);
  color: var(--tide-text);
}

.act-btn.pinned {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.subtasks-drawer {
  padding-left: 25px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-top: 1px dashed var(--border-subtle);
  padding-top: 5px;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}

.subtask-row span.done {
  text-decoration: line-through;
  color: var(--text-quaternary);
}

.upcoming-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-subtle);
}

.section-label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-quaternary);
  margin-bottom: 5px;
}

.upcoming-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border-radius: 7px;
  cursor: pointer;
}

.upcoming-row:hover {
  background: var(--fill-hover);
}

.up-title {
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.up-time {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-quaternary);
  flex-shrink: 0;
}

.popover-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface);
  font-size: 11px;
}

.footer-stats {
  color: var(--text-tertiary);
}

.warn-text {
  color: var(--danger);
}

.footer-btns {
  display: flex;
  gap: 8px;
}

.footer-link-btn {
  border: none;
  background: transparent;
  color: var(--tide-text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
}

.footer-link-btn:hover {
  text-decoration: underline;
}
</style>
