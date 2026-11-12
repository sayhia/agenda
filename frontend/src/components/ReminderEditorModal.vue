<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import {
  CheckSimilarReminders,
  FindOptimalFreeSlot,
  PolishReminderWithAI,
} from '../../bindings/agenda/internal/agenda/agendaservice';
import { checkTimeConflict } from '../utils/conflict';
import { parseReminderSubtasks, parseReminderTags } from '../domain/reminder';
import TunerDurationDial from './TunerDurationDial.vue';
import ScrolltideSelect from './ScrolltideSelect.vue';

export interface SubtaskItem {
  id: string;
  title: string;
  done: boolean;
}

const props = withDefaults(defineProps<{
  visible: boolean;
  reminder: Reminder | null;
  initialDate?: string | null;
  allReminders?: Reminder[];
  saving?: boolean;
}>(), {
  initialDate: null,
  allReminders: () => [],
  saving: false,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', data: {
    id?: string;
    title: string;
    scheduled_at: string;
    repeat_rule: string;
    lead_minutes: number;
    notes: string;
    duration_minutes: number;
    timezone: string;
    prompt: string;
    status: string;
    priority?: string;
    tags?: string;
    subtasks?: string;
    is_pinned?: boolean;
  }): void;
}>();

const formTitle = ref('');
const formDateTime = ref('');
const formRepeat = ref('');
const formLead = ref(0);
const formDuration = ref(30);
const formNotes = ref('');
const formPrompt = ref('');
const formStatus = ref('active');
const formPriority = ref('p2');
const formTags = ref('');
const formIsPinned = ref(false);
const subtasks = ref<SubtaskItem[]>([]);
const newSubtaskInput = ref('');
const isPolishing = ref(false);
const dateError = computed(() => {
  if (!formDateTime.value) return '请选择提醒日期和时间';
  return Number.isFinite(new Date(formDateTime.value).getTime()) ? '' : '提醒日期或时间无效';
});
const canSave = computed(() => Boolean(formTitle.value.trim()) && !dateError.value && !props.saving);

const presetTags = ['工作', '生活', '健康', '会议', '投放', '学习'];

const repeatOptions = [
  { value: '', label: '单次提醒 (不重复)' },
  { value: 'FREQ=DAILY', label: '每天' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: '每个工作日 (周一至周五)' },
  { value: 'FREQ=WEEKLY;BYDAY=SA,SU', label: '每个周末 (周六和周日)' },
  { value: 'FREQ=WEEKLY;BYDAY=MO', label: '每周一' },
  { value: 'FREQ=WEEKLY;BYDAY=FR', label: '每周五' },
  { value: 'FREQ=MONTHLY;BYMONTHDAY=1', label: '每月 1 号' },
  { value: 'FREQ=MONTHLY;BYMONTHDAY=15', label: '每月 15 号' },
  { value: 'FREQ=YEARLY', label: '每年' },
];

