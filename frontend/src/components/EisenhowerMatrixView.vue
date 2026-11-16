<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import { parseReminderSubtasks, parseReminderTags, type ReminderPriority } from '../domain/reminder';
import { formatDateLabel, formatRepeatLabel, formatTime, getCountdownBadge, formatNotePreview, highlightMatch } from '../utils/format';
import { getTagColor } from '../utils/tagColors';
import { handlePointerGlow, resetPointerGlow } from '../utils/pointerGlow';

const props = defineProps<{ reminders: Reminder[]; searchQuery?: string }>();
const emit = defineEmits<{
  (e: 'edit', reminder: Reminder): void;
  (e: 'delete', id: string): void;
  (e: 'toggle-status', reminder: Reminder): void;
  (e: 'toggle-pin', id: string): void;
  (e: 'update-priority', reminder: Reminder, priority: string): void;
  (e: 'quick-add-priority', priority: string): void;
}>();

interface QuadrantDefinition {
  priority: ReminderPriority;
  eyebrow: string;
  name: string;
  description: string;
  empty: string;
}

const definitions: QuadrantDefinition[] = [
  { priority: 'p0', eyebrow: '立即处理', name: '紧急且重要', description: '危机、故障与临近截止事项', empty: '目前没有需要立即处理的事项' },
  { priority: 'p1', eyebrow: '安排时间', name: '重要但不紧急', description: '规划、成长与长期价值事项', empty: '目前没有待规划的重要事项' },
  { priority: 'p2', eyebrow: '协调处理', name: '紧急但不重要', description: '可委托、协作或快速响应事项', empty: '目前没有待协调的紧急事项' },
  { priority: 'p3', eyebrow: '稍后处理', name: '不紧急且不重要', description: '备忘、低优先级与可选事项', empty: '目前没有低优先级事项' },
];

const filteredReminders = computed(() => {
  const query = props.searchQuery?.trim().toLowerCase() || '';
  return props.reminders.filter((reminder) => {
    if (reminder.status === 'ended') return false;
    if (!query) return true;
    return reminder.title.toLowerCase().includes(query) ||
      reminder.notes?.toLowerCase().includes(query) ||
      parseReminderTags(reminder.tags).some((tag) => tag.toLowerCase().includes(query));
  });
});

const quadrants = computed(() => {
  const nowMs = Date.now();
  return definitions.map((definition) => {
    const items = filteredReminders.value
      .filter((reminder) => (reminder.priority || 'p2').toLowerCase() === definition.priority)
      .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    const totalMinutes = items.reduce((sum, r) => sum + (r.duration_minutes > 0 ? r.duration_minutes : 30), 0);
    const overdueCount = items.filter((r) => r.status === 'expired' || (r.status === 'active' && new Date(r.scheduled_at).getTime() < nowMs)).length;
    return {
      ...definition,
      items,
      totalMinutes,
      overdueCount,
    };
  });
});

const draggedReminder = ref<Reminder | null>(null);
const dragOverQuadrant = ref<ReminderPriority | null>(null);

