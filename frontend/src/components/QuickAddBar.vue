<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { ParseMultipleRemindersWithAI } from '../../bindings/agenda-desktop/internal/agenda/agendaservice';
import type { CreateReminderRequest } from '../../bindings/agenda-desktop/internal/agenda/models';
import { parseReminderTags } from '../domain/reminder';
import { formatDateLabel, formatRepeatLabel, formatTime } from '../utils/format';
import { parseNaturalReminder, type ParsedReminder } from '../utils/nlp';
import { getTagColor } from '../utils/tagColors';
import TunerDurationDial from './TunerDurationDial.vue';

const props = withDefaults(defineProps<{ submitting?: boolean }>(), { submitting: false });

const emit = defineEmits<{
  (e: 'submit', parsed: ParsedReminder, onSuccess: () => void): void;
  (e: 'ai-batch-submit', requests: CreateReminderRequest[], onSuccess: () => void): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
}>();

const inputVal = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isAiParsing = ref(false);
const forceAi = ref<boolean | null>(null);
const priorityOverride = ref<string | null>(null);
const durationOverride = ref<number | null>(null);
const busy = computed(() => isAiParsing.value || props.submitting);

function isLikelyCompositeSchedule(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (value.length > 60 || value.includes('\n')) return true;
  if ((value.match(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/g) || []).length >= 2) return true;
  return /(处理事项|提醒事项|后续建议|排查原因|早[、，\s]*中[、，\s]*晚|早[、，\s]*晚|每天[两二三四五六七八九\d]+次|一日[两二三四五六七八九\d]+次|一三五|二四六|\d{1,2}[:点]\d{0,2}.*[、和与及，,;；].*\d{1,2}[:点]\d{0,2})/.test(value);
}

const isAutoComposite = computed(() => isLikelyCompositeSchedule(inputVal.value));
const isAiMode = computed(() => forceAi.value ?? isAutoComposite.value);
const parsed = computed(() => inputVal.value.trim() ? parseNaturalReminder(inputVal.value) : null);
const parsedTags = computed(() => (parsed.value ? parseReminderTags(parsed.value.tags) : []));
function getDefaultLead(): number {
  const value = Number(localStorage.getItem('agenda_default_lead') || '10');
  return Number.isFinite(value) && value >= 0 ? value : 10;
}

const effectivePriority = computed(() => priorityOverride.value || parsed.value?.priority || 'p2');
const effectiveDuration = computed(() => durationOverride.value ?? parsed.value?.durationMinutes ?? 30);
const effectiveLead = computed(() => parsed.value?.leadSpecified ? parsed.value.leadMinutes : getDefaultLead());
const previewTime = computed(() => {
  if (!parsed.value) return '';
  return `${formatDateLabel(parsed.value.scheduledAt).label} ${formatTime(parsed.value.scheduledAt)}`;
});

function reset() {
  inputVal.value = '';
  forceAi.value = null;
  priorityOverride.value = null;
  durationOverride.value = null;
  void nextTick(resizeTextarea);
}

function removePreviewTag(tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  inputVal.value = inputVal.value
    .replace(new RegExp(`(^|\\s)#${escaped}(?=\\s|$)`, 'g'), '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  void nextTick(() => {
    resizeTextarea();
    textareaRef.value?.focus();
  });
}

function toggleAiMode() {
  if (forceAi.value === null) forceAi.value = !isAiMode.value;
  else if (forceAi.value) forceAi.value = false;
  else forceAi.value = null;
}

async function submitWithAI() {
  const query = inputVal.value.trim();
  if (!query || busy.value) return;
  isAiParsing.value = true;
  try {
    const requests = await ParseMultipleRemindersWithAI(query);
    if (!requests?.length) {
      emit('toast', '没有识别出可创建的日程，请调整描述', 'info');
      return;
    }
    emit('ai-batch-submit', requests, reset);
  } catch (error: any) {
    emit('toast', `AI 解析失败：${error.message || error}`, 'error');
  } finally {
    isAiParsing.value = false;
  }
}

function submitLocal() {
  if (!parsed.value) return void submitWithAI();
  emit('submit', {
    ...parsed.value,
    priority: effectivePriority.value,
    durationMinutes: effectiveDuration.value,
    leadMinutes: effectiveLead.value,
  }, reset);
}

function submit() {
  if (!inputVal.value.trim() || busy.value) return;
  if (isAiMode.value) void submitWithAI();
  else submitLocal();
}

