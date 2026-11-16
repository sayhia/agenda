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
    category: '多维视图与主题',
    items: [
      { key: '1  ~  4', desc: '快速切换列表 / 周计划 / 月历 / 四象限' },
      { key: '[  /  ]  ·  t', desc: '周时间轴与月历前后翻页，t 返回今天' },
      { key: '⇧ + T', desc: '当前主题对应的浅色 / 深色雅配一键互换' },
      { key: '{  /  }', desc: '依次切换上一套 / 下一套美学主题' },
      { key: `${cmdKey} + K`, desc: '快速搜索切换 24 境主题、矿物点睛色与画布浓度' },
    ],
  },
  {
    category: '列表光标与高效处理 (Vim 风格)',
    items: [
      { key: 'j  /  ↓', desc: '光标下移：聚焦下一项日程' },
      { key: 'k  /  ↑', desc: '光标上移：聚焦上一项日程' },
      { key: 'x', desc: '多选切换：选中 / 反选当前聚焦项' },
      { key: 'Space', desc: '完成切换：完成或重新开启当前日程' },
      { key: 'e', desc: '快速编辑：打开当前日程编辑弹层' },
      { key: 'p', desc: '专注模式：为当前日程启动 25 分钟番茄钟' },
      { key: `${cmdKey} + D`, desc: '快速克隆：复制当前聚焦日程至明日 (+1天)' },
      { key: 'Delete', desc: '删除日程：删除当前项（放入废纸篓）' },
    ],
  },
  {
    category: '番茄专注沉浸模态',
    items: [
      { key: 'Space', desc: '开始或暂停当前专注 / 休息倒计时' },
      { key: 'V  /  H', desc: 'V 切换 5 种计时展现形式；H 切换 6 种全息表盘 HUD' },
      { key: 'R', desc: '重置当前阶段倒计时并清除本轮扰动' },
      { key: 'N', desc: '跳过当前阶段，进入短休 / 长休 / 下一轮' },
      { key: 'M', desc: '一键静音或开启背景环境声景' },
      { key: 'Z', desc: '切换禅意极简模式，隐去非必要信息' },
      { key: 'D  /  [  ]', desc: '记录 1 次分心觉察；[ / ] 微调 5 分钟' },
    ],
  },
];
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="shortcuts-card st-reticle" role="dialog" aria-modal="true" aria-label="键盘快捷键">
      <div class="card-head">
        <div class="head-left">
          <span class="head-eyebrow">GLOWCAP KEYMAP · 指端笔意</span>
          <h3 class="head-title">按键快捷操作速查指南 <span class="shanshui-seal baiwen" title="键谱朱印">键</span></h3>
        </div>
        <button class="modal-close-btn" title="关闭" aria-label="关闭" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="shortcuts-body">
        <div v-for="(cat, idx) in shortcuts" :key="cat.category" class="cat-section">
          <div class="cat-title-row">
            <h4 class="cat-title">0{{ idx + 1 }} · {{ cat.category }}</h4>
            <span class="cat-count tabular-nums">{{ cat.items.length }} 项</span>
          </div>
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
  z-index: var(--z-overlay-high);
}

.shortcuts-card {
  position: relative;
  width: 580px;
  max-width: 92vw;
  max-height: min(86vh, 660px);
  border-radius: 18px;
  padding: 20px 24px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(65% 45% at 85% 0%, color-mix(in srgb, var(--tide) 9%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
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
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cat-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.cat-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cat-title {
  margin: 0;
  font: 700 9.5px var(--font-mono);
  color: var(--text-quaternary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.cat-count {
  font: 700 9.5px var(--font-mono);
  color: var(--text-quaternary);
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
  border-bottom-width: 2px;
  color: var(--text-primary);
  box-shadow: inset 0 1px 0 var(--highlight-edge), var(--shadow-xs);
  transition: border-color var(--motion-fast), color var(--motion-fast);
}

.shortcut-row:hover .sc-kbd {
  border-color: var(--tide);
  color: var(--tide-text);
}

.card-foot {
  flex: none;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
  text-align: center;
}

.foot-tip {
  font: 600 10px var(--font-mono);
  color: var(--text-quaternary);
}
</style>
