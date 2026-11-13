<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

withDefaults(defineProps<{ count: number; busy?: boolean }>(), { busy: false });
const emit = defineEmits<{
  (e: 'batch-pause'): void;
  (e: 'batch-resume'): void;
  (e: 'batch-complete'): void;
  (e: 'batch-postpone-hour'): void;
  (e: 'batch-postpone-day'): void;
  (e: 'batch-priority', priority: string): void;
  (e: 'batch-pin', pinned: boolean): void;
  (e: 'batch-tag', tag: string): void;
  (e: 'batch-export'): void;
  (e: 'batch-delete'): void;
  (e: 'clear-selection'): void;
}>();

const openMenu = ref<'priority' | 'more' | 'tag' | null>(null);
const tagInput = ref('');

function setPriority(priority: string) {
  emit('batch-priority', priority);
  openMenu.value = null;
}
function submitTag() {
  const value = tagInput.value.trim();
  if (!value) return;
  emit('batch-tag', value);
  tagInput.value = '';
  openMenu.value = null;
}
function trigger(event: 'batch-pause' | 'batch-resume' | 'batch-pin' | 'batch-export' | 'batch-delete', value?: boolean) {
  if (event === 'batch-pin') emit('batch-pin', value ?? true);
  else if (event === 'batch-pause') emit('batch-pause');
  else if (event === 'batch-resume') emit('batch-resume');
  else if (event === 'batch-export') emit('batch-export');
  else emit('batch-delete');
  openMenu.value = null;
}
function closeOutside(event: MouseEvent) {
  if (!(event.target as HTMLElement | null)?.closest('.batch-dock')) openMenu.value = null;
}
function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && openMenu.value) {
    event.preventDefault();
    event.stopPropagation();
    openMenu.value = null;
  }
}
onMounted(() => {
  window.addEventListener('mousedown', closeOutside);
  window.addEventListener('keydown', handleEscape, true);
});
onUnmounted(() => {
  window.removeEventListener('mousedown', closeOutside);
  window.removeEventListener('keydown', handleEscape, true);
});
</script>

<template>
  <Transition name="batch-rise">
    <div v-if="count > 0" class="batch-bar-wrap">
      <div class="batch-dock" :class="{ busy }" role="toolbar" aria-label="批量操作" :aria-busy="busy">
        <div class="batch-summary"><strong>{{ count }}</strong><span>{{ busy ? '处理中…' : '项已选' }}</span></div>
        <span class="batch-separator"></span>
        <button class="batch-primary" type="button" @click="$emit('batch-complete')">完成</button>
        <button type="button" title="顺延1小时" @click="$emit('batch-postpone-hour')">推迟 1h</button>
        <button type="button" @click="$emit('batch-postpone-day')">顺延一天</button>

        <div class="batch-popover-wrap">
          <button type="button" :aria-expanded="openMenu === 'priority'" @click="openMenu = openMenu === 'priority' ? null : 'priority'">优先级 <span>⌄</span></button>
          <div v-if="openMenu === 'priority'" class="batch-menu priority-menu">
            <button v-for="priority in ['p0','p1','p2','p3']" :key="priority" type="button" @click="setPriority(priority)"><span :class="['priority-dot', priority]"></span>{{ priority.toUpperCase() }} {{ priority === 'p0' ? '紧急重要' : priority === 'p1' ? '重要规划' : priority === 'p2' ? '常规安排' : '低优先级' }}</button>
          </div>
        </div>

        <div class="batch-popover-wrap">
          <button type="button" :aria-expanded="openMenu === 'more'" @click="openMenu = openMenu === 'more' ? null : 'more'">更多 <span>⌄</span></button>
          <div v-if="openMenu === 'more'" class="batch-menu more-menu">
            <button type="button" @click="trigger('batch-pin', true)">置顶</button>
            <button type="button" @click="openMenu = 'tag'">添加标签</button>
            <button type="button" @click="trigger('batch-export')">导出 Markdown</button>
            <div class="menu-separator"></div>
            <button type="button" @click="trigger('batch-pause')">暂停提醒</button>
            <button type="button" @click="trigger('batch-resume')">恢复提醒</button>
            <button class="danger" type="button" @click="trigger('batch-delete')">移入废纸篓</button>
          </div>
          <form v-if="openMenu === 'tag'" class="batch-menu tag-menu" @submit.prevent="submitTag">
            <label for="batch-tag-input">添加标签</label>
            <input id="batch-tag-input" v-model="tagInput" autofocus placeholder="标签名称" @keydown.esc="openMenu = null" />
            <div><button type="button" @click="openMenu = null">取消</button><button class="confirm" type="submit" :disabled="!tagInput.trim()">添加</button></div>
          </form>
        </div>

        <span class="batch-separator"></span>
        <button class="clear-selection" type="button" title="取消选择 (Esc)" aria-label="取消选择" @click="$emit('clear-selection')">×</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.batch-bar-wrap { position:fixed; left:calc(50% + 110px); bottom:20px; z-index:var(--z-float); transform:translateX(-50%); max-width:calc(100vw - 24px); }