function resizeTextarea() {
  const element = textareaRef.value;
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 104)}px`;
}

defineExpose({ focus: () => textareaRef.value?.focus() });
</script>

<template>
  <section
    class="quick-add-wrap st-reticle"
    :class="{ 'ai-mode': isAiMode, 'ai-busy': isAiParsing, expanded: inputVal.trim() }"
    aria-label="快速添加日程"
  >
    <!-- Skein Bioluminescent Beam Edge (Active in AI Mode) -->
    <div v-if="isAiMode" class="skein-beam-rail" aria-hidden="true"></div>

    <div class="composer-main">
      <span class="composer-icon" :class="{ 'is-ai': isAiMode }" aria-hidden="true">
        <svg v-if="!isAiMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" /><path d="m18 15 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z" /></svg>
      </span>
      <textarea ref="textareaRef" v-model="inputVal" rows="1" placeholder="输入日程，例如：明天下午 3 点评审方案 #工作 P1（粘贴多条文本自动启用 AI Skein 拆解）" aria-label="快速添加日程" :disabled="busy" @input="resizeTextarea" @keydown.enter.exact.prevent="submit" @keydown.meta.enter.prevent="submit" @keydown.ctrl.enter.prevent="submit" @keydown.esc.prevent="reset"></textarea>
      <button v-if="inputVal" class="composer-clear" type="button" :disabled="busy" title="清空" aria-label="清空" @click="reset">×</button>

      <!-- Ember & Tide Style Rim-Lit Mode Switch -->
      <button
        class="ai-mode-button"
        type="button"
        :disabled="busy"
        :class="{ active: isAiMode }"
        :title="isAiMode ? '当前使用 AI 拆解，点击切换模式' : '使用 AI 拆解复杂日程'"
        @click="toggleAiMode"
      >
        <i class="mode-orb" aria-hidden="true"></i>
        <span>AI</span>
        <small v-if="forceAi === null">AUTO</small>
      </button>

      <button class="composer-submit" type="button" :disabled="!inputVal.trim() || busy" @click="submit">
        <span v-if="busy" class="spinner"></span>
        <span>{{ busy ? (isAiParsing ? '解析中' : '保存中') : (isAiMode ? '拆解并创建' : '添加') }}</span>
        <kbd v-if="!busy">↵</kbd>
      </button>
    </div>

    <div v-if="inputVal.trim()" class="composer-preview" aria-live="polite">
      <template v-if="isAiMode">
        <span class="skein-thread-badge" aria-hidden="true"></span>
        <span class="mode-note"><strong>AI SKEIN</strong> 正在监听复合语义：按回车拆解多项任务、排期与重复规则</span>
      </template>
      <template v-else-if="parsed">
        <span class="preview-item accent tabular-nums">{{ previewTime }}</span>
        <span v-if="parsed.repeatRule" class="preview-item">{{ formatRepeatLabel(parsed.repeatRule) }}</span>
        <span class="preview-item tabular-nums">提前 {{ effectiveLead }} 分钟</span>
        <TunerDurationDial
          :modelValue="effectiveDuration"
          compact
          @update:modelValue="durationOverride = $event"
        />
        <div class="priority-picker" aria-label="优先级">
          <button v-for="priority in ['p0', 'p1', 'p2', 'p3']" :key="priority" type="button" :class="[priority, { active: effectivePriority === priority }]" @click="priorityOverride = priority">{{ priority.toUpperCase() }}</button>
        </div>
        <div v-if="parsedTags.length" class="preview-tags">
          <button
            v-for="tag in parsedTags"
            :key="tag"
            type="button"
            class="preview-tag"
            :title="`点击移除 #${tag}`"
            :style="{
              '--tag-bg': getTagColor(tag).bg,
              '--tag-text': getTagColor(tag).text,
              '--tag-border': getTagColor(tag).border,
            }"
            @click="removePreviewTag(tag)"
          >#{{ tag }}<span aria-hidden="true">×</span></button>
        </div>
        <span class="preview-title" :title="parsed.title">{{ parsed.title }}</span>
      </template>
    </div>
  </section>
</template>

<style scoped>
.quick-add-wrap {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background:
    radial-gradient(65% 120% at 8% 0%, color-mix(in srgb, var(--tide) 7%, transparent), transparent 60%),
    var(--surface-raised);
  box-shadow: var(--shadow-sm);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}
.quick-add-wrap:focus-within {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow-sm);
}
.quick-add-wrap.ai-mode {
  border-color: color-mix(in srgb, var(--tide) 45%, var(--border-subtle));
  background:
    radial-gradient(60% 140% at 90% 0%, color-mix(in srgb, var(--lime) 9%, transparent), transparent 60%),
    radial-gradient(65% 120% at 10% 0%, color-mix(in srgb, var(--tide) 12%, transparent), transparent 60%),
    var(--surface-raised);
}

