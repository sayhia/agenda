<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  AnalyzeScheduleConflicts,
  ChatWithAI,
  ClearAIChatHistory,
  GenerateDailyBriefing,
  GetAIChatHistory,
  GetAIConfig,
  ParseMultipleRemindersWithAI,
  SaveAIChatMessage,
} from '../../bindings/agenda/internal/agenda/agendaservice';
import type { AIChatMessage, AIConfig, Reminder } from '../../bindings/agenda/internal/agenda/models';
import { parseReminderTags } from '../domain/reminder';
import { formatDateLabel, formatRepeatLabel, formatTime } from '../utils/format';
import { getTagColor } from '../utils/tagColors';
import { sanitizeHTML } from '../utils/sanitize';
import { extractActions, type ActionItem } from '../utils/aiAction';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

export type { ActionItem };

interface MessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: ActionItem[];
}

interface SlashCommand {
  cmd: string;
  label: string;
  desc: string;
  run: () => void;
}

const props = withDefaults(defineProps<{
  visible: boolean;
  reminders?: Reminder[];
  overdueCount?: number;
}>(), {
  reminders: () => [],
  overdueCount: 0,
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply-action', action: any): void;
  (e: 'edit-action', action: ActionItem): void;
  (e: 'open-settings'): void;
}>();

const inputPrompt = ref('');
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const chatBodyRef = ref<HTMLElement | null>(null);
const isThinking = ref(false);
const isExpanded = ref(false);
const extractingMsgId = ref<string | null>(null);
const copiedId = ref<string | null>(null);
const confirmClearHistory = ref(false);
const currentConfig = ref<AIConfig | null>(null);
const batchExcluded = ref<Record<string, boolean>>({});
const slashDismissed = ref(false);
const slashActiveIndex = ref(0);

const WELCOME_MSG: MessageItem = {
  id: 'welcome',
  role: 'assistant',
  content: '日程智能副驾已就绪。',
};

const messages = ref<MessageItem[]>([{ ...WELCOME_MSG }]);

let copyTimer: ReturnType<typeof setTimeout>;
let clearConfirmTimer: ReturnType<typeof setTimeout>;
let chatGeneration = 0;
let persistenceQueue: Promise<void> = Promise.resolve();

const hasConversation = computed(() =>
  messages.value.some((m) => m.id !== 'welcome'),
);

const hasApiKey = computed(() => Boolean(currentConfig.value?.api_key?.trim()));
const modelLabel = computed(() => currentConfig.value?.model?.trim() || 'deepseek-chat');

const todayDateKey = computed(() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
});

const activeCount = computed(() =>
  props.reminders.filter((r) => r.status === 'active').length,
);

const todayCount = computed(() =>
  props.reminders.filter((r) => {
    if (r.status !== 'active' || !r.scheduled_at) return false;
    const dt = new Date(r.scheduled_at);
    if (!Number.isFinite(dt.getTime())) return false;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return key === todayDateKey.value;
  }).length,
);

const slashCommands: SlashCommand[] = [
  {
    cmd: '/briefing',
    label: '今日日程早报',
    desc: '汇总今日优先事项、时间块分配与推进建议',
    run: () => {
      clearComposer();
      void triggerDailyBriefing();
    },
  },
  {
    cmd: '/conflict',
    label: '冲突诊断与避让',
    desc: '检测日程时间重叠并生成可执行改期方案',
    run: () => {
      clearComposer();
      void triggerConflictCheck();
    },
  },
  {
    cmd: '/overdue',
    label: '清理重排逾期项',
    desc: '评估已逾期事项优先级并顺延至合适时段',
    run: () => {
      clearComposer();
      void sendMessage('请帮我检查当前已逾期的日程，给出合理的重排时间与优先级调整建议。');
    },
  },
  {
    cmd: '/plan',
    label: '规划明日时间块',
    desc: '基于现有日程密度编排明日高效专注时段',
    run: () => {
      clearComposer();
      void sendMessage('请根据我当前的日程密度，为我规划明天上午和下午的高效时间块安排。');
    },
  },
  {
    cmd: '/breakdown',
    label: '多任务复合拆解',
    desc: '填入拆解模板，把长段落直接拆为可执行日程卡',
    run: () => {
      inputPrompt.value = '帮我拆解以下安排并生成日程：\n1. ';
      slashDismissed.value = false;
      void nextTick(() => {
        resizeComposer();
        textareaRef.value?.focus();
      });
    },
  },
  {
    cmd: '/clear',
    label: '开启新对话',
    desc: '清空当前上下文记录并回到起手台',
    run: () => {
      clearComposer();
      confirmClearHistory.value = true;
      void handleClearHistory();
    },
  },
];

const filteredSlashCommands = computed(() => {
  const val = inputPrompt.value;
  if (!val.startsWith('/') || val.includes('\n')) return [];
  const query = val.slice(1).trim().toLowerCase();
  if (!query) return slashCommands;
  return slashCommands.filter(
    (c) =>
      c.cmd.slice(1).includes(query) ||
      c.label.toLowerCase().includes(query) ||
      c.desc.toLowerCase().includes(query),
  );
});

const slashMenuOpen = computed(() =>
  !slashDismissed.value &&
  inputPrompt.value.startsWith('/') &&
  !inputPrompt.value.includes('\n') &&
  filteredSlashCommands.value.length > 0,
);

watch(filteredSlashCommands, () => {
  slashActiveIndex.value = 0;
});

watch(inputPrompt, (val) => {
  if (!val.startsWith('/')) slashDismissed.value = false;
  void nextTick(resizeComposer);
});

const lastMessage = computed(() =>
  messages.value.length ? messages.value[messages.value.length - 1] : null,
);

const followUpSuggestions = computed<string[]>(() => {
  if (!hasConversation.value || isThinking.value) return [];
  const last = lastMessage.value;
  if (!last || last.role !== 'assistant') return [];
  const text = last.content || '';
  if (last.actions && last.actions.length > 0) {
    return [
      '再帮我检查这些新日程是否和现有安排冲突',
      '给高优先事项补充 15 分钟复盘提醒',
    ];
  }
  if (/冲突|重叠|时间段/.test(text)) {
    return [
      '请直接给出避让后的具体修改方案卡片',
      '帮我把低优先冲突项顺延到明天下午',
    ];
  }
  if (/早报|今日|逾期/.test(text)) {
    return [
      '帮我把今日核心任务按 45 分钟专注块排进时间表',
      '将已逾期事项统一顺延并生成更新建议',
    ];
  }
  return [
    '把上述建议提取成可一键添加的日程卡片',
    '帮我检测当前是否存在时间冲突',
  ];
});

function renderMarkdown(content: string): string {
  if (!content) return '';
  try {
    return sanitizeHTML(marked.parse(content, { async: false }) as string);
  } catch {
    return sanitizeHTML(content);
  }
}