const leadOptions = [
  { value: 0, label: '准时提醒 (不提前)' },
  { value: 5, label: '提前 5 分钟' },
  { value: 10, label: '提前 10 分钟' },
  { value: 15, label: '提前 15 分钟' },
  { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' },
];

// Night hours detection (22:00 to 08:00)
const isNightHours = computed(() => {
  if (!formDateTime.value) return false;
  const d = new Date(formDateTime.value);
  const hour = d.getHours();
  return hour >= 22 || hour < 8;
});

function adjustToNextMorning() {
  if (!formDateTime.value) return;
  const d = new Date(formDateTime.value);
  if (d.getHours() >= 22) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(9, 0, 0, 0);
  formDateTime.value = formatLocal(d);
}

// AI Polish
async function handleAiPolish() {
  const raw = `${formTitle.value}\n${formNotes.value}`.trim();
  if (!raw || isPolishing.value) return;

  isPolishing.value = true;
  try {
    const res = await PolishReminderWithAI(raw);
    if (res) {
      if (res.title) formTitle.value = res.title;
      if (res.notes) formNotes.value = res.notes;
      if (res.tags && res.tags.length > 0) {
        const existing = parseReminderTags(formTags.value);
        const merged = Array.from(new Set([...existing, ...res.tags]));
        formTags.value = merged.join(',');
      }
      if (res.subtasks && res.subtasks.length > 0) {
        for (const st of res.subtasks) {
          if (!subtasks.value.some((s) => s.title === st)) {
            subtasks.value.push({
              id: 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              title: st,
              done: false,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('AI polish error:', err);
  } finally {
    isPolishing.value = false;
  }
}

// Subtask Presets
const presetsMap: Record<string, string[]> = {
  meeting: ['提前5分钟准备会议环境', '就位演示材料与议程', '记录待办行动项与责任人'],
  deploy: ['检查分支代码与CI测试', '线上环境配置与数据库备份', '实施发布并执行回归', '监控告警与错误日志'],
  travel: ['身份证件/护照/行程车票', '电脑设备/电源适配器', '酒店预订与目的地路线'],
  weekly: ['整理本周完成重点事项', '分析未达成项与卡点', '设定下周核心产出目标'],
};

function applySubtaskPreset(key: string) {
  const list = presetsMap[key] || [];
  for (const item of list) {
    if (!subtasks.value.some((s) => s.title === item)) {
      subtasks.value.push({
        id: 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        title: item,
        done: false,
      });
    }
  }
}

// Convert ISO to datetime-local input format (YYYY-MM-DDTHH:mm)
function toDatetimeLocal(iso: string): string {
  if (!iso) {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return formatLocal(d);
  }
  const d = new Date(iso);
  return formatLocal(d);
}

function formatLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

// Conflict detection (Round 1)
const conflictInfo = computed(() => {
  if (!props.allReminders?.length || dateError.value) {
    return { hasConflict: false, conflicts: [] as Reminder[] };
  }
  return checkTimeConflict(
    new Date(formDateTime.value).toISOString(),
    Number(formDuration.value),
    props.allReminders,
    props.reminder?.id,
  );
});

function applySuggestedTime() {
  if (conflictInfo.value.suggestedTime) {
    formDateTime.value = toDatetimeLocal(conflictInfo.value.suggestedTime);
  }
}

// Similar / Duplicate Detection (Round 21)
const similarWarnings = ref<Reminder[]>([]);
let similarTimer: ReturnType<typeof setTimeout>;
let similarRequestSequence = 0;

watch([formTitle, formDateTime], ([newTitle]) => {
  clearTimeout(similarTimer);
  const requestId = ++similarRequestSequence;
  if (!props.visible || !newTitle.trim() || newTitle.length < 2 || dateError.value) {
    similarWarnings.value = [];
    return;
  }
  similarTimer = setTimeout(async () => {
    try {
      const titleAtRequest = newTitle.trim();
      const iso = new Date(formDateTime.value).toISOString();
      const res = await CheckSimilarReminders(titleAtRequest, iso, props.reminder?.id || '');
      if (requestId === similarRequestSequence && titleAtRequest === formTitle.value.trim()) {
        similarWarnings.value = res || [];
      }
    } catch {
      if (requestId === similarRequestSequence) similarWarnings.value = [];
    }
  }, 300);
});

// Optimal Free Slot Finder (Round 24)
const isFindingSlot = ref(false);

async function handleFindOptimalSlot() {
  isFindingSlot.value = true;
  try {
    const dateStr = formDateTime.value ? formDateTime.value.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const slotIso = await FindOptimalFreeSlot(dateStr, Number(formDuration.value) || 30);
    if (slotIso) {
      formDateTime.value = toDatetimeLocal(slotIso);
    }
  } catch (err) {
    console.error('Find slot failed:', err);
  } finally {
    isFindingSlot.value = false;
  }
}

function togglePresetTag(tag: string) {
  const current = parseReminderTags(formTags.value);
  const idx = current.indexOf(tag);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(tag);
  }
  formTags.value = current.join(',');
}

function addSubtask() {
  const t = newSubtaskInput.value.trim();
  if (!t) return;
  subtasks.value.push({
    id: 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: t,
    done: false,
  });
  newSubtaskInput.value = '';
}

function removeSubtask(index: number) {
  subtasks.value.splice(index, 1);
}

function moveSubtask(index: number, direction: 'up' | 'down') {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= subtasks.value.length) return;
  const item = subtasks.value.splice(index, 1)[0];
  subtasks.value.splice(targetIndex, 0, item);
}

function extractChecklistFromNotes() {
  if (!formNotes.value) return;
  const lines = formNotes.value.split('\n');
  for (const line of lines) {
    const m = line.match(/^[-*]\s*\[([ xX])\]\s*(.+)$/);
    if (m) {
      const isDone = m[1].toLowerCase() === 'x';
      const taskText = m[2].trim();
      if (taskText && !subtasks.value.some((s) => s.title === taskText)) {
        subtasks.value.push({
          id: 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
          title: taskText,
          done: isDone,
        });
      }
    }
  }
}

watch(
  [() => props.reminder, () => props.visible],
  ([r, visible]) => {
    if (!visible) {
      similarRequestSequence++;
      clearTimeout(similarTimer);
      return;
    }
    if (r) {
      formTitle.value = r.title;
      formDateTime.value = toDatetimeLocal(r.scheduled_at);
      formRepeat.value = r.repeat_rule || '';
      formLead.value = r.lead_minutes || 0;
      formDuration.value = r.duration_minutes || 30;
      formNotes.value = r.notes || '';
      formPrompt.value = r.prompt || '';
      formStatus.value = r.status || 'active';
      formPriority.value = r.priority || 'p2';
      formTags.value = r.tags || '';
      formIsPinned.value = r.is_pinned || false;

      subtasks.value = parseReminderSubtasks(r.subtasks);
    } else {
      formTitle.value = '';
      if (props.initialDate) {
        formDateTime.value = props.initialDate.includes('T')
          ? props.initialDate.slice(0, 16)
          : `${props.initialDate}T09:00`;
      } else {
        formDateTime.value = toDatetimeLocal('');
      }
      formRepeat.value = '';
      formLead.value = Number(localStorage.getItem('agenda_default_lead') || '10');
      formDuration.value = 30;
      formNotes.value = '';
      formPrompt.value = '';
      formStatus.value = 'active';
      formPriority.value = 'p2';
      formTags.value = '';
      formIsPinned.value = false;
      subtasks.value = [];
    }
    newSubtaskInput.value = '';
  },
  { immediate: true }
);

onUnmounted(() => {
  similarRequestSequence++;
  clearTimeout(similarTimer);
});

function handleSave() {
  if (!canSave.value) return;
  const timestamp = new Date(formDateTime.value).getTime();
  if (!Number.isFinite(timestamp)) return;

  emit('save', {
    id: props.reminder?.id,
    title: formTitle.value.trim(),
    scheduled_at: new Date(timestamp).toISOString(),
    repeat_rule: formRepeat.value,
    lead_minutes: Number(formLead.value),
    duration_minutes: Number(formDuration.value),
    notes: formNotes.value.trim(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    prompt: formPrompt.value.trim(),
    status: formStatus.value,
    priority: formPriority.value,
    tags: formTags.value.trim(),
    subtasks: JSON.stringify(subtasks.value),
    is_pinned: formIsPinned.value,
  });
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card st-reticle" role="dialog" aria-modal="true" aria-label="日程编辑器">
      <!-- Modal Header -->
      <div class="modal-head">
        <div class="modal-head-copy">
          <span class="composer-eyebrow">SCHEDULE COMPOSER · TELEMETRY</span>
          <h3 class="modal-title">{{ reminder ? '编辑日程' : '新建日程' }}</h3>
        </div>
        <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
      </div>

      <!-- Form Grid -->
      <div class="form-body">
        <div class="form-field full-width">
          <div class="field-label-row">
            <label class="field-label">日程标题 *</label>
            <button
              type="button"
              class="ai-polish-btn"
              :disabled="isPolishing"
              title="使用 AI 深度润色、提炼标题并自动拆分子任务"
              @click="handleAiPolish"
            >
              <span v-if="isPolishing">✨ 润色中...</span>
              <span v-else>✨ AI 润色</span>
            </button>
          </div>
          <input
            v-model="formTitle"
            type="text"
            class="form-input"
            placeholder="例如：下午团队周会"
            autofocus
          />
          <div v-if="similarWarnings.length > 0" class="similar-warning-pill">
            <span>💡 提示：检测到相似日程「{{ similarWarnings[0].title }}」，注意避免重复创建</span>
          </div>
        </div>

        <div class="form-field">
          <div class="field-label-row">
            <label class="field-label">提醒时刻 *</label>
            <button
              type="button"
              class="find-slot-btn"
              :disabled="isFindingSlot"
              @click="handleFindOptimalSlot"
            >
              {{ isFindingSlot ? '探测中...' : '⚡️ 推荐空闲时段' }}
            </button>
          </div>
          <input
            v-model="formDateTime"
            type="datetime-local"
            class="form-input"
            required
            :aria-invalid="Boolean(dateError)"
            aria-describedby="editor-date-error"
          />
          <span v-if="dateError" id="editor-date-error" class="field-error">{{ dateError }}</span>
          <!-- Night Guard -->
          <div v-if="isNightHours" class="night-guard-banner">
            <span>🌙 深夜/清晨时段 ({{ new Date(formDateTime).getHours() }}:00)，可能会打扰休息</span>
            <button type="button" class="night-adjust-btn" @click="adjustToNextMorning">改到明早 09:00</button>
          </div>
        </div>

        <div class="form-field">
          <div class="field-label-row">
            <label class="field-label">优先级</label>
            <label class="pinned-checkbox-label" title="置顶后始终排在列表最上方">
              <input type="checkbox" v-model="formIsPinned" />
              <span class="star-icon">★</span> 置顶
            </label>
          </div>
          <div class="priority-pill-group" role="radiogroup" aria-label="优先级选择">
            <button
              v-for="opt in [
                { id: 'p0', label: 'P0 紧急' },
                { id: 'p1', label: 'P1 重要' },
                { id: 'p2', label: 'P2 常规' },
                { id: 'p3', label: 'P3 低优' },
              ]"
              :key="opt.id"
              type="button"
              role="radio"
              :aria-checked="formPriority === opt.id"
              class="pri-seg-btn"
              :class="[opt.id, { active: formPriority === opt.id }]"
              @click="formPriority = opt.id"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Conflict Alert Banner (Round 1) -->
        <div v-if="conflictInfo.hasConflict" class="conflict-alert-box full-width">
          <span class="alert-icon">⚠️</span>
          <div class="alert-content">
            <div class="alert-title">
              与已有日程时间重叠：{{ conflictInfo.conflicts.map(c => c.title).join('、') }}
            </div>
            <div class="alert-action-row">
              <span class="alert-tip">建议错峰安排</span>
              <button
                v-if="conflictInfo.suggestedTimeLabel"
                type="button"
                class="resolve-btn"
                @click="applySuggestedTime"
              >
                一键避让调整至 {{ conflictInfo.suggestedTimeLabel }}
              </button>
            </div>
          </div>
        </div>

        <div class="form-field">
          <label class="field-label">重复周期</label>
          <ScrolltideSelect
            v-model="formRepeat"
            :options="repeatOptions"
            aria-label="重复周期"
          />
        </div>

        <div class="form-field">
          <label class="field-label">提前提醒</label>
          <ScrolltideSelect
            v-model="formLead"
            :options="leadOptions"
            aria-label="提前提醒"
          />
        </div>

        <div class="form-field">
          <label class="field-label">预计时长</label>
          <TunerDurationDial
            v-model="formDuration"
            :presets="[15, 25, 30, 45, 60, 90, 120]"
          />
        </div>

        <div class="form-field">
          <label class="field-label">标签分类</label>
          <input
            v-model="formTags"
            type="text"
            class="form-input"
            placeholder="标签用逗号分隔，例如：工作,限流"
          />
        </div>

        <!-- Preset Tags Row -->
        <div class="preset-tags-row full-width">
          <span class="preset-label">快捷标签:</span>
          <button
            v-for="tag in presetTags"
            :key="tag"
            type="button"
            class="preset-tag-btn"
            :class="{ active: formTags.includes(tag) }"
            @click="togglePresetTag(tag)"
          >
            #{{ tag }}
          </button>
        </div>

        <!-- Subtasks Checklist (Round 7 & 201) -->
        <div class="form-field full-width subtasks-box">
          <div class="field-label-row">
            <label class="field-label">检查清单 / 子任务 ({{ subtasks.filter(s => s.done).length }}/{{ subtasks.length }})</label>
            <div class="subtask-presets-row">
              <span class="preset-label">模板:</span>
              <button type="button" class="preset-chip" @click="applySubtaskPreset('meeting')">+ 会议</button>
              <button type="button" class="preset-chip" @click="applySubtaskPreset('deploy')">+ 发布</button>
              <button type="button" class="preset-chip" @click="applySubtaskPreset('travel')">+ 出差</button>
              <button type="button" class="preset-chip" @click="applySubtaskPreset('weekly')">+ 周报</button>
              <button type="button" class="preset-chip" title="自动解析备注中的 - [ ] 待办项" @click="extractChecklistFromNotes">📋 提取备注</button>
            </div>
          </div>

          <!-- Dynamic Progress Bar -->
          <div v-if="subtasks.length > 0" class="subtask-progress-track">
            <div
              class="subtask-progress-fill"
              :style="{ width: `${(subtasks.filter(s => s.done).length / subtasks.length) * 100}%` }"
            ></div>
          </div>

          <div class="subtask-input-line">
            <input
              v-model="newSubtaskInput"
              type="text"
              class="form-input subtask-text-input"
              placeholder="添加子任务项（按回车添加）..."
              @keydown.enter.prevent="addSubtask"
            />
            <button type="button" class="add-subtask-btn" @click="addSubtask">+ 添加</button>
          </div>
          <div v-if="subtasks.length > 0" class="subtasks-list">
            <div v-for="(st, idx) in subtasks" :key="st.id" class="subtask-row">
              <input type="checkbox" v-model="st.done" class="subtask-checkbox" />
              <span class="subtask-title" :class="{ done: st.done }">{{ st.title }}</span>
              <div class="subtask-actions">
                <button
                  type="button"
                  class="order-subtask-btn"
                  :disabled="idx === 0"
                  title="上移"
                  @click="moveSubtask(idx, 'up')"
                >▲</button>
                <button
                  type="button"
                  class="order-subtask-btn"
                  :disabled="idx === subtasks.length - 1"
                  title="下移"
                  @click="moveSubtask(idx, 'down')"
                >▼</button>
                <button type="button" class="del-subtask-btn" title="删除" @click="removeSubtask(idx)">✕</button>
              </div>
            </div>
          </div>
        </div>

        <div class="form-field full-width">
          <label class="field-label">备注附注</label>
          <input
            v-model="formNotes"
            type="text"
            class="form-input"
            placeholder="例如：需暂停的具体域名、背景原因、汇报数据"
          />
        </div>

        <div class="form-field full-width">
          <label class="field-label">定制系统提示词</label>
          <textarea
            v-model="formPrompt"
            class="form-textarea"
            rows="2"
            placeholder="自定义桌面通知文案 (留空则使用默认提示)"
          ></textarea>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button class="icon-btn cancel-btn" @click="$emit('close')">取消</button>
        <button class="primary-btn" :disabled="!canSave" @click="handleSave">
          {{ saving ? '保存中…' : '保存日程' }}
        </button>
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
  position: relative;
  width: 560px;
  max-width: 92vw;
  max-height: 88vh;
  border-radius: 18px;
  padding: 20px 24px;
  background:
    radial-gradient(65% 40% at 88% 0%, color-mix(in srgb, var(--tide) 9%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: scale-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overflow-y: auto;
}

@keyframes scale-up {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-head-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.composer-eyebrow {
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--tide-text);
}

.modal-title {
  margin: 0;
  font-size: 16.5px;
  font-weight: 750;
  color: var(--text-primary);
}

.form-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.find-slot-btn {
  font: 650 10.5px var(--font-mono);
  color: var(--tide-text);
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 999px;
  padding: 2px 9px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.find-slot-btn:hover {
  background: var(--tide);
  border-color: var(--tide);
  color: var(--ink-on-accent);
}

.similar-warning-pill {
  font-size: 11px;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 28%, transparent);
  border-radius: 8px;
  padding: 5px 9px;
  margin-top: 4px;
}

.form-field.full-width {
  grid-column: 1 / -1;
}

.field-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

.priority-pill-group {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.pri-seg-btn {
  height: 36px;
  padding: 0 4px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--input-bg);
  color: var(--text-tertiary);
  font: 700 10px var(--font-mono);
  cursor: pointer;
  transition: all 0.14s ease;
}

.pri-seg-btn:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
  background: var(--fill-hover);
}

.pri-seg-btn.p0.active {
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  border-color: color-mix(in srgb, var(--danger) 42%, transparent);
  color: var(--danger);
}

.pri-seg-btn.p1.active {
  background: color-mix(in srgb, var(--lime) 16%, transparent);
  border-color: color-mix(in srgb, var(--lime) 42%, transparent);
  color: var(--lime-strong);
}

.pri-seg-btn.p2.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.pri-seg-btn.p3.active {
  background: var(--fill-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--border-l1);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  transition: all 0.14s ease;
}

.form-input:focus,
.form-textarea:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-soft);
  background: var(--input-bg);
}

/* Conflict Alert */
.conflict-alert-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 32%, transparent);
  color: var(--danger);
  font-size: 12px;
  grid-column: 1 / -1;
  animation: fadeIn 0.15s ease;
}

.alert-icon {
  font-size: 16px;
  flex: none;
}

.alert-title {
  font-weight: 650;
  color: var(--danger);
  margin-bottom: 4px;
}

.alert-action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.alert-tip {
  color: var(--text-muted);
  font-size: 11px;
}

.resolve-btn {
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 42%, transparent);
  color: var(--danger);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.14s ease;
}

.resolve-btn:hover {
  background: var(--danger);
  color: #fff;
}

/* Preset Tags */
.preset-tags-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}

