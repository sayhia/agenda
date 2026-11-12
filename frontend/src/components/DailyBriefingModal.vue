<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { Reminder } from '../../bindings/agenda-desktop/models';
import { formatTime } from '../utils/format';

const props = defineProps<{
  visible: boolean;
  reminders: Reminder[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
}>();

const now = ref(new Date());
let dayTimer: ReturnType<typeof setInterval>;
let copyTimer: ReturnType<typeof setTimeout>;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

const currentDayKey = computed(() => dateKey(now.value));
const todayStr = computed(() => {
  const d = now.value;
  const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${dayNames[d.getDay()]}`;
});

const todayReminders = computed(() => {
  const key = currentDayKey.value;
  return props.reminders.filter((reminder) =>
    reminder.status !== 'ended' && dateKey(new Date(reminder.scheduled_at)) === key
  ).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
});

const p0Count = computed(() => todayReminders.value.filter((r) => r.priority === 'p0').length);
const p1Count = computed(() => todayReminders.value.filter((r) => r.priority === 'p1').length);

const isCopied = ref(false);

async function copyBriefing() {
  let text = `📅 【日程管家 · 今日早报】\n${todayStr.value}\n\n`;
  text += `⚡️ 今日待办：共 ${todayReminders.value.length} 项 (高优事项: ${p0Count.value + p1Count.value})\n`;
  text += `─────────────────────\n`;

  if (todayReminders.value.length === 0) {
    text += `今日暂无紧急待办，尽情享受轻松时光！\n`;
  } else {
    for (const r of todayReminders.value) {
      const time = formatTime(r.scheduled_at);
      const pri = r.priority ? `[${r.priority.toUpperCase()}] ` : '';
      text += `⏰ ${time} · ${pri}${r.title}\n`;
      if (r.notes) {
        text += `   ↳ 备注: ${r.notes}\n`;
      }
    }
  }
  text += `\n✨ 今日寄语：保持专注，步履不停！`;

  try {
    await navigator.clipboard.writeText(text);
    isCopied.value = true;
    emit('toast', '已复制今日早报至剪贴板，随时可粘贴至微信/飞书！', 'success');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      isCopied.value = false;
    }, 2000);
  } catch {
    emit('toast', '复制失败，请重试', 'error');
  }
}

function handlePrint() {
  document.documentElement.setAttribute('data-print', 'briefing');
  window.addEventListener('afterprint', () => document.documentElement.removeAttribute('data-print'), { once: true });
  window.print();
}

onMounted(() => {
  dayTimer = setInterval(() => { now.value = new Date(); }, 60_000);
});

onUnmounted(() => {
  clearInterval(dayTimer);
  clearTimeout(copyTimer);
  document.documentElement.removeAttribute('data-print');
});
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="briefing-card glass-panel st-reticle" role="dialog" aria-modal="true" aria-label="每日简报">
      <!-- Receipt Printer Metallic Slot Header -->
      <div class="printer-slot-bar">
        <div class="slot-leds" aria-hidden="true">
          <span class="led live"></span>
          <span class="led"></span>
          <span class="led"></span>
        </div>
        <span class="slot-label">RECEIPT PRINTER · DISPATCH SLOT</span>
        <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
      </div>

      <!-- Perforated Thermal Sheet -->
      <div class="receipt-sheet">
        <div class="receipt-serration top" aria-hidden="true"></div>

        <!-- Hero Header -->
        <div class="hero-block">
          <div class="hero-meta-row">
            <span class="date-badge">{{ todayStr }}</span>
            <span class="receipt-serial">NO.{{ String(todayReminders.length).padStart(2, '0') }}-DISPATCH</span>
          </div>
          <h2 class="hero-title">今日日程规划早报</h2>
          <div class="ledger-strip tabular-nums">
            <span><strong>{{ todayReminders.length }}</strong><small>PENDING</small></span>
            <span><strong class="crit">{{ p0Count }}</strong><small>P0 CRIT</small></span>
            <span><strong class="high">{{ p1Count }}</strong><small>P1 HIGH</small></span>
          </div>
        </div>

        <!-- Task Timeline Ledger -->
        <div class="timeline-container">
          <div v-if="todayReminders.length === 0" class="empty-state">
            <span class="empty-icon">—</span>
            <p>今日暂无排期任务，保持专注节律</p>
          </div>

          <div
            v-for="r in todayReminders"
            :key="r.id"
            class="briefing-item"
            :class="[`pri-${r.priority || 'p2'}`]"
          >
            <div class="time-col tabular-nums">
              <span class="time-val">{{ formatTime(r.scheduled_at) }}</span>
              <span class="dur-val">{{ r.duration_minutes || 30 }}M</span>
            </div>

            <div class="content-col">
              <div class="title-row">
                <span class="task-title">{{ r.title }}</span>
                <span v-if="r.priority === 'p0'" class="p0-badge">P0 紧急</span>
                <span v-else-if="r.priority === 'p1'" class="p1-badge">P1 重要</span>
              </div>
              <p v-if="r.notes" class="task-notes">{{ r.notes }}</p>
            </div>
          </div>
        </div>

        <div class="receipt-tearline" aria-hidden="true">
          <span>- - - - - - - - - - - - - END OF DISPATCH - - - - - - - - - - - - -</span>
        </div>
        <div class="receipt-serration bottom" aria-hidden="true"></div>
      </div>

      <!-- Footer Actions -->
      <div class="card-foot">
        <button class="action-btn print-btn" @click="handlePrint">
          打印 / 保存 PDF
        </button>
        <button class="action-btn copy-btn" @click="copyBriefing">
          {{ isCopied ? '已复制 ✓' : '复制早报清单' }}
        </button>
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

.briefing-card {
  position: relative;
  width: 560px;
  max-width: 92vw;
  max-height: 88vh;
  border-radius: 18px;
  padding: 18px 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(75% 45% at 50% 0%, color-mix(in srgb, var(--tide) 10%, transparent), transparent 68%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
}

.printer-slot-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
}

.slot-leds {
  display: flex;
  align-items: center;
  gap: 5px;
}

.slot-leds .led {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border-strong);
}

.slot-leds .led.live {
  background: var(--lime);
  box-shadow: 0 0 8px var(--lime);
}

.slot-label {
  font: 700 9px var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--text-tertiary);
}

.receipt-sheet {
  position: relative;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  padding: 16px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: var(--shadow-xs);
  animation: receipt-feed 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes receipt-feed {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.receipt-serration {
  position: absolute;
  left: 10px;
  right: 10px;
  height: 4px;
  background-image: radial-gradient(circle at 4px 2px, var(--border-subtle) 1.25px, transparent 1.35px);
  background-size: 10px 4px;
  pointer-events: none;
}

.receipt-serration.top { top: 4px; }
.receipt-serration.bottom { bottom: 4px; }

.hero-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--border-strong);
}

.hero-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.date-badge {
  font: 700 10.5px var(--font-mono);
  color: var(--tide-text);
}

.receipt-serial {
  font: 700 9.5px var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--text-quaternary);
}

.hero-title {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.025em;
}

.ledger-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
}

.ledger-strip > span {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ledger-strip strong {
  font: 750 15px var(--font-mono);
  color: var(--text-primary);
}

.ledger-strip strong.crit { color: var(--danger); }
.ledger-strip strong.high { color: var(--lime-strong); }

.ledger-strip small {
  font: 650 8.5px var(--font-mono);
  letter-spacing: 0.1em;
  color: var(--text-quaternary);
}

.timeline-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  overflow-y: auto;
  padding-right: 4px;
}

.briefing-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  border-left: 2.5px solid var(--tide);
}

.briefing-item.pri-p0 {
  border-left-color: var(--danger);
  background: color-mix(in srgb, var(--danger) 6%, var(--fill-subtle));
}

.briefing-item.pri-p1 {
  border-left-color: var(--lime-strong);
  background: color-mix(in srgb, var(--lime) 6%, var(--fill-subtle));
}

.time-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 54px;
}

.time-val {
  font: 700 13px var(--font-mono);
  color: var(--text-primary);
}

.dur-val {
  font: 600 9.5px var(--font-mono);
  color: var(--text-quaternary);
}

.content-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
}

.p0-badge {
  font: 700 9.5px var(--font-mono);
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 34%, transparent);
}

.p1-badge {
  font: 700 9.5px var(--font-mono);
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lime) 14%, transparent);
  color: var(--lime-strong);
  border: 1px solid color-mix(in srgb, var(--lime) 34%, transparent);
}

.task-notes {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.45;
}

.receipt-tearline {
  padding: 4px 0;
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
  font: 600 8.5px var(--font-mono);
  letter-spacing: 0.08em;
  color: var(--text-quaternary);
}

.empty-state {
  text-align: center;
  padding: 28px;
  color: var(--text-tertiary);
  font-size: 12.5px;
}

.empty-icon {
  font: 400 22px var(--font-mono);
  display: block;
  margin-bottom: 6px;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.action-btn {
  min-height: 34px;
  padding: 0 15px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition: all 0.16s ease;
}

.copy-btn {
  background: var(--cta-bg);
  color: var(--cta-ink);
  border: 1px solid transparent;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24);
}

.copy-btn:hover {
  background: var(--cta-bg-hover);
  transform: translateY(-1px);
}

.print-btn {
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.print-btn:hover {
  background: var(--fill-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}
</style>