function resizeComposer() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 136)}px`;
}

function clearComposer() {
  inputPrompt.value = '';
  slashDismissed.value = false;
  void nextTick(resizeComposer);
}

function scrollToBottom() {
  void nextTick(() => {
    if (chatBodyRef.value) {
      chatBodyRef.value.scrollTop = chatBodyRef.value.scrollHeight;
    }
  });
}

function persistMessage(message: MessageItem): Promise<void> {
  const actionsJSON = message.actions?.length ? JSON.stringify(message.actions) : '';
  const operation = persistenceQueue.then(() =>
    SaveAIChatMessage(message.id, message.role, message.content, actionsJSON),
  );
  persistenceQueue = operation.catch(() => undefined);
  return operation;
}

function appendPersistenceError(error: unknown) {
  messages.value.push({
    id: `persist-error-${Date.now()}`,
    role: 'assistant',
    content: `本地保存对话失败：${error instanceof Error ? error.message : String(error)}`,
  });
}

watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    slashDismissed.value = false;
    try {
      currentConfig.value = await GetAIConfig();
      const history = await GetAIChatHistory();
      if (history && history.length > 0) {
        messages.value = history.map((h) => {
          let actions: ActionItem[] | undefined;
          let content = h.content;
          if (h.actions_json) {
            try {
              actions = JSON.parse(h.actions_json);
            } catch {}
          }
          if ((!actions || actions.length === 0) && h.role === 'assistant') {
            const extracted = extractActions(content);
            if (extracted.actions.length > 0) {
              actions = extracted.actions;
              content = extracted.text;
              void SaveAIChatMessage(h.id, h.role, content, JSON.stringify(actions)).catch(() => {});
            }
          }
          return {
            id: h.id,
            role: h.role as 'user' | 'assistant',
            content,
            actions,
          };
        });
      } else {
        messages.value = [{ ...WELCOME_MSG }];
      }
    } catch (error: any) {
      messages.value.push({
        id: `history-error-${Date.now()}`,
        role: 'assistant',
        content: `无法加载 AI 配置或历史记录：${error.message || error}`,
      });
    }
    scrollToBottom();
    void nextTick(() => textareaRef.value?.focus());
  },
);

function handleWindowKeydown(e: KeyboardEvent) {
  if (!props.visible) return;
  if (e.key === 'Escape' && slashMenuOpen.value) {
    e.preventDefault();
    e.stopPropagation();
    slashDismissed.value = true;
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleWindowKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown, true);
  clearTimeout(copyTimer);
  clearTimeout(clearConfirmTimer);
});

async function copyMessage(m: MessageItem) {
  try {
    await navigator.clipboard.writeText(m.content);
    copiedId.value = m.id;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copiedId.value = null;
    }, 2000);
  } catch (e) {
    console.error('Failed to copy message:', e);
  }
}

function reuseUserPrompt(m: MessageItem) {
  inputPrompt.value = m.content;
  void nextTick(() => {
    resizeComposer();
    textareaRef.value?.focus();
  });
}

async function regenerateAssistantMessage(msgId: string) {
  if (isThinking.value) return;
  const msgIndex = messages.value.findIndex((item) => item.id === msgId);
  if (msgIndex <= 0) return;
  let promptContent = '';
  for (let i = msgIndex - 1; i >= 0; i--) {
    if (messages.value[i]?.role === 'user') {
      promptContent = messages.value[i].content;
      break;
    }
  }
  if (!promptContent) return;
  await runAssistantChatFromMessages(promptContent, msgIndex);
}

async function handleExtractFromMessage(m: MessageItem) {
  extractingMsgId.value = m.id;
  try {
    const directExtract = extractActions(m.content);
    if (directExtract.actions.length > 0) {
      m.actions = directExtract.actions;
      m.content = directExtract.text;
      await persistMessage(m).catch(appendPersistenceError);
      scrollToBottom();
      return;
    }

    const list = await ParseMultipleRemindersWithAI(m.content);
    if (!list || list.length === 0) return;
    m.actions = list.map((it) => ({
      action: 'create',
      title: it.title,
      scheduled_at: it.scheduled_at,
      repeat_rule: it.repeat_rule,
      lead_minutes: it.lead_minutes,
      duration_minutes: it.duration_minutes,
      notes: it.notes,
      priority: it.priority || 'p2',
      tags: it.tags || '',
      applied: false,
    }));
    await persistMessage(m).catch(appendPersistenceError);
    scrollToBottom();
  } catch (err: any) {
    console.error('Extract error:', err);
  } finally {
    extractingMsgId.value = null;
  }
}

async function handleClearHistory() {
  if (!confirmClearHistory.value) {
    confirmClearHistory.value = true;
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = setTimeout(() => { confirmClearHistory.value = false; }, 3000);
    return;
  }

  confirmClearHistory.value = false;
  clearTimeout(clearConfirmTimer);
  chatGeneration++;
  isThinking.value = false;
  batchExcluded.value = {};
  try {
    await ClearAIChatHistory();
    messages.value = [{ ...WELCOME_MSG }];
  } catch (error: any) {
    messages.value.push({
      id: `clear-error-${Date.now()}`,
      role: 'assistant',
      content: `清空对话失败：${error.message || error}`,
    });
  }
}


async function runAssistantChatFromMessages(overridePrompt?: string, replaceIdx?: number) {
  const generation = chatGeneration;
  isThinking.value = true;
  scrollToBottom();
  try {
    const baseList = typeof replaceIdx === 'number'
      ? messages.value.slice(0, replaceIdx)
      : messages.value;
    const apiMessages: AIChatMessage[] = baseList
      .filter((message) => message.id !== 'welcome' && !message.id.startsWith('persist-error-'))
      .map((message) => ({ role: message.role, content: message.content }));
    if (overridePrompt && apiMessages.length === 0) {
      apiMessages.push({ role: 'user', content: overridePrompt });
    }
    const reply = await ChatWithAI(apiMessages);
    if (generation !== chatGeneration) return;

    const { text, actions } = extractActions(reply);
    const assistantMessage: MessageItem = {
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: text,
      actions: actions.length ? actions : undefined,
    };
    if (typeof replaceIdx === 'number' && messages.value[replaceIdx]) {
      messages.value.splice(replaceIdx, 1, assistantMessage);
    } else {
      messages.value.push(assistantMessage);
    }
    await persistMessage(assistantMessage).catch(appendPersistenceError);
  } catch (err: any) {
    if (generation !== chatGeneration) return;
    const errorMessage: MessageItem = {
      id: `err-${Date.now()}`,
      role: 'assistant',
      content: `请求出错：${err.message || err}\n\n请点击顶栏模型状态胶囊检查 API Key 与模型设置。`,
    };
    messages.value.push(errorMessage);
    await persistMessage(errorMessage).catch(appendPersistenceError);
  } finally {
    if (generation === chatGeneration) {
      isThinking.value = false;
      scrollToBottom();
    }
  }
}

async function sendMessage(textToSend?: string) {
  const prompt = (textToSend ?? inputPrompt.value).trim();
  if (!prompt || isThinking.value) return;

  if (!textToSend && prompt.startsWith('/')) {
    const exact = slashCommands.find((c) => c.cmd === prompt.toLowerCase());
    if (exact) {
      exact.run();
      return;
    }
  }

  const userMessage: MessageItem = {
    id: `msg-${Date.now()}`,
    role: 'user',
    content: prompt,
  };
  messages.value.push(userMessage);
  if (!textToSend) clearComposer();
  scrollToBottom();

  try {
    await persistMessage(userMessage);
  } catch (error) {
    appendPersistenceError(error);
  }

  await runAssistantChatFromMessages();
}

async function runAssistantTool(
  requestText: string,
  execute: () => Promise<string>,
  errorLabel: string,
  responsePrefix: string,
) {
  if (isThinking.value) return;
  const generation = chatGeneration;
  const requestMessage: MessageItem = { id: `req-${Date.now()}`, role: 'user', content: requestText };
  messages.value.push(requestMessage);
  await persistMessage(requestMessage).catch(appendPersistenceError);
  isThinking.value = true;
  scrollToBottom();

  try {
    const response = await execute();
    if (generation !== chatGeneration) return;
    const { text, actions } = extractActions(response);
    const responseMessage: MessageItem = {
      id: `${responsePrefix}-${Date.now()}`,
      role: 'assistant',
      content: text,
      actions: actions.length ? actions : undefined,
    };
    messages.value.push(responseMessage);
    await persistMessage(responseMessage).catch(appendPersistenceError);
  } catch (error: any) {
    if (generation !== chatGeneration) return;
    const errorMessage: MessageItem = {
      id: `err-${Date.now()}`,
      role: 'assistant',
      content: `${errorLabel}：${error.message || error}`,
    };
    messages.value.push(errorMessage);
    await persistMessage(errorMessage).catch(appendPersistenceError);
  } finally {
    if (generation === chatGeneration) {
      isThinking.value = false;
      scrollToBottom();
    }
  }
}

function triggerDailyBriefing() {
  return runAssistantTool('请为我生成今天的日程早报。', GenerateDailyBriefing, '生成早报失败', 'brief');
}

function triggerConflictCheck() {
  return runAssistantTool('请帮我检测日程是否存在时间冲突。', AnalyzeScheduleConflicts, '冲突检测失败', 'conf');
}

function triggerBreakdownTemplate() {
  inputPrompt.value = '请帮我拆解以下复合计划并生成多条日程：\n';
  void nextTick(() => {
    resizeComposer();
    textareaRef.value?.focus();
  });
}

function applyPromptTemplate(template: string) {
  if (template === '拆解 5 步里程碑') {
    inputPrompt.value = '请帮我将以下任务目标拆解为 5 个清晰可交付的里程碑日程，并估算耗时与优先级：\n【目标】：';
  } else if (template === '今日时间箱 Timebox') {
    inputPrompt.value = '请帮我为今日待办安排高效的「时间箱 (Timeboxing)」工作流，合理设置专注块与中场休息。';
  } else if (template === '排查今日重叠冲突') {
    void triggerConflictCheck();
    return;
  } else if (template === '提炼行动动词与核心产出') {
    inputPrompt.value = '请帮我优化以下待办清单的标题，统一使用明确的强动词开头（如「编写/联调/交付」），并明确核心交付物：\n';
  }
  void nextTick(() => {
    resizeComposer();
    textareaRef.value?.focus();
  });
}

function openSlashFromButton() {
  if (!inputPrompt.value.startsWith('/')) {
    inputPrompt.value = `/${inputPrompt.value}`;
  }
  slashDismissed.value = false;
  slashActiveIndex.value = 0;
  void nextTick(() => textareaRef.value?.focus());
}

function handleComposerKeydown(e: KeyboardEvent) {
  if (slashMenuOpen.value) {
    const total = filteredSlashCommands.value.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashActiveIndex.value = (slashActiveIndex.value + 1) % total;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashActiveIndex.value = (slashActiveIndex.value - 1 + total) % total;
      return;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault();
      const target = filteredSlashCommands.value[slashActiveIndex.value];
      if (target) target.run();
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
}

function handleApplySingle(message: MessageItem, item: ActionItem) {
  emit('apply-action', {
    ...item,
    action: item.action || 'create',
    __onApplied: () => {
      item.applied = true;
      void persistMessage(message).catch(appendPersistenceError);
    },
  });
}

function batchKey(msgId: string, idx: number): string {
  return `${msgId}:${idx}`;
}

function isBatchItemSelected(msgId: string, idx: number, item: ActionItem): boolean {
  if (item.applied) return false;
  return !batchExcluded.value[batchKey(msgId, idx)];
}

function toggleBatchItemSelection(msgId: string, idx: number) {
  const key = batchKey(msgId, idx);
  batchExcluded.value[key] = !batchExcluded.value[key];
}

function pendingActions(actions: ActionItem[]): ActionItem[] {
  return actions.filter((item) => !item.applied);
}

function selectedPendingActions(msgId: string, actions: ActionItem[]): ActionItem[] {
  return actions.filter((item, idx) => !item.applied && isBatchItemSelected(msgId, idx, item));
}

function handleApplySelected(message: MessageItem, actions: ActionItem[]) {
  const targets = selectedPendingActions(message.id, actions);
  if (!targets.length) return;
  emit('apply-action', {
    action: 'create_batch',
    items: targets,
    __onItemApplied: (index: number) => {
      if (targets[index]) targets[index].applied = true;
      void persistMessage(message).catch(appendPersistenceError);
    },
    __onApplied: () => {
      targets.forEach((item) => { item.applied = true; });
      void persistMessage(message).catch(appendPersistenceError);
    },
  });
}

function actionLabel(action?: string): { code: string; text: string; tone: 'create' | 'update' | 'snooze' | 'danger' | 'done' } {
  const kind = (action || 'create').toLowerCase();
  if (kind === 'delete') return { code: 'DELETE', text: '建议删除日程', tone: 'danger' };
  if (kind === 'update') return { code: 'UPDATE', text: '建议调整日程', tone: 'update' };
  if (kind === 'snooze') return { code: 'SNOOZE', text: '建议顺延日程', tone: 'snooze' };
  if (kind === 'complete' || kind === 'end') return { code: 'DONE', text: '建议完成日程', tone: 'done' };
  if (kind === 'pause') return { code: 'PAUSE', text: '建议暂停日程', tone: 'snooze' };
  if (kind === 'resume') return { code: 'RESUME', text: '建议恢复日程', tone: 'update' };
  return { code: 'CREATE', text: '建议安排日程', tone: 'create' };
}
</script>

<template>
  <div v-if="visible" class="drawer-overlay" @click.self="$emit('close')">
    <div
      class="drawer-panel"
      :class="{ 'is-expanded': isExpanded }"
      role="dialog"
      aria-modal="true"
      aria-label="日程智能副驾"
    >
      <!-- Header Command Bar -->
      <header class="drawer-header">
        <div class="ai-title-wrap">
          <div class="ai-sparkle-icon" :class="{ thinking: isThinking }" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17">
              <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
            </svg>
          </div>
          <div class="header-copy">
            <div class="title-row">
              <span class="copilot-eyebrow">COPILOT</span>
              <h3 class="drawer-title">日程智能副驾</h3>
            </div>
            <button
              type="button"
              class="model-status-pill"
              :class="{ ready: hasApiKey, warn: !hasApiKey }"
              :title="hasApiKey ? '当前大模型已配置，点击打开设置修改' : '未检测到 API Key，点击前往设置配置大模型'"
              @click="$emit('open-settings')"
            >
              <i class="status-led" aria-hidden="true"></i>
              <span>{{ hasApiKey ? `${modelLabel} · READY` : `${modelLabel} · 未配置 Key` }}</span>
            </button>
          </div>
        </div>

        <div class="header-right-btns">
          <button
            type="button"
            class="icon-btn width-toggle-btn"
            :title="isExpanded ? '收窄为标准抽屉 (520px)' : '展开为宽屏工作台 (740px)'"
            :aria-pressed="isExpanded"
            @click="isExpanded = !isExpanded"
          >
            <svg v-if="!isExpanded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>

          <button
            v-if="hasConversation"
            type="button"
            class="icon-text-btn"
            :class="{ danger: confirmClearHistory }"
            :disabled="isThinking"
            :title="confirmClearHistory ? '再次点击确认重置对话' : '清空历史对话并返回起手台'"
            @click="handleClearHistory"
          >
            <span>{{ confirmClearHistory ? '确认新对话' : '新对话' }}</span>
          </button>

          <button type="button" class="icon-btn" title="关闭 (Esc)" aria-label="关闭" @click="$emit('close')">✕</button>
        </div>
      </header>

      <!-- Live Workspace Telemetry Context Strip -->
      <div class="telemetry-strip" aria-label="实时日程上下文">
        <div class="telemetry-metrics">
          <span class="tele-chip">
            <small>ACTIVE</small>
            <strong class="tabular-nums">{{ activeCount }}</strong>
          </span>
          <span class="tele-chip">
            <small>TODAY</small>
            <strong class="tabular-nums">{{ todayCount }}</strong>
          </span>
          <button
            v-if="overdueCount > 0"
            type="button"
            class="tele-chip alert"
            :disabled="isThinking"
            title="点击让 AI 帮你梳理并重排逾期日程"
            @click="sendMessage(`当前共有 ${overdueCount} 项已逾期日程，请帮我梳理优先级并给出合理重排方案。`)"
          >
            <small>OVERDUE</small>
            <strong class="tabular-nums">{{ overdueCount }} · 处理 →</strong>
          </button>
        </div>
        <span class="tele-hint">输入 <code>/</code> 唤起指令</span>
      </div>

      <!-- Main Body: Launchpad (when clean) OR Editorial Copilot Stream -->
      <div ref="chatBodyRef" class="chat-body">
        <!-- Empty / Launchpad Workbench -->
        <section v-if="!hasConversation" class="launchpad-wrap" aria-label="AI 助手起手工作台">
          <div v-if="!hasApiKey" class="api-warning-banner">
            <div class="api-warning-copy">
              <strong>尚未配置大模型 API Key</strong>
              <span>支持 DeepSeek / OpenAI / 本地 Ollama，配置后即可开启完整语义规划。</span>
            </div>
            <button type="button" class="banner-action-btn" @click="$emit('open-settings')">前往配置</button>
          </div>

          <div class="launchpad-hero">
            <span class="hero-kicker">SCROLLTIDE SCHEDULE ENGINE</span>
            <h4>告诉我你的计划，自动感知当前 {{ activeCount }} 项活跃日程</h4>
            <p>支持冲突诊断、日报汇总、时间块重排与多任务拆解。生成的所有建议均可先微调再入库。</p>
          </div>

          <div class="launchpad-grid">
            <button type="button" class="launch-card" :disabled="isThinking" @click="triggerDailyBriefing">
              <div class="launch-card-top">
                <span class="launch-icon tide">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
                  </svg>
                </span>
                <code>/briefing</code>
              </div>
              <strong>今日日程早报</strong>
              <small>汇总今日高低优分布、精力峰值与待推进重心</small>
            </button>

            <button type="button" class="launch-card" :disabled="isThinking" @click="triggerConflictCheck">
              <div class="launch-card-top">
                <span class="launch-icon warn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <code>/conflict</code>
              </div>
              <strong>冲突诊断与避让</strong>
              <small>定位时间重叠或过度拥挤区间，输出顺延建议</small>
            </button>

            <button type="button" class="launch-card" :disabled="isThinking" @click="triggerBreakdownTemplate">
              <div class="launch-card-top">
                <span class="launch-icon lime">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                </span>
                <code>/breakdown</code>
              </div>
              <strong>复合语义批量拆解</strong>
              <small>输入一段复盘或早中晚巡检清单，批量提取可勾选日程卡</small>
            </button>

            <button
              type="button"
              class="launch-card"
              :disabled="isThinking"
              @click="sendMessage('请根据我当前的日程密度，为我规划明天的高效时间块安排。')"
            >
              <div class="launch-card-top">
                <span class="launch-icon success">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </span>
                <code>/plan</code>
              </div>
              <strong>明日时间块规划</strong>
              <small>围绕既有排期空隙智能嵌入深度工作时段</small>
            </button>
          </div>
        </section>

        <!-- Editorial Conversation Stream -->
        <template v-else>
          <article
            v-for="m in messages.filter((item) => item.id !== 'welcome')"
            :key="m.id"
            class="stream-entry"
            :class="m.role"
          >
            <!-- User Entry -->
            <template v-if="m.role === 'user'">
              <div class="user-card-wrap">
                <div class="user-pill select-text">{{ m.content }}</div>
                <div class="entry-toolbar user-toolbar">
                  <button type="button" class="tool-btn" title="编辑并重新发送" @click="reuseUserPrompt(m)">
                    编辑重发
                  </button>
                  <button type="button" class="tool-btn" @click="copyMessage(m)">
                    {{ copiedId === m.id ? '已复制 ✓' : '复制' }}
                  </button>
                </div>
              </div>
            </template>

            <!-- Assistant Editorial Block -->
            <template v-else>
              <div class="assistant-block">
                <div class="assistant-role-row">
                  <span class="role-dot" aria-hidden="true"></span>
                  <span class="role-name">COPILOT</span>
                  <span class="role-model">{{ modelLabel }}</span>
                </div>

                <div
                  v-if="m.content"
                  class="markdown-body select-text"
                  v-html="renderMarkdown(m.content)"
                ></div>

                <!-- Structured Action Blueprint Cards -->
                <div v-if="m.actions && m.actions.length > 0" class="action-group">
                  <!-- Single Action Blueprint -->
                  <div
                    v-if="m.actions.length === 1"
                    class="blueprint-card"
                    :class="[actionLabel(m.actions[0].action).tone, { applied: m.actions[0].applied }]"
                  >
                    <div class="blueprint-head">
                      <span class="intent-badge" :class="actionLabel(m.actions[0].action).tone">
                        {{ actionLabel(m.actions[0].action).code }}
                      </span>
                      <span v-if="m.actions[0].priority" class="pri-tag" :class="(m.actions[0].priority || 'p2').toLowerCase()">
                        {{ (m.actions[0].priority || 'p2').toUpperCase() }}
                      </span>
                      <span v-if="m.actions[0].duration_minutes" class="dur-tag tabular-nums">
                        {{ m.actions[0].duration_minutes }}m
                      </span>
                      <span class="intent-desc">{{ actionLabel(m.actions[0].action).text }}</span>
                    </div>

                    <div class="blueprint-title">
                      {{ m.actions[0].title || '顺延日程' }}
                      <span v-if="m.actions[0].action === 'snooze'" class="snooze-offset">+{{ m.actions[0].minutes || 30 }} 分钟</span>
                    </div>

                    <div
                      v-if="m.actions[0].scheduled_at || m.actions[0].repeat_rule || m.actions[0].notes || m.actions[0].tags"
                      class="blueprint-meta"
                    >
                      <span v-if="m.actions[0].scheduled_at" class="chip chip-countdown tabular-nums">
                        {{ formatDateLabel(m.actions[0].scheduled_at).label }} {{ formatTime(m.actions[0].scheduled_at) }}
                      </span>
                      <span v-if="m.actions[0].repeat_rule" class="chip chip-repeat">
                        {{ formatRepeatLabel(m.actions[0].repeat_rule) }}
                      </span>
                      <span
                        v-for="tag in parseReminderTags(m.actions[0].tags)"
                        :key="tag"
                        class="meta-tag-pill"
                        :style="{
                          '--tag-bg': getTagColor(tag).bg,
                          '--tag-text': getTagColor(tag).text,
                          '--tag-border': getTagColor(tag).border,
                        }"
                      >#{{ tag }}</span>
                      <span v-if="m.actions[0].notes" class="chip chip-notes">{{ m.actions[0].notes }}</span>
                    </div>

                    <div class="blueprint-actions">
                      <button
                        v-if="(m.actions[0].action || 'create') === 'create' && !m.actions[0].applied"
                        type="button"
                        class="secondary-action-btn"
                        @click="$emit('edit-action', m.actions[0])"
                      >
                        在编辑器微调
                      </button>
                      <button
                        type="button"
                        class="primary-btn apply-btn"
                        :class="{ danger: m.actions[0].action === 'delete' }"
                        :disabled="m.actions[0].applied"
                        @click="handleApplySingle(m, m.actions[0])"
                      >
                        <span>
                          {{
                            m.actions[0].applied
                              ? '已执行 ✓'
                              : m.actions[0].action === 'delete'
                                ? '确认删除'
                                : m.actions[0].action === 'snooze'
                                  ? '确认顺延'
                                  : m.actions[0].action === 'update'
                                    ? '确认更新'
                                    : '一键添加到日程'
                          }}
                        </span>
                      </button>
                    </div>
                  </div>

                  <!-- Multi-item Selectable Batch Blueprint -->
                  <div v-else class="batch-blueprint-card">
                    <div class="batch-head">
                      <div class="batch-title-row">
                        <span class="intent-badge create">BATCH · {{ m.actions.length }}</span>
                        <span class="batch-summary-text">
                          已选 {{ selectedPendingActions(m.id, m.actions).length }} / 待添加 {{ pendingActions(m.actions).length }} 项
                        </span>
                      </div>
                      <button
                        type="button"
                        class="primary-btn apply-all-btn"
                        :disabled="selectedPendingActions(m.id, m.actions).length === 0"
                        @click="handleApplySelected(m, m.actions)"
                      >
                        {{
                          pendingActions(m.actions).length === 0
                            ? '全部已添加 ✓'
                            : `添加已选 ${selectedPendingActions(m.id, m.actions).length} 项`
                        }}
                      </button>
                    </div>

                    <div class="batch-items-list">
                      <div
                        v-for="(item, bIdx) in m.actions"
                        :key="bIdx"
                        class="batch-item-row"
                        :class="{ applied: item.applied, deselected: !item.applied && !isBatchItemSelected(m.id, bIdx, item) }"
                      >
                        <button
                          type="button"
                          class="batch-check"
                          :class="{ checked: item.applied || isBatchItemSelected(m.id, bIdx, item) }"
                          :disabled="item.applied"
                          :aria-label="item.applied ? '已添加' : `选择 ${item.title}`"
                          @click="toggleBatchItemSelection(m.id, bIdx)"
                        >
                          <svg v-if="item.applied || isBatchItemSelected(m.id, bIdx, item)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="10" height="10">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>

                        <div class="batch-item-info">
                          <div class="batch-item-top">
                            <span v-if="item.priority" class="pri-tag" :class="(item.priority || 'p2').toLowerCase()">
                              {{ (item.priority || 'p2').toUpperCase() }}
                            </span>
                            <span class="batch-item-title">{{ item.title }}</span>
                          </div>
                          <div class="batch-item-chips">
                            <span v-if="item.scheduled_at" class="chip chip-countdown tabular-nums">
                              {{ formatDateLabel(item.scheduled_at).label }} {{ formatTime(item.scheduled_at) }}
                            </span>
                            <span v-if="item.repeat_rule" class="chip chip-repeat">
                              {{ formatRepeatLabel(item.repeat_rule) }}
                            </span>
                            <span v-if="item.duration_minutes" class="dur-tag tabular-nums">{{ item.duration_minutes }}m</span>
                            <span v-if="item.notes" class="chip chip-notes">{{ item.notes }}</span>
                          </div>
                        </div>

                        <div class="batch-row-actions">
                          <button
                            v-if="!item.applied"
                            type="button"
                            class="sub-edit-btn"
                            title="打开编辑器细调此日程"
                            @click="$emit('edit-action', item)"
                          >微调</button>
                          <button
                            type="button"
                            class="sub-apply-btn"
                            :disabled="item.applied"
                            @click="handleApplySingle(m, item)"
                          >
                            {{ item.applied ? '已添加 ✓' : '+ 添加' }}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Assistant Toolbar -->
                <div class="entry-toolbar assistant-toolbar">
                  <button type="button" class="tool-btn" @click="copyMessage(m)">
                    {{ copiedId === m.id ? '已复制 ✓' : '复制' }}
                  </button>
                  <button
                    type="button"
                    class="tool-btn"
                    :disabled="isThinking"
                    title="基于上文重新生成本条回复"
                    @click="regenerateAssistantMessage(m.id)"
                  >
                    ↻ 重试
                  </button>
                  <button
                    v-if="!m.actions || m.actions.length === 0"
                    type="button"
                    class="tool-btn accent"
                    :disabled="extractingMsgId === m.id"
                    title="将此条 AI 回复提取为可勾选添加的日程卡片"
                    @click="handleExtractFromMessage(m)"
                  >
                    {{ extractingMsgId === m.id ? '解析中...' : '提取为日程' }}
                  </button>
                </div>
              </div>
            </template>
          </article>

          <!-- Contextual Follow-up Suggestions -->
          <div v-if="followUpSuggestions.length" class="followup-row" aria-label="快捷追问">
            <button
              v-for="suggestion in followUpSuggestions"
              :key="suggestion"
              type="button"
              class="followup-chip"
              @click="sendMessage(suggestion)"
            >
              <span>{{ suggestion }}</span>
              <i aria-hidden="true">→</i>
            </button>
          </div>
        </template>

        <!-- Thinking Indicator (Scrolltide Skein Optical Strand) -->
        <div v-if="isThinking" class="assistant-block thinking-block">
          <div class="assistant-role-row">
            <span class="role-dot pulsing" aria-hidden="true"></span>
            <span class="role-name">COPILOT</span>
            <span class="role-model">{{ modelLabel }}</span>
          </div>
          <div class="thinking-bubble">
            <svg class="skein-thinking-svg" viewBox="0 0 88 18" aria-hidden="true">
              <path class="skein-strand s1" d="M2 9 C 22 1, 44 17, 86 9" />
              <path class="skein-strand s2" d="M2 9 C 24 16, 46 2, 86 9" />
              <path class="skein-strand s3" d="M2 9 C 28 5, 56 13, 86 9" />
            </svg>
            <span class="thinking-text">正在结合实时日程上下文推理...</span>
          </div>
        </div>
      </div>

      <!-- Command-Grade Composer Footer with Floating Slash Menu -->
      <footer class="drawer-footer">
        <div v-if="slashMenuOpen" class="slash-menu" role="listbox" aria-label="Slash 快捷指令">
          <div class="slash-menu-head">
            <span>SLASH COMMANDS</span>
            <small>↑↓ 选择 · Enter 执行 · Esc 收起</small>
          </div>
          <button
            v-for="(item, sIdx) in filteredSlashCommands"
            :key="item.cmd"
            type="button"
            role="option"
            class="slash-item"
            :class="{ active: sIdx === slashActiveIndex }"
            :aria-selected="sIdx === slashActiveIndex"
            @mouseenter="slashActiveIndex = sIdx"
            @click="item.run()"
          >
            <code class="slash-cmd">{{ item.cmd }}</code>
            <div class="slash-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.desc }}</small>
            </div>
          </button>
        </div>

        <!-- Quick AI Prompt Suggestion Chips (R57) -->
        <div class="quick-prompt-chips" role="toolbar" aria-label="快捷提示词模板">
          <button type="button" class="prompt-chip" title="目标拆解为里程碑" @click="applyPromptTemplate('拆解 5 步里程碑')">
            <span class="chip-icon">🎯</span><span>5步里程碑</span>
          </button>
          <button type="button" class="prompt-chip" title="时间箱排期规划" @click="applyPromptTemplate('今日时间箱 Timebox')">
            <span class="chip-icon">⏱️</span><span>今日时间箱</span>
          </button>
          <button type="button" class="prompt-chip" title="诊断日程时间重叠" @click="applyPromptTemplate('排查今日重叠冲突')">
            <span class="chip-icon">⚡</span><span>排查冲突</span>
          </button>
          <button type="button" class="prompt-chip" title="优化行动动词" @click="applyPromptTemplate('提炼行动动词与核心产出')">
            <span class="chip-icon">💡</span><span>强动词提炼</span>
          </button>
        </div>

        <div class="composer-box">
          <textarea
            ref="textareaRef"
            v-model="inputPrompt"
            class="chat-textarea select-text"
            rows="1"
            placeholder="输入日程需求或输入 / 调出快捷指令（支持粘贴长清单自动拆解）"
            aria-label="向日程智能副驾提问"
            @input="slashDismissed = false"
            @keydown="handleComposerKeydown"
          ></textarea>
          <div class="composer-bottom-bar">
            <div class="composer-left-tools">
              <button
                type="button"
                class="slash-trigger-btn"
                title="查看 Slash 快捷指令 (/)"
                @click="openSlashFromButton"
              >
                <code>/</code>
                <span>指令</span>
              </button>
              <span class="hint-text">Enter / ⌘↵ 发送 · ⇧↵ 换行</span>
            </div>
            <button
              type="button"
              class="primary-btn send-btn"
              :disabled="!inputPrompt.trim() || isThinking"
              title="发送"
              aria-label="发送"
              @click="sendMessage()"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.56);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 95;
  display: flex;
  justify-content: flex-end;
}

.drawer-panel {
  width: 520px;
  max-width: min(520px, 94vw);
  height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--surface-raised);
  border-left: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  animation: slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  transition: width var(--motion-normal), max-width var(--motion-normal);
}

.drawer-panel.is-expanded {
  width: min(740px, 94vw);
  max-width: 94vw;
}

@keyframes slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.drawer-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--border-subtle);
  background: radial-gradient(70% 100% at 0% 0%, color-mix(in srgb, var(--tide) 8%, transparent), transparent 65%), var(--surface-raised);
}

.ai-title-wrap {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 11px;
}

.ai-sparkle-icon {
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 10px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tide) 20%, transparent), color-mix(in srgb, var(--lime) 14%, transparent));
  border: 1px solid var(--accent-border);
  color: var(--tide-text);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-sparkle-icon.thinking svg {
  animation: spin 3s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.header-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.copilot-eyebrow {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--tide-text);
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.1em;
}

.drawer-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.model-status-pill {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 1px 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font: 600 10px var(--font-mono);
  cursor: pointer;
  transition: color var(--motion-fast);
}

.model-status-pill:hover {
  color: var(--text-primary);
}

.status-led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-quaternary);
}

.model-status-pill.ready .status-led {
  background: var(--success);
  box-shadow: 0 0 8px color-mix(in srgb, var(--success) 75%, transparent);
}

.model-status-pill.warn {
  color: var(--warning);
}

.model-status-pill.warn .status-led {
  background: var(--warning);
  box-shadow: 0 0 8px color-mix(in srgb, var(--warning) 75%, transparent);
}

.header-right-btns {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.icon-text-btn {
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all var(--motion-fast);
}

.icon-text-btn:hover:not(:disabled) {
  background: var(--fill-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.icon-text-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.width-toggle-btn[aria-pressed="true"] {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}

/* Live Telemetry Context Strip */
.telemetry-strip {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 18px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface);
}

.telemetry-metrics {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tele-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  font: 600 9.5px var(--font-mono);
}

.tele-chip small {
  color: var(--text-quaternary);
  letter-spacing: 0.08em;
}

.tele-chip strong {
  color: var(--text-primary);
  font-size: 10.5px;
}

button.tele-chip.alert {
  border-color: color-mix(in srgb, var(--danger) 36%, transparent);
  background: color-mix(in srgb, var(--danger) 11%, transparent);
  cursor: pointer;
  transition: all var(--motion-fast);
}

button.tele-chip.alert small,
button.tele-chip.alert strong {
  color: var(--danger);
}

button.tele-chip.alert:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 18%, transparent);
}

.tele-hint {
  color: var(--text-quaternary);
  font-size: 10.5px;
  white-space: nowrap;
}

.tele-hint code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--fill-hover);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font: 700 10px var(--font-mono);
}

/* Main Body */
.chat-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--surface);
}

/* Launchpad Workbench */
.launchpad-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 4px;
}

.api-warning-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
  background: color-mix(in srgb, var(--warning) 9%, var(--surface-raised));
}

.api-warning-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.api-warning-copy strong {
  font-size: 12px;
  color: var(--warning);
}

.api-warning-copy span {
  font-size: 11px;
  color: var(--text-secondary);
}

.banner-action-btn {
  flex: none;
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  color: var(--warning);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.banner-action-btn:hover {
  background: var(--warning);
  color: var(--ink-on-accent);
}

.launchpad-hero {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 2px;
}

.hero-kicker {
  font: 700 9px var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--tide-text);
}

.launchpad-hero h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 750;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.launchpad-hero p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-tertiary);
}

.launchpad-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.launch-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 7px;
  padding: 13px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  text-align: left;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.launch-card:hover:not(:disabled) {
  border-color: var(--accent-border);
  background: color-mix(in srgb, var(--surface-raised) 92%, var(--tide));
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.launch-card:disabled {
  opacity: 0.5;
  cursor: wait;
}

.launch-card-top {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.launch-card-top code {
  font: 600 9.5px var(--font-mono);
  color: var(--text-quaternary);
}

.launch-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-subtle);
}

.launch-icon.tide {
  color: var(--tide-text);
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.launch-icon.warn {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  border-color: color-mix(in srgb, var(--warning) 30%, transparent);
}

.launch-icon.lime {
  color: var(--lime-strong);
  background: color-mix(in srgb, var(--lime) 14%, transparent);
  border-color: color-mix(in srgb, var(--lime) 30%, transparent);
}

.launch-icon.success {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
}

.launch-card strong {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-primary);
}

.launch-card small {
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-tertiary);
}

/* Editorial Stream */
.stream-entry {
  display: flex;
  flex-direction: column;
}

.user-card-wrap {
  align-self: flex-end;
  max-width: 86%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}

.user-pill {
  padding: 9px 13px;
  border-radius: 13px 13px 4px 13px;
  background: var(--cta-bg);
  color: var(--cta-ink);
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: var(--shadow-xs);
}

.assistant-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 12px;
  border-left: 2px solid color-mix(in srgb, var(--tide) 45%, transparent);
}

.assistant-role-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.role-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tide);
}

.role-dot.pulsing {
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

.role-name {
  font: 700 9.5px var(--font-mono);
  letter-spacing: 0.1em;
  color: var(--tide-text);
}

.role-model {
  font: 500 9.5px var(--font-mono);
  color: var(--text-quaternary);
}

.entry-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.user-toolbar {
  opacity: 0;
  transition: opacity var(--motion-fast);
}

.user-card-wrap:hover .user-toolbar,
.user-card-wrap:focus-within .user-toolbar {
  opacity: 1;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 23px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.tool-btn:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--fill-hover);
  color: var(--text-primary);
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.tool-btn.accent {
  color: var(--tide-text);
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.tool-btn.accent:hover:not(:disabled) {
  background: var(--tide);
  color: var(--ink-on-accent);
  border-color: var(--tide);
}

/* Select-text utility */
.select-text {
  user-select: text !important;
  -webkit-user-select: text !important;
  cursor: text;
}

/* Markdown Typography */
.markdown-body {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.65;
  word-break: break-word;
}

.markdown-body :deep(p) { margin: 0 0 8px 0; }
.markdown-body :deep(p:last-child) { margin-bottom: 0; }
.markdown-body :deep(strong), .markdown-body :deep(b) { font-weight: 700; color: var(--text-primary); }
.markdown-body :deep(em), .markdown-body :deep(i) { font-style: italic; color: var(--text-secondary); }
.markdown-body :deep(h1), .markdown-body :deep(h2), .markdown-body :deep(h3), .markdown-body :deep(h4) {
  font-weight: 700;
  color: var(--text-primary);
  margin: 10px 0 6px 0;
  line-height: 1.35;
}
.markdown-body :deep(h1) { font-size: 14.5px; }
.markdown-body :deep(h2) { font-size: 13.5px; }
.markdown-body :deep(h3) { font-size: 12.5px; }
.markdown-body :deep(ul), .markdown-body :deep(ol) { margin: 5px 0 8px 0; padding-left: 18px; }
.markdown-body :deep(li) { margin: 3px 0; line-height: 1.5; }
.markdown-body :deep(code) {
  padding: 1.5px 5px;
  border-radius: 4px;
  background: var(--input-bg);
  border: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--accent-text);
}
.markdown-body :deep(pre) {
  background: var(--input-bg);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.markdown-body :deep(pre code) { background: transparent; border: 0; padding: 0; font-size: 11.5px; color: var(--text-primary); }
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--tide);
  padding: 4px 0 4px 10px;
  margin: 6px 0 8px 0;
  color: var(--text-secondary);
  background: var(--accent-soft);
  border-radius: 0 4px 4px 0;
}
.markdown-body :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 11.5px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}
.markdown-body :deep(th), .markdown-body :deep(td) {
  padding: 5px 9px;
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
}
.markdown-body :deep(td code), .markdown-body :deep(th code) { white-space: nowrap; }
.markdown-body :deep(th:last-child), .markdown-body :deep(td:last-child) { border-right: none; }
.markdown-body :deep(tr:last-child td) { border-bottom: none; }
.markdown-body :deep(th) { background: var(--fill-subtle); color: var(--text-primary); font-weight: 650; white-space: nowrap; }
.markdown-body :deep(tbody tr:nth-child(even)) { background: color-mix(in srgb, var(--fill-subtle) 60%, transparent); }
.markdown-body :deep(hr) { border: 0; border-top: 1px solid var(--border-subtle); margin: 10px 0; }
.markdown-body :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 2px; }

/* Thinking */
.thinking-bubble {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 9px 13px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--tide) 8%, var(--surface-raised));
  border: 1px solid var(--accent-border);
  width: fit-content;
}

.skein-thinking-svg { width: 66px; height: 16px; flex: none; overflow: visible; }
.skein-strand { fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-dasharray: 28 16; animation: skein-pulse 1.5s linear infinite; }
.skein-strand.s1 { stroke: var(--tide); opacity: 0.95; }
.skein-strand.s2 { stroke: var(--lime); opacity: 0.85; animation-delay: -0.45s; }
.skein-strand.s3 { stroke: var(--tide-text); opacity: 0.55; animation-delay: -0.9s; }
@keyframes skein-pulse { from { stroke-dashoffset: 44; } to { stroke-dashoffset: 0; } }
.thinking-text { font: 600 10.5px var(--font-mono); color: var(--tide-text); }

/* Blueprint Action Cards */
.action-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.blueprint-card,
.batch-blueprint-card {
  padding: 12px 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-border);
  background:
    radial-gradient(85% 65% at 100% 0%, color-mix(in srgb, var(--tide) 8%, transparent), transparent 65%),
    var(--surface-raised);
  box-shadow: var(--shadow-xs);
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.blueprint-card.danger {
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  background: color-mix(in srgb, var(--danger) 7%, var(--surface-raised));
}

.blueprint-card.applied {
  opacity: 0.72;
  border-color: color-mix(in srgb, var(--success) 35%, transparent);
}

.blueprint-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.intent-badge {
  padding: 2px 7px;
  border-radius: 999px;
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.08em;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--tide-text);
}

.intent-badge.danger {
  background: color-mix(in srgb, var(--danger) 15%, transparent);
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  color: var(--danger);
}

.intent-badge.snooze {
  background: color-mix(in srgb, var(--warning) 15%, transparent);
  border-color: color-mix(in srgb, var(--warning) 35%, transparent);
  color: var(--warning);
}

.intent-desc {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.pri-tag {
  padding: 1px 6px;
  border-radius: 999px;
  font: 700 9px var(--font-mono);
  background: var(--fill-hover);
  color: var(--text-secondary);
}

.pri-tag.p0 { background: color-mix(in srgb, var(--danger) 18%, transparent); color: var(--danger); }
.pri-tag.p1 { background: color-mix(in srgb, var(--lime) 20%, transparent); color: var(--lime-strong); }
.pri-tag.p2 { background: var(--accent-soft); color: var(--tide-text); }

.dur-tag {
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  font: 600 9px var(--font-mono);
}

.blueprint-title {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-primary);
}

.snooze-offset {
  margin-left: 6px;
  font: 600 11px var(--font-mono);
  color: var(--warning);
}

.blueprint-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.meta-tag-pill {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--tag-bg);
  color: var(--tag-text);
  border: 1px solid var(--tag-border);
  font: 600 9.5px var(--font-mono);
}

.blueprint-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

.secondary-action-btn {
  height: 29px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.secondary-action-btn:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

.apply-btn {
  min-height: 29px;
  height: 29px;
  font-size: 11.5px;
  padding: 0 13px;
}

.apply-btn.danger {
  background: var(--danger);
  color: #fff;
}

/* Batch Card */
.batch-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.batch-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.batch-summary-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.apply-all-btn {
  min-height: 28px;
  height: 28px;
  font-size: 11px;
  padding: 0 12px;
}

.batch-items-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.batch-item-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  transition: all var(--motion-fast);
}

.batch-item-row.deselected {
  opacity: 0.5;
}

.batch-item-row.applied {
  opacity: 0.68;
  background: color-mix(in srgb, var(--success) 9%, transparent);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
}

.batch-check {
  width: 17px;
  height: 17px;
  flex: none;
  border-radius: 5px;
  border: 1.5px solid var(--border-strong);
  background: transparent;
  color: var(--ink-on-accent);
  display: grid;
  place-items: center;
  padding: 0;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.batch-check.checked {
  background: var(--tide);
  border-color: var(--tide);
}

.batch-check:disabled {
  cursor: default;
  background: var(--success);
  border-color: var(--success);
}

.batch-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.batch-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.batch-item-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-item-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.batch-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.sub-edit-btn,
.sub-apply-btn {
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--motion-fast);
}

.sub-edit-btn:hover {
  border-color: var(--border-strong);
  background: var(--fill-hover);
  color: var(--text-primary);
}

.sub-apply-btn {
  border-color: var(--border-strong);
  background: var(--fill-hover);
  color: var(--text-primary);
}

.sub-apply-btn:hover:not(:disabled) {
  background: var(--cta-bg);
  border-color: transparent;
  color: var(--cta-ink);
}

.sub-apply-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

/* Contextual Follow-ups */
.followup-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 12px;
}

.followup-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.followup-chip:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  transform: translateY(-1px);
}

.followup-chip i {
  font-style: normal;
  opacity: 0.65;
}

/* Composer + Slash Menu Footer */
.drawer-footer {
  position: relative;
  flex: none;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-raised);
}

.slash-menu {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(100% + 6px);
  z-index: 20;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--surface-overlay);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.slash-menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--text-quaternary);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 3px;
}

.slash-menu-head small {
  font: 500 9.5px var(--font-family);
  letter-spacing: 0;
}

.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background var(--motion-fast);
}

.slash-item.active,
.slash-item:hover {
  background: var(--accent-soft);
}

.slash-cmd {
  min-width: 78px;
  font: 700 10.5px var(--font-mono);
  color: var(--tide-text);
}

.slash-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.slash-copy strong {
  font-size: 11.5px;
  color: var(--text-primary);
}

.slash-copy small {
  font-size: 10px;
  color: var(--text-tertiary);
}

.quick-prompt-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 2px 4px;
  scrollbar-width: none;
}
.quick-prompt-chips::-webkit-scrollbar {
  display: none;
}
.prompt-chip {
  display: inline-flex;
  align-items: center;
  gap: 4.5px;
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 550;
  white-space: nowrap;
  cursor: pointer;
  transition: all var(--motion-fast);
}
.prompt-chip:hover {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: var(--accent-border);
  transform: translateY(-0.5px);
}
.prompt-chip .chip-icon {
  font-size: 11.5px;
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 11px 8px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: var(--input-bg);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
}

.composer-box:focus-within {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.chat-textarea {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  resize: none;
  outline: none;
  max-height: 136px;
}

.composer-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.composer-left-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.slash-trigger-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.slash-trigger-btn:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
}

.slash-trigger-btn code {
  font: 700 10.5px var(--font-mono);
}

.hint-text {
  font-size: 10px;
  color: var(--text-quaternary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.send-btn {
  min-height: 28px;
  width: 32px;
  height: 28px;
  padding: 0;
  border-radius: 999px;
  flex: none;
}

.send-btn:disabled {
  opacity: 0.36;
  cursor: default;
  transform: none;
  box-shadow: none;
}

@media (max-width: 600px) {
  .launchpad-grid {
    grid-template-columns: 1fr;
  }
  .width-toggle-btn {
    display: none;
  }
}
</style>