.skein-beam-rail {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--tide), var(--lime), var(--tide), transparent);
  background-size: 200% 100%;
  animation: skein-flow 3.2s linear infinite;
  opacity: 0.78;
  pointer-events: none;
}
.ai-busy .skein-beam-rail {
  animation-duration: 1.1s;
  opacity: 1;
}
@keyframes skein-flow {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.composer-main { min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 7px 10px 7px 14px; }
.composer-icon {
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--fill-hover);
  border: 1px solid var(--border-subtle);
  color: var(--accent-text);
  transition: all var(--motion-fast);
}
.composer-icon.is-ai {
  background: color-mix(in srgb, var(--tide) 18%, transparent);
  border-color: var(--accent-border);
  box-shadow: 0 0 12px color-mix(in srgb, var(--tide) 28%, transparent);
}
.composer-icon svg { width: 15px; height: 15px; }
textarea { flex: 1; min-width: 0; height: 21px; max-height: 104px; resize: none; overflow-y: auto; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: 500 12.5px/1.65 var(--font-family); }
textarea::placeholder { color: var(--text-quaternary); }
.composer-clear { width: 25px; height: 25px; border: 0; border-radius: 50%; background: transparent; color: var(--text-quaternary); cursor: pointer; font-size: 16px; }
.composer-clear:hover { background: var(--fill-hover); color: var(--text-primary); }

/* Ember & Tide Switch Pill */
.ai-mode-button {
  height: 30px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: var(--input-bg);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--motion-fast);
}
.mode-orb {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-quaternary);
  transition: all var(--motion-fast);
}
.ai-mode-button span { font: 700 10px var(--font-mono); letter-spacing: 0.04em; }
.ai-mode-button small { font: 600 8px var(--font-mono); letter-spacing: 0.08em; opacity: 0.7; }
.ai-mode-button:hover { border-color: var(--border-strong); color: var(--text-primary); }
.ai-mode-button.active {
  border-color: var(--accent-border);
  background: color-mix(in srgb, var(--tide) 14%, var(--input-bg));
  color: var(--tide-text);
  box-shadow: 0 0 14px color-mix(in srgb, var(--tide) 24%, transparent);
}
.ai-mode-button.active .mode-orb {
  background: var(--lime);
  box-shadow: 0 0 8px var(--lime);
}

/* Signature Scrolltide High-Contrast Submit Pill */
.composer-submit {
  height: 32px;
  min-width: 78px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 13px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--cta-bg);
  color: var(--cta-ink);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--motion-fast);
}
.composer-submit:hover:not(:disabled) {
  background: var(--cta-bg-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.3), 0 0 14px var(--accent-soft);
}
.composer-submit:disabled { opacity: 0.35; cursor: default; }
.composer-submit kbd { opacity: 0.58; font-size: 10px; }
.spinner { width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--cta-ink) 26%, transparent); border-top-color: var(--cta-ink); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.composer-preview {
  min-height: 38px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  padding: 6px 12px 7px 52px;
  border-top: 1px solid var(--border-subtle);
  background: color-mix(in oklab, var(--input-bg) 55%, transparent);
}
.skein-thread-badge {
  width: 14px;
  height: 2px;
  border-radius: 99px;
  background: linear-gradient(90deg, var(--tide), var(--lime));
  box-shadow: 0 0 8px var(--tide);
}
.mode-note { color: var(--text-tertiary); font-size: 10.5px; }
.mode-note strong { margin-right: 6px; color: var(--tide-text); font-family: var(--font-mono); letter-spacing: 0.08em; font-size: 9.5px; }
.preview-item { flex: none; padding: 3px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--fill-subtle); color: var(--text-tertiary); font: 600 9.5px var(--font-mono); }
.preview-item.accent { color: var(--tide-text); border-color: var(--accent-border); background: var(--accent-soft); }
.preview-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.preview-tag { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 999px; background: var(--tag-bg); color: var(--tag-text); border: 1px solid var(--tag-border); font: 600 9.5px var(--font-mono); line-height: 1.3; cursor: pointer; transition: transform var(--motion-fast), filter var(--motion-fast); }
.preview-tag span { font-size: 11px; line-height: 1; opacity: 0.55; transition: opacity var(--motion-fast); }
.preview-tag:hover { transform: translateY(-1px); }
.preview-tag:hover span { opacity: 1; }
.preview-title { min-width: 100px; flex: 1; overflow: hidden; color: var(--text-secondary); font-size: 11px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.priority-picker { display: flex; gap: 2px; padding: 2px; border-radius: 999px; border: 1px solid var(--border-subtle); background: var(--input-bg); }
.priority-picker button { height: 22px; padding: 0 7px; border: 0; border-radius: 999px; background: transparent; color: var(--text-quaternary); font: 700 9px var(--font-mono); cursor: pointer; transition: all var(--motion-fast); }
.priority-picker button:hover { color: var(--text-primary); }
.priority-picker button.active { background: var(--fill-hover); color: var(--text-primary); }
.priority-picker .p0.active { background: rgba(255, 101, 104, 0.18); color: var(--danger); }
.priority-picker .p1.active { background: color-mix(in srgb, var(--lime) 20%, transparent); color: var(--lime-strong); }
.priority-picker .p2.active { background: var(--accent-soft); color: var(--tide-text); }
</style>
