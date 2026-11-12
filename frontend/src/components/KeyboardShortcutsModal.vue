<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/.test(navigator.platform);
const cmdKey = isMac ? '⌘' : 'Ctrl';

const shortcuts = [
  {
    category: '全局呼出与搜索',
    items: [
      { key: `${cmdKey} + K`, desc: '打开全局指令面板与日程搜索' },
      { key: `${cmdKey} + J`, desc: '呼出 / 收起 AI 智能副驾驶抽屉' },
      { key: `${cmdKey} + B`, desc: '展开 / 折叠左侧导航侧边栏' },
      { key: `${cmdKey} + N`, desc: '打开新建日程弹窗' },
      { key: `${cmdKey} + ↵`, desc: '多行粘贴 / AI Skein 快速提交' },
      { key: `${cmdKey} + F` , desc: '定位至全局搜索输入框' },
      { key: '?', desc: '打开本快捷键速查中心' },
      { key: 'Esc', desc: '关闭浮层、弹窗或清空多选' },
    ],
  },
  {
    category: '多维视图切换',
    items: [
      { key: '1  ~  4', desc: '快速切换列表 / 周计划 / 月历 / 四象限' },
      { key: '[  /  ]  ·  t', desc: '周时间轴与月历前后翻页，T 返回今天' },
    ],
  },
  {
    category: '列表光标与高效处理 (Vim 风格)',
    items: [
      { key: 'j  /  ↓', desc: '光标下移：聚焦下一项日程' },
      { key: 'k  /  ↑', desc: '光标上移：聚焦上一项日程' },
      { key: 'x', desc: '多选切换：选中 / 反选当前聚焦项' },
      { key: 'Space', desc: '完成切换：完成或重新开启当前日程' },
      { key: 'e', desc: '快速编辑：打开当前日程修改面板' },
      { key: 'p', desc: '专注模式：为当前日程启动 25 分钟番茄钟' },
      { key: 'Delete', desc: '删除日程：删除当前项（放入废纸篓）' },
    ],
  },
];
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="shortcuts-card st-reticle" role="dialog" aria-modal="true" aria-label="键盘快捷键">
      <div class="card-head">
        <div class="head-left">
          <span class="head-eyebrow">GLOWCAP KEYMAP</span>
          <h3 class="head-title">按键快捷操作速查指南</h3>
        </div>
        <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
      </div>

      <div class="shortcuts-body">
        <div v-for="(cat, idx) in shortcuts" :key="cat.category" class="cat-section">
          <h4 class="cat-title">0{{ idx + 1 }} · {{ cat.category }}</h4>
          <div class="cat-grid">
            <div v-for="sc in cat.items" :key="sc.key" class="shortcut-row">
              <span class="sc-desc">{{ sc.desc }}</span>
              <kbd class="sc-kbd">{{ sc.key }}</kbd>
            </div>
          </div>
        </div>
      </div>

      <div class="card-foot">
        <span class="foot-tip">在任意非输入框焦点下直接敲击按键即可瞬时响应</span>
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
  z-index: 200;
}

.shortcuts-card {
  position: relative;
  width: 580px;
  max-width: 92vw;
  max-height: 85vh;
  border-radius: 18px;
  padding: 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background:
    radial-gradient(65% 45% at 85% 0%, color-mix(in srgb, var(--tide) 9%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
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
  flex-direction: column;
  gap: 3px;
}

.head-eyebrow {
  font: 700 8.5px var(--font-mono);
  letter-spacing: 0.14em;
  color: var(--tide-text);
}

.head-title {
  margin: 0;
  font-size: 16px;
  font-weight: 750;
  color: var(--text-primary);
}

.shortcuts-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cat-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.cat-title {
  margin: 0;
  font: 700 9.5px var(--font-mono);
  color: var(--text-quaternary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.cat-grid {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 11px;
  border-radius: 9px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--motion-fast), background var(--motion-fast);
}

.shortcut-row:hover {
  border-color: var(--accent-border);
  background: var(--fill-hover);
}

.sc-desc {
  font-size: 12px;
  color: var(--text-primary);
}

/* Scrolltide Glowcap tactile anodized keycap */
.sc-kbd {
  font: 700 10.5px var(--font-mono);
  padding: 3px 9px;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2.5px;
  color: var(--text-primary);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), var(--shadow-xs);
  transition: border-color var(--motion-fast), color var(--motion-fast);
}

.shortcut-row:hover .sc-kbd {
  border-color: var(--tide);
  color: var(--tide-text);
}

.card-foot {
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
  text-align: center;
}

.foot-tip {
  font: 600 10px var(--font-mono);
  color: var(--text-quaternary);
}
</style>