.preset-tag-btn {
  background: var(--fill-subtle);
  border: 1px solid var(--border-l1);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.preset-tag-btn:hover {
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.preset-tag-btn.active {
  background: var(--cta-bg);
  border-color: transparent;
  color: var(--cta-ink);
  font-weight: 700;
}

/* Subtasks */
.subtasks-box {
  background: var(--fill-subtle);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-l1);
}

.subtask-input-line {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.subtask-text-input {
  flex: 1;
}

.add-subtask-btn {
  padding: 0 13px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
  font-size: 11.5px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.14s ease;
}

.add-subtask-btn:hover {
  background: var(--tide);
  border-color: var(--tide);
  color: var(--ink-on-accent);
}

.subtasks-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  max-height: 120px;
  overflow-y: auto;
}

.subtask-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
}

.subtask-checkbox {
  cursor: pointer;
  accent-color: var(--tide);
}

.subtask-title {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
}

.subtask-title.done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.subtask-progress-track {
  height: 4px;
  background: var(--fill-hover);
  border-radius: 999px;
  margin: 6px 0 8px;
  overflow: hidden;
}

.subtask-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--tide), var(--lime-strong));
  transition: width 0.25s ease;
}

.subtask-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.order-subtask-btn {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 4px;
  opacity: 0.7;
}

.order-subtask-btn:hover:not(:disabled) {
  opacity: 1;
  color: var(--accent-text);
  background: var(--fill-hover);
}

.order-subtask-btn:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}

.del-subtask-btn {
  background: transparent;
  border: 0;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
}

.del-subtask-btn:hover {
  color: var(--danger);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 6px;
}

.cancel-btn {
  padding: 0 14px;
  height: 34px;
}

.ai-polish-btn {
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--tide-text);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-polish-btn:hover:not(:disabled) {
  background: var(--tide);
  border-color: var(--tide);
  color: var(--ink-on-accent);
  transform: translateY(-1px);
}

.ai-polish-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.night-guard-banner {
  margin-top: 6px;
  padding: 6px 10px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--accent-text);
}

.night-adjust-btn {
  background: var(--cta-bg);
  border: none;
  color: var(--cta-ink);
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
}

.night-adjust-btn:hover {
  background: var(--cta-bg-hover);
}

.pinned-checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--warning);
  cursor: pointer;
}

.subtask-presets-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.preset-chip {
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  font: 600 10px var(--font-mono);
  padding: 2px 7px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.15s;
}

.preset-chip:hover {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--accent-text);
}
</style>