function startDrag(event: DragEvent, reminder: Reminder) {
  draggedReminder.value = reminder;
  event.dataTransfer?.setData('text/plain', reminder.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
function dragOver(event: DragEvent, priority: ReminderPriority) {
  event.preventDefault();
  dragOverQuadrant.value = priority;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}
function leaveQuadrant(priority: ReminderPriority) {
  if (dragOverQuadrant.value === priority) dragOverQuadrant.value = null;
}
function dropInto(event: DragEvent, priority: ReminderPriority) {
  event.preventDefault();
  const reminder = draggedReminder.value;
  dragOverQuadrant.value = null;
  draggedReminder.value = null;
  if (reminder && (reminder.priority || 'p2') !== priority) emit('update-priority', reminder, priority);
}
function finishDrag() {
  draggedReminder.value = null;
  dragOverQuadrant.value = null;
}
function subtaskProgress(reminder: Reminder) {
  const subtasks = parseReminderSubtasks(reminder.subtasks);
  if (!subtasks.length) return null;
  const done = subtasks.filter((subtask) => subtask.done).length;
  return { done, total: subtasks.length, percentage: Math.round(done / subtasks.length * 100) };
}

const totalItems = computed(() => quadrants.value.reduce((acc, q) => acc + q.items.length, 0));
const overdueTotal = computed(() => quadrants.value.reduce((acc, q) => acc + q.overdueCount, 0));

function isItemOverdue(r: Reminder): boolean {
  if (r.status === 'expired') return true;
  if (r.status !== 'active') return false;
  const ts = new Date(r.scheduled_at).getTime();
  return !Number.isNaN(ts) && ts < Date.now();
}

const priorityOrder: ReminderPriority[] = ['p0', 'p1', 'p2', 'p3'];
function shiftPriority(reminder: Reminder, direction: -1 | 1) {
  const current = (reminder.priority || 'p2').toLowerCase() as ReminderPriority;
  const idx = priorityOrder.indexOf(current);
  if (idx === -1) return;
  const targetIdx = idx + direction;
  if (targetIdx >= 0 && targetIdx < priorityOrder.length) {
    emit('update-priority', reminder, priorityOrder[targetIdx]);
  }
}

const QUADRANT_SEALS: Record<string, string> = {
  p0: '急',
  p1: '谋',
  p2: '协',
  p3: '缓',
};
</script>

<template>
  <section class="matrix-container" aria-label="优先级矩阵">
    <header class="matrix-header st-reticle">
      <div>
        <p class="matrix-eyebrow">PRIORITY MATRIX</p>
        <h2 class="matrix-title">四象限优先级矩阵</h2>
        <p class="matrix-sub">拖动卡片或点击快捷按钮调整优先级。已完结事项不计入负荷。</p>
      </div>
      <div class="matrix-summary-wrap">
        <div class="matrix-summary" aria-label="各优先级数量">
          <span v-if="overdueTotal > 0" class="overdue-summary tabular-nums"><i></i>逾期 {{ overdueTotal }}</span>
          <span v-for="quadrant in quadrants" :key="quadrant.priority" :class="quadrant.priority">
            <i></i>{{ quadrant.priority.toUpperCase() }} {{ quadrant.items.length }}
            <small v-if="totalItems > 0">({{ Math.round((quadrant.items.length / totalItems) * 100) }}%)</small>
          </span>
        </div>
        <!-- Workload Segment Distribution Bar -->
        <div v-if="totalItems > 0" class="matrix-dist-bar" aria-hidden="true">
          <i
            v-for="quadrant in quadrants"
            :key="quadrant.priority"
            :class="quadrant.priority"
            :style="{ width: `${(quadrant.items.length / totalItems) * 100}%` }"
          ></i>
        </div>
      </div>
    </header>

    <div class="quadrants-grid">
      <article
        v-for="quadrant in quadrants"
        :key="quadrant.priority"
        class="quadrant-card"
        :class="[quadrant.priority, { 'drag-over': dragOverQuadrant === quadrant.priority }]"
        @pointermove="handlePointerGlow"
        @pointerleave="resetPointerGlow"
        @dragover="dragOver($event, quadrant.priority)"
        @dragleave="leaveQuadrant(quadrant.priority)"
        @drop="dropInto($event, quadrant.priority)"
      >
        <header class="quadrant-header">
          <div class="quadrant-title-group">
            <span class="priority-marker" :class="quadrant.priority">
              {{ quadrant.priority.toUpperCase() }}
            </span>
            <span class="shanshui-seal matrix-seal" :class="quadrant.priority" :title="quadrant.name">
              {{ QUADRANT_SEALS[quadrant.priority] || '序' }}
            </span>
            <div>
              <p>{{ quadrant.eyebrow }} <span v-if="quadrant.totalMinutes > 0">· 共 {{ quadrant.totalMinutes }}m</span> <span v-if="quadrant.overdueCount > 0" style="color: var(--danger)">· 逾期 {{ quadrant.overdueCount }}</span></p>
              <h3>{{ quadrant.name }}</h3>
              <small>{{ quadrant.description }}</small>
            </div>
          </div>
          <button type="button" :title="`新建 ${quadrant.priority.toUpperCase()} 日程`" :aria-label="`新建 ${quadrant.priority.toUpperCase()} 日程`" @click="$emit('quick-add-priority', quadrant.priority)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </header>

        <div class="quadrant-body">
          <div v-if="!quadrant.items.length" class="quadrant-empty">
            <span>—</span>
            <p>{{ quadrant.empty }}</p>
            <button
              type="button"
              class="quadrant-empty-btn"
              @click="$emit('quick-add-priority', quadrant.priority)"
            >
              + 新建 {{ quadrant.priority.toUpperCase() }} 事项
            </button>
          </div>

          <article
            v-for="reminder in quadrant.items"
            :key="reminder.id"
            class="matrix-item"
            :class="{ pinned: reminder.is_pinned, paused: reminder.status === 'paused', dragging: draggedReminder?.id === reminder.id, overdue: isItemOverdue(reminder) }"
            tabindex="0"
            draggable="true"
            @click="$emit('edit', reminder)"
            @keydown.enter.prevent="$emit('edit', reminder)"
            @dragstart="startDrag($event, reminder)"
            @dragend="finishDrag"
          >
            <div class="matrix-item-top">
              <button class="complete-button" type="button" title="标记完成" @click.stop="$emit('toggle-status', reminder)"></button>
              <button class="matrix-item-title" type="button" @click.stop="$emit('edit', reminder)" v-html="highlightMatch(reminder.title, searchQuery)"></button>
              <button class="pin-button" type="button" :class="{ active: reminder.is_pinned }" :title="reminder.is_pinned ? '取消置顶' : '置顶'" @click.stop="$emit('toggle-pin', reminder.id)">
                <svg width="12" height="12" viewBox="0 0 24 24" :fill="reminder.is_pinned ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            </div>

            <div class="matrix-item-meta">
              <span>{{ formatDateLabel(reminder.scheduled_at).label }} {{ formatTime(reminder.scheduled_at) }}</span>
              <span class="tabular-nums">{{ reminder.duration_minutes || 30 }}m</span>
              <span v-if="reminder.status !== 'expired' && getCountdownBadge(reminder.scheduled_at).showBadge" :class="{ urgent: getCountdownBadge(reminder.scheduled_at).isUrgent }">{{ getCountdownBadge(reminder.scheduled_at).text }}</span>
              <span v-if="reminder.repeat_rule">{{ formatRepeatLabel(reminder.repeat_rule) }}</span>
              <span v-if="reminder.status === 'paused'" class="paused-label">已暂停</span>
              <span v-else-if="reminder.status === 'expired'" class="expired-label">已过期</span>
            </div>
            <div
              v-if="formatNotePreview(reminder.notes)"
              class="matrix-note-preview"
              v-html="highlightMatch(formatNotePreview(reminder.notes), searchQuery)"
            ></div>

            <div v-if="parseReminderTags(reminder.tags).length" class="matrix-tags">
              <span
                v-for="tag in parseReminderTags(reminder.tags)"
                :key="tag"
                :style="{
                  '--tag-bg': getTagColor(tag).bg,
                  '--tag-color': getTagColor(tag).text,
                  '--tag-border': getTagColor(tag).border,
                }"
              >#{{ tag }}</span>
            </div>

            <div v-if="subtaskProgress(reminder)" class="matrix-progress">
              <span><i :style="{ width: `${subtaskProgress(reminder)?.percentage}%` }"></i></span>
              <small>{{ subtaskProgress(reminder)?.done }}/{{ subtaskProgress(reminder)?.total }}</small>
            </div>

            <footer class="matrix-item-actions">
              <div class="matrix-priority-group" role="group" aria-label="调整优先级">
                <button
                  v-for="pri in (['p0', 'p1', 'p2', 'p3'] as const)"
                  :key="pri"
                  type="button"
                  class="matrix-pri-pill"
                  :class="[pri, { active: (reminder.priority || 'p2').toLowerCase() === pri }]"
                  @click.stop="$emit('update-priority', reminder, pri)"
                >
                  {{ pri.toUpperCase() }}
                </button>
              </div>
              <div class="matrix-shift-group" role="group" aria-label="升降级">
                <button
                  type="button"
                  class="matrix-shift-btn"
                  title="提升优先级"
                  :disabled="(reminder.priority || 'p2').toLowerCase() === 'p0'"
                  @click.stop="shiftPriority(reminder, -1)"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  class="matrix-shift-btn"
                  title="降低优先级"
                  :disabled="(reminder.priority || 'p2').toLowerCase() === 'p3'"
                  @click.stop="shiftPriority(reminder, 1)"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              </div>
              <button type="button" @click.stop="$emit('edit', reminder)">编辑</button>
              <button class="delete-button" type="button" @click.stop="$emit('delete', reminder.id)">删除</button>
            </footer>
          </article>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.matrix-container { min-height:100%; display:flex; flex-direction:column; gap:12px; }
.matrix-header { position:relative; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:16px 18px; border:1px solid var(--border-subtle); border-radius:12px; background:var(--surface); }
.matrix-eyebrow { margin:0 0 4px; color:var(--text-quaternary); font:700 8px var(--font-mono); letter-spacing:.14em; }
.matrix-title { margin:0; color:var(--text-primary); font-size:15px; letter-spacing:-.02em; }
.matrix-sub { margin:4px 0 0; color:var(--text-tertiary); font-size:10px; }
.matrix-summary-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.matrix-summary { display:flex; gap:5px; }.matrix-summary span { display:flex; align-items:center; gap:5px; padding:4px 7px; border:1px solid var(--border-subtle); border-radius:6px; color:var(--text-tertiary); font:650 9px var(--font-mono); }.matrix-summary i { width:5px; height:5px; border-radius:50%; background:var(--text-quaternary); }.matrix-summary .p0 i{background:var(--danger)}.matrix-summary .p1 i{background:var(--warning)}.matrix-summary .p2 i{background:var(--accent)}
.matrix-summary small { opacity: 0.7; font-weight: 500; font-size: 8px; margin-left: 1px; }
.matrix-dist-bar { width: 100%; height: 4px; display: flex; overflow: hidden; border-radius: 99px; background: var(--fill-hover); }
.matrix-dist-bar i { height: 100%; transition: width 0.3s ease; }
.matrix-dist-bar i.p0 { background: var(--danger); }
.matrix-dist-bar i.p1 { background: var(--warning); }
.matrix-dist-bar i.p2 { background: var(--accent); }
.matrix-dist-bar i.p3 { background: var(--border-strong); }
.quadrants-grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(250px,1fr)); gap:10px; }
.quadrant-card { position:relative; min-width:0; display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--border-subtle); border-radius:14px; background:var(--surface); transition:border-color var(--motion-fast),background var(--motion-fast); }
.quadrant-card.p0 { border-top:2px solid var(--danger); background:radial-gradient(240px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--danger) 11%, transparent), transparent 70%), radial-gradient(60% 45% at 100% 0%, color-mix(in srgb, var(--danger) 9%, transparent), transparent 65%), var(--surface); }
.quadrant-card.p1 { border-top:2px solid var(--lime-strong); background:radial-gradient(240px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--lime) 11%, transparent), transparent 70%), radial-gradient(60% 45% at 100% 0%, color-mix(in srgb, var(--lime) 8%, transparent), transparent 65%), var(--surface); }
.quadrant-card.p2 { border-top:2px solid var(--tide); background:radial-gradient(240px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--tide) 11%, transparent), transparent 70%), radial-gradient(60% 45% at 100% 0%, color-mix(in srgb, var(--tide) 8%, transparent), transparent 65%), var(--surface); }
.quadrant-card.p3 { border-top:2px solid var(--border-strong); background:radial-gradient(240px circle at var(--mx, -999px) var(--my, -999px), color-mix(in srgb, var(--text-tertiary) 9%, transparent), transparent 70%), var(--surface); }
.quadrant-card.drag-over { border-color:var(--tide); border-style:dashed; background:var(--accent-soft); box-shadow:inset 0 0 0 1px var(--accent-border); }
.quadrant-header { min-height:68px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-bottom:1px solid var(--border-subtle); }
.quadrant-title-group { min-width:0; display:flex; align-items:flex-start; gap:9px; }.priority-marker { min-width:29px; height:20px; display:grid; place-items:center; border:1px solid var(--border-strong); border-radius:5px; color:var(--text-tertiary); font:750 8.5px var(--font-mono); }.priority-marker.p0{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 32%,transparent)}.priority-marker.p1{color:var(--warning);border-color:color-mix(in srgb,var(--warning) 32%,transparent)}.priority-marker.p2{color:var(--accent-text);border-color:var(--accent-border)}
.quadrant-title-group p { margin:0 0 2px; color:var(--text-quaternary); font-size:8px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }.quadrant-title-group h3 { margin:0; color:var(--text-primary); font-size:11.5px; }.quadrant-title-group small { display:block; margin-top:2px; overflow:hidden; color:var(--text-quaternary); font-size:8.5px; text-overflow:ellipsis; white-space:nowrap; }
.quadrant-header>button { width:27px; height:27px; flex:0 0 27px; display:inline-grid; place-items:center; border:1px solid var(--border-subtle); border-radius:999px; background:transparent; color:var(--text-tertiary); cursor:pointer; transition:all var(--motion-fast); }.quadrant-header>button:hover { border-color:var(--accent-border); background:var(--accent-soft); color:var(--accent-text); }
.quadrant-body { flex:1; min-height:0; display:flex; flex-direction:column; gap:6px; overflow:auto; padding:8px; }.quadrant-empty { flex:1; min-height:100px; display:grid; place-content:center; justify-items:center; gap:6px; color:var(--text-quaternary); text-align:center; }.quadrant-empty span{font-size:18px}.quadrant-empty p{margin:0;font-size:9.5px}
.quadrant-empty-btn { padding: 4px 10px; border: 1px dashed var(--border-strong); border-radius: 999px; background: var(--fill-subtle); color: var(--text-secondary); font-size: 9.5px; font-weight: 600; cursor: pointer; transition: all var(--motion-fast); }
.quadrant-empty-btn:hover { border-color: var(--accent-border); border-style: solid; background: var(--accent-soft); color: var(--accent-text); }
.matrix-item { padding:9px; border:1px solid var(--border-subtle); border-radius:10px; background:var(--surface-raised); cursor:grab; transition:border-color var(--motion-fast),background var(--motion-fast),transform var(--motion-fast),box-shadow var(--motion-fast),opacity var(--motion-fast); }.matrix-item:hover { border-color:var(--border-strong); background:color-mix(in srgb,var(--surface-raised) 94%,var(--tide)); transform:translateY(-1px); box-shadow:var(--shadow-xs); }.matrix-item:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 1px; }.matrix-item.pinned { border-left:2px solid var(--warning); }.matrix-item.paused { opacity:.65; }.matrix-item.dragging { opacity:.35; }
.matrix-item-top { display:flex; align-items:center; gap:7px; }.complete-button { width:15px; height:15px; flex:0 0 15px; border:1.5px solid var(--border-strong); border-radius:50%; background:transparent; cursor:pointer; transition:all var(--motion-fast); }.complete-button:hover{border-color:var(--success);background:color-mix(in srgb,var(--success) 12%,transparent)}.matrix-item-title { min-width:0; flex:1; overflow:hidden; padding:0; border:0; background:transparent; color:var(--text-primary); font-size:10.5px; font-weight:600; text-align:left; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }.matrix-item-title:hover{color:var(--accent-text)}.pin-button { width:18px; height:18px; display:inline-grid; place-items:center; border:0; background:transparent; color:var(--text-quaternary); cursor:pointer; }.pin-button.active{color:var(--warning)}
.matrix-item-meta { display:flex; flex-wrap:wrap; gap:5px; margin:6px 0 0 22px; color:var(--text-quaternary); font-size:8.5px; }.matrix-item-meta span+span::before{content:'·';margin-right:5px}.matrix-item-meta .urgent{color:var(--danger)}.matrix-item-meta .paused-label{color:var(--warning)}
.matrix-tags { display:flex; flex-wrap:wrap; gap:4px; margin:6px 0 0 22px; }.matrix-tags span { padding:1px 6px; border-radius:999px; background:var(--tag-bg); color:var(--tag-color); border:1px solid var(--tag-border); font:600 8.5px var(--font-mono); line-height:1.35; }
.matrix-progress { display:flex; align-items:center; gap:7px; margin:7px 0 0 22px; }.matrix-progress>span { flex:1; height:3px; overflow:hidden; border-radius:3px; background:var(--fill-hover); }.matrix-progress i { display:block; height:100%; border-radius:inherit; background:var(--success); }.matrix-progress small { color:var(--text-quaternary); font:8px var(--font-mono); }
.matrix-item-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:4px; margin-top:7px; opacity:0; transition:opacity var(--motion-fast); }.matrix-item:hover .matrix-item-actions,.matrix-item:focus-within .matrix-item-actions{opacity:1}
.matrix-priority-group { display:inline-flex; align-items:center; gap:2px; padding:2px; border:1px solid var(--border-subtle); border-radius:999px; background:var(--fill-subtle); }
.matrix-item-actions .matrix-pri-pill { height:20px; padding:0 6px; border:0; border-radius:999px; background:transparent; color:var(--text-quaternary); font:700 8px var(--font-mono); cursor:pointer; }
.matrix-item-actions .matrix-pri-pill:hover { color:var(--text-primary); background:var(--fill-hover); }
.matrix-item-actions .matrix-pri-pill.p0.active { background:color-mix(in srgb,var(--danger) 18%,transparent); color:var(--danger); }
.matrix-item-actions .matrix-pri-pill.p1.active { background:color-mix(in srgb,var(--lime) 18%,transparent); color:var(--lime-strong); }
.matrix-item-actions .matrix-pri-pill.p2.active { background:var(--accent-soft); color:var(--tide-text); }
.matrix-item-actions .matrix-pri-pill.p3.active { background:var(--fill-hover); color:var(--text-primary); }
.matrix-shift-group { display: inline-flex; align-items: center; gap: 2px; }
.matrix-shift-btn { width: 20px; height: 20px; padding: 0 !important; display: grid; place-items: center; border: 1px solid var(--border-subtle); border-radius: 4px; background: transparent; color: var(--text-tertiary); font: 700 9px var(--font-mono); cursor: pointer; transition: all var(--motion-fast); }
.matrix-shift-btn:hover:not(:disabled) { border-color: var(--accent-border); background: var(--accent-soft); color: var(--accent-text); }
.matrix-shift-btn:disabled { opacity: 0.25; cursor: default; }
.matrix-item-actions button:not(.matrix-pri-pill) { height:22px; padding:0 8px; border:1px solid var(--border-subtle); border-radius:999px; background:transparent; color:var(--text-tertiary); font-size:8.5px; cursor:pointer; transition:all var(--motion-fast); }.matrix-item-actions button:not(.matrix-pri-pill):hover{background:var(--fill-hover);border-color:var(--border-strong);color:var(--text-primary)}.matrix-item-actions .delete-button:hover{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,transparent);background:color-mix(in srgb,var(--danger) 10%,transparent)}
.matrix-seal { margin-top: 1px; }
.matrix-summary .overdue-summary {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 36%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.matrix-summary .overdue-summary i { background: var(--danger); }
.matrix-item.overdue {
  border-left: 2.5px solid var(--danger);
  background: color-mix(in srgb, var(--danger) 5%, var(--surface-raised));
}
.matrix-item.paused {
  border-style: dashed;
}
.matrix-item-meta .paused-label {
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  color: var(--warning);
  font-weight: 650;
}
.matrix-item-meta .expired-label {
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  font-weight: 650;
}
.matrix-note-preview {
  margin: 4px 0 0 22px;
  font-size: 9.5px;
  line-height: 1.35;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global([data-color-scheme="light"]) .quadrant-card {
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
}
:global([data-color-scheme="light"]) .matrix-item {
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
}
@media(max-width:1020px){.matrix-summary{display:none}.quadrants-grid{grid-template-columns:1fr;grid-template-rows:none}.quadrant-card{min-height:260px}.matrix-item-actions{opacity:1}}
</style>