.batch-dock { display:flex; align-items:center; gap:5px; padding:6px 8px 6px 14px; border:1px solid var(--border-strong); border-radius:999px; background:var(--surface-overlay); box-shadow:var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,0.08); backdrop-filter:blur(22px) saturate(145%); -webkit-backdrop-filter:blur(22px) saturate(145%); }
.batch-dock.busy { pointer-events:none; opacity:.72; }
.batch-summary { display:flex; align-items:center; gap:5px; margin-right:3px; white-space:nowrap; }
.batch-summary strong { color:var(--tide-text); font:750 11.5px var(--font-mono); }.batch-summary span { color:var(--text-tertiary); font-size:10px; }
.batch-separator { width:1px; height:18px; margin:0 3px; background:var(--border-subtle); }
.batch-dock button { height:29px; padding:0 10px; border:1px solid transparent; border-radius:999px; background:transparent; color:var(--text-secondary); font-size:10.5px; cursor:pointer; transition:background var(--motion-fast), border-color var(--motion-fast), color var(--motion-fast); }
.batch-dock > button:hover,.batch-popover-wrap > button:hover { border-color:var(--border-subtle); background:var(--fill-hover); color:var(--text-primary); }
.batch-dock .batch-primary { border-color:transparent; background:var(--cta-bg); color:var(--cta-ink); font-weight:700; }
.batch-dock .batch-primary:hover { background:var(--cta-bg-hover); color:var(--cta-ink); }
.batch-popover-wrap { position:relative; }
.batch-menu { position:absolute; right:0; bottom:39px; min-width:166px; display:grid; gap:2px; padding:6px; border:1px solid var(--border-strong); border-radius:12px; background:var(--surface-overlay); box-shadow:var(--shadow-lg); backdrop-filter:blur(20px); }
.batch-menu button { width:100%; border-radius:8px; text-align:left; }.batch-menu button:hover { background:var(--fill-hover); color:var(--text-primary); }
.priority-menu { left:0; right:auto; min-width:170px; }.priority-menu button { display:flex; align-items:center; gap:8px; }
.priority-dot { width:6px; height:6px; border-radius:50%; background:var(--text-quaternary); }.priority-dot.p0 { background:var(--danger); }.priority-dot.p1 { background:var(--lime-strong); }.priority-dot.p2 { background:var(--tide); }
.batch-menu .danger { color:var(--danger); }.menu-separator { height:1px; margin:4px; background:var(--border-subtle); }
.tag-menu { width:220px; gap:8px; padding:10px; }.tag-menu label { color:var(--text-secondary); font-size:10px; font-weight:650; }.tag-menu input { width:100%; height:32px; padding:0 8px; border:1px solid var(--border-subtle); border-radius:7px; outline:0; background:var(--input-bg); color:var(--text-primary); font-size:11px; }.tag-menu input:focus { border-color:var(--accent-border); }.tag-menu div { display:flex; justify-content:flex-end; gap:4px; }.tag-menu .confirm { width:auto; background:var(--cta-bg); color:var(--cta-ink); font-weight:700; }.tag-menu .confirm:disabled { opacity:.4; }
.clear-selection { width:29px; padding:0!important; color:var(--text-tertiary)!important; font-size:16px!important; }
.batch-rise-enter-active,.batch-rise-leave-active { transition:opacity var(--motion-normal),transform var(--motion-normal); }.batch-rise-enter-from,.batch-rise-leave-to { opacity:0; transform:translateY(8px); }
@media(max-width:1120px){.batch-bar-wrap{left:54%;}}
@media(max-width:840px){.batch-bar-wrap{left:50%;}.batch-dock{flex-wrap:wrap;justify-content:center;border-radius:18px;padding:8px 10px;}}
</style>
