<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Reminder } from '../../bindings/agenda/internal/agenda/models';
import {
  GetAIConfig,
  SaveAIConfig,
  TestAIConnection,
  BackupDatabase,
  ArchiveOldEndedReminders,
  ClearDeliveryHistory,
  OptimizeDatabase,
  ImportJSONBackup,
} from '../../bindings/agenda/internal/agenda/agendaservice';
import {
  playReminderChime,
  getSoundProfile,
  setSoundProfile,
  type SoundProfile,
} from '../utils/audio';
import { exportToMarkdown, exportToCSV, triggerFileDownload } from '../utils/export';
import ScrolltideSelect from './ScrolltideSelect.vue';

const props = defineProps<{
  visible: boolean;
  reminders?: Reminder[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'test-notify'): void;
  (e: 'toast', msg: string, type: 'success' | 'error' | 'info'): void;
  (e: 'refresh'): void;
  (e: 'open-trash'): void;
  (e: 'sound-change', enabled: boolean): void;
}>();

const defaultLead = ref(localStorage.getItem('agenda_default_lead') || '10');
const soundEnabled = ref(localStorage.getItem('agenda_sound_enabled') !== 'false');
const currentTheme = ref(localStorage.getItem('agenda_theme') || 'midnight');
const currentSoundProfile = ref<SoundProfile>(getSoundProfile());

const soundProfiles = [
  { id: 'crystal', name: '晶体双音谐波 (典雅清脆)' },
  { id: 'cyber', name: '赛博极客调频 (数码科技)' },
  { id: 'zen', name: '禅音颂钵鸣响 (深邃舒缓)' },
  { id: 'droplet', name: '灵动自然水滴 (轻柔灵动)' },
];

const soundProfileOptions = soundProfiles.map((sp) => ({ value: sp.id, label: sp.name }));
const leadPresets = [
  { value: '0', label: '准时' },
  { value: '5', label: '5m' },
  { id: '10', label: '10m' },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
];

function handleSoundProfileChange() {
  setSoundProfile(currentSoundProfile.value);
  playReminderChime(0.28, currentSoundProfile.value);
  emit('toast', `已切换提醒音效为「${soundProfiles.find(s => s.id === currentSoundProfile.value)?.name}」`, 'info');
}

const isOptimizingDB = ref(false);
const dbOptimizeResult = ref('');

async function handleOptimizeDB() {
  isOptimizingDB.value = true;
  try {
    const res = await OptimizeDatabase();
    dbOptimizeResult.value = res;
    emit('toast', '数据库体检与整理完成！', 'success');
  } catch (err: any) {
    emit('toast', `优化失败: ${err.message || err}`, 'error');
  } finally {
    isOptimizingDB.value = false;
  }
}

// Themes definition (Scrolltide Curated Surfaces)
const themes = [
  { id: 'midnight', name: 'Scrolltide 曜石', color: '#46b7ff', desc: '深海曜石黑配潮汐蓝与青柠高反差（默认）' },
  { id: 'daylight', name: 'Roadmap 晴石', color: '#f3f4ef', desc: 'Scrolltide /ui 同款暖白编排工作台' },
  { id: 'cyber', name: 'Midwater 碧潮', color: '#00d2ef', desc: '深海电光青与澄净高对比光影' },
  { id: 'amber', name: 'Ember 琥珀', color: '#ff8b1a', desc: '余晖暖金与深邃曜石双地平线' },
  { id: 'aurora', name: 'Orchid 幻紫', color: '#a685ff', desc: '幽兰紫韵漩涡强调色' },
];

function selectTheme(themeId: string) {
  currentTheme.value = themeId;
  if (themeId === 'midnight') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', themeId);
  }
  localStorage.setItem('agenda_theme', themeId);
  emit('toast', `已切换主题为「${themes.find(t => t.id === themeId)?.name}」`, 'success');
}

function handleSoundToggle() {
  localStorage.setItem('agenda_sound_enabled', String(soundEnabled.value));
  emit('sound-change', soundEnabled.value);
  window.dispatchEvent(new CustomEvent('agenda:sound-preference', { detail: soundEnabled.value }));
}

function handleDefaultLeadChange(val?: string) {
  if (typeof val === 'string') defaultLead.value = val;
  localStorage.setItem('agenda_default_lead', defaultLead.value);
  emit('toast', defaultLead.value === '0' ? '默认已设为准时提醒' : `默认提前提醒已设为 ${defaultLead.value} 分钟`, 'success');
}

function handleTestAudio() {
  playReminderChime(0.28);
  emit('toast', '已播放双音谐波晶体提示音效', 'info');
}

// AI Config
const aiBaseURL = ref('https://api.deepseek.com/v1');
const aiAPIKey = ref('');
const aiModel = ref('deepseek-chat');
const isTestingAI = ref(false);
const testResult = ref('');
const testSuccess = ref(false);

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      testResult.value = '';
      destructiveConfirm.value = null;
      currentTheme.value = localStorage.getItem('agenda_theme') || 'midnight';
      soundEnabled.value = localStorage.getItem('agenda_sound_enabled') !== 'false';
      try {
        const cfg = await GetAIConfig();
        if (cfg) {
          aiBaseURL.value = cfg.base_url || 'https://api.deepseek.com/v1';
          aiAPIKey.value = cfg.api_key || '';
          aiModel.value = cfg.model || 'deepseek-chat';
        }
      } catch (e) {
        // ignore
      }
    }
  }
);

async function handleTestAI() {
  if (!aiAPIKey.value.trim()) {
    testResult.value = '请先输入 API Key 再进行测试';
    testSuccess.value = false;
    return;
  }
  isTestingAI.value = true;
  testResult.value = '正在测试连接...';
  try {
    const res = await TestAIConnection(aiBaseURL.value, aiAPIKey.value, aiModel.value);
    testResult.value = res;
    testSuccess.value = true;
  } catch (err: any) {
    testResult.value = err.message || String(err);
    testSuccess.value = false;
  } finally {
    isTestingAI.value = false;
  }
}

async function handleSaveAI() {
  try {
    await SaveAIConfig({
      base_url: aiBaseURL.value.trim(),
      api_key: aiAPIKey.value.trim(),
      model: aiModel.value.trim(),
    });
    emit('toast', '已保存 AI 模型配置', 'success');
  } catch (err: any) {
    emit('toast', `保存失败: ${err.message || err}`, 'error');
  }
}

// Data Management
const isBackingUp = ref(false);
const backupPath = ref('');
const destructiveConfirm = ref<'archive' | 'history' | null>(null);
const isArchiving = ref(false);
const isClearingHistory = ref(false);

async function handleBackupDB() {
  isBackingUp.value = true;
  try {
    const path = await BackupDatabase();
    backupPath.value = path;
    emit('toast', `数据库快照备份成功！`, 'success');
  } catch (err: any) {
    emit('toast', `备份失败: ${err.message || err}`, 'error');
  } finally {
    isBackingUp.value = false;
  }
}

async function handleArchive() {
  if (isArchiving.value) return;
  if (destructiveConfirm.value !== 'archive') {
    destructiveConfirm.value = 'archive';
    return;
  }
  destructiveConfirm.value = null;
  isArchiving.value = true;
  try {
    const count = await ArchiveOldEndedReminders(30);
    emit('toast', `归档完成：已清理 ${count} 条 30 天前的历史日程`, 'success');
    emit('refresh');
  } catch (err: any) {
    emit('toast', `归档失败: ${err.message || err}`, 'error');
  } finally {
    isArchiving.value = false;
  }
}

async function handleClearHistory() {
  if (isClearingHistory.value) return;
  if (destructiveConfirm.value !== 'history') {
    destructiveConfirm.value = 'history';
    return;
  }
  destructiveConfirm.value = null;
  isClearingHistory.value = true;
  try {
    await ClearDeliveryHistory();
    emit('toast', '已清空消息投递历史日志', 'info');
  } catch (err: any) {
    emit('toast', `清空失败: ${err.message || err}`, 'error');
  } finally {
    isClearingHistory.value = false;
  }
}

function handleExportMD() {
  const list = props.reminders || [];
  if (list.length === 0) {
    emit('toast', '暂无日程可导出', 'info');
    return;
  }
  const md = exportToMarkdown(list);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  triggerFileDownload(md, `Agenda_Butler_${dateStr}.md`, 'text/markdown;charset=utf-8');
  emit('toast', `已成功导出全部 ${list.length} 条日程为 Markdown`, 'success');
}

function handleExportCSV() {
  const list = props.reminders || [];
  if (list.length === 0) {
    emit('toast', '暂无日程可导出', 'info');
    return;
  }
  const csv = exportToCSV(list);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  triggerFileDownload(csv, `Agenda_Butler_${dateStr}.csv`, 'text/csv;charset=utf-8');
  emit('toast', `已成功导出全部 ${list.length} 条日程为 CSV 表格`, 'success');
}

// Full Fidelity JSON Export & Restore (Round 57)
const jsonFileInputRef = ref<HTMLInputElement | null>(null);

function handleExportJSON() {
  const list = props.reminders || [];
  if (list.length === 0) {
    emit('toast', '暂无日程可导出', 'info');
    return;
  }
  const jsonStr = JSON.stringify(list, null, 2);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  triggerFileDownload(jsonStr, `Agenda_Backup_${dateStr}.json`, 'application/json;charset=utf-8');
  emit('toast', `已成功导出全部 ${list.length} 条日程为 JSON 备份`, 'success');
}

function triggerImportJSON() {
  jsonFileInputRef.value?.click();
}

async function onJSONFileSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const file = target.files[0];
  try {
    const text = await file.text();
    const count = await ImportJSONBackup(text);
    emit('toast', `成功恢复导入 ${count} 条日程！`, 'success');
    emit('refresh');
  } catch (err: any) {
    emit('toast', `导入失败: ${err.message || err}`, 'error');
  } finally {
    target.value = '';
  }
}

// DND Quiet Hours (Round 55)
const dndEnabled = ref(localStorage.getItem('agenda_dnd_enabled') === 'true');
const dndStart = ref(localStorage.getItem('agenda_dnd_start') || '23:00');
const dndEnd = ref(localStorage.getItem('agenda_dnd_end') || '08:00');

function handleDndToggle() {
  localStorage.setItem('agenda_dnd_enabled', String(dndEnabled.value));
  localStorage.setItem('agenda_dnd_start', dndStart.value);
  localStorage.setItem('agenda_dnd_end', dndEnd.value);
  emit('toast', dndEnabled.value ? `已启用夜间免打扰 (${dndStart.value} - ${dndEnd.value})` : '已关闭夜间免打扰', 'info');
}
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card st-reticle" role="dialog" aria-modal="true" aria-label="设置">
      <div class="modal-head">
        <div class="modal-head-copy">
          <span class="settings-eyebrow">SYSTEM PREFERENCES · CONFIG</span>
          <h3 class="modal-title">系统偏好与设置</h3>
        </div>
        <button class="icon-btn" title="关闭" @click="$emit('close')">✕</button>
      </div>

      <div class="settings-body">
        <!-- AI Model Configuration Section -->
        <div class="settings-section ai-section">
          <div class="section-head">
            <h4 class="section-title">✨ AI 大模型接入 (DeepSeek / OpenAI / Ollama)</h4>
            <span class="ai-chip">LLM Enabled</span>
          </div>

          <div class="ai-form">
            <div class="form-row">
              <label class="field-label">API 接口地址 (Base URL)</label>
              <input
                v-model="aiBaseURL"
                type="text"
                class="form-input"
                placeholder="https://api.deepseek.com/v1 或 http://localhost:11434/v1"
              />
            </div>

            <div class="form-row">
              <label class="field-label">API Key</label>
              <input
                v-model="aiAPIKey"
                type="password"
                class="form-input"
                placeholder="sk-..."
              />
            </div>

            <div class="form-row">
              <label class="field-label">模型名称 (Model)</label>
              <input
                v-model="aiModel"
                type="text"
                class="form-input"
                placeholder="deepseek-chat / gpt-4o-mini / qwen-turbo"
              />
            </div>

            <div class="ai-actions-row">
              <button
                class="icon-btn test-btn"
                :disabled="isTestingAI"
                @click="handleTestAI"
              >
                {{ isTestingAI ? '测试中...' : '测试模型连接' }}
              </button>

              <button class="primary-btn save-ai-btn" @click="handleSaveAI">
                保存模型配置
              </button>
            </div>

            <div v-if="testResult" class="test-feedback" :class="{ success: testSuccess }">
              {{ testResult }}
            </div>
          </div>
        </div>

        <!-- Theme Selector Section -->
        <div class="settings-section">
          <h4 class="section-title">界面美学主题</h4>
          <div class="theme-grid">
            <button
              v-for="t in themes"
              :key="t.id"
              class="theme-card"
              :class="{ active: currentTheme === t.id }"
              @click="selectTheme(t.id)"
            >
              <div class="theme-preview">
                <span class="theme-color-dot" :style="{ backgroundColor: t.color }"></span>
                <span class="theme-name">{{ t.name }}</span>
              </div>
              <span class="theme-desc">{{ t.desc }}</span>
            </button>
          </div>
        </div>

        <!-- Reminders Preference -->
        <div class="settings-section">
          <h4 class="section-title">提醒通知偏好</h4>
          <div class="setting-item">
            <span class="setting-name">默认提前提醒</span>
            <div class="lead-pill-group" role="group" aria-label="默认提前提醒">
              <button
                v-for="opt in leadPresets"
                :key="opt.value"
                type="button"
                class="lead-pill-btn"
                :class="{ active: defaultLead === opt.value }"
                @click="handleDefaultLeadChange(opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="setting-item">
            <div class="setting-label-group">
              <span class="setting-name">提醒音效音色</span>
              <span class="setting-subtext">选择内置 Web Audio 合成音色</span>
            </div>
            <ScrolltideSelect
              v-model="currentSoundProfile"
              :options="soundProfileOptions"
              compact
              align="right"
              aria-label="提醒音效音色"
              @change="handleSoundProfileChange"
            />
          </div>

          <div class="setting-item">
            <div class="setting-label-group">
              <span class="setting-name">声音提示音效</span>
              <span class="setting-subtext">日程触发时播放提示音</span>
            </div>
            <div class="audio-controls">
              <button class="icon-btn test-btn audio-test-btn" @click="handleTestAudio">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
                <span>试听音效</span>
              </button>
              <input
                type="checkbox"
                v-model="soundEnabled"
                class="setting-checkbox"
                @change="handleSoundToggle"
              />
            </div>
          </div>

          <div class="setting-item">
            <span class="setting-name">测试原生系统通知</span>
            <button class="icon-btn test-btn" @click="$emit('test-notify')">
              立即发送测试通知
            </button>
          </div>

          <!-- DND Quiet Hours (Round 55) -->
          <div class="setting-item">
            <div class="setting-label-group">
              <span class="setting-name">夜间免打扰 (DND)</span>
              <span class="setting-subtext">静音时段内不播放音效，仅保留系统静默通知</span>
            </div>
            <div class="dnd-controls-row">
              <input type="time" v-model="dndStart" class="dnd-time-input" @change="handleDndToggle" />
              <span class="dnd-sep">至</span>
              <input type="time" v-model="dndEnd" class="dnd-time-input" @change="handleDndToggle" />
              <input
                type="checkbox"
                v-model="dndEnabled"
                class="setting-checkbox"
                @change="handleDndToggle"
              />
            </div>
          </div>
        </div>

        <!-- Data Management & Backup Section (Rounds 16, 17, 18, 57) -->
        <div class="settings-section">
          <div class="section-head">
            <h4 class="section-title">📦 本地数据安全与快照备份</h4>
            <span class="db-chip">SQLite WAL</span>
          </div>

          <div class="setting-item data-item">
            <div class="setting-label-group">
              <span class="setting-name">创建数据库快照</span>
              <span class="setting-subtext">生成带精准时间戳的 SQLite 物理备份副本</span>
            </div>
            <button class="icon-btn test-btn" :disabled="isBackingUp" @click="handleBackupDB">
              {{ isBackingUp ? '备份中...' : '立即备份' }}
            </button>
          </div>
          <div v-if="backupPath" class="test-feedback success">
            已成功备份至: {{ backupPath }}
          </div>

          <div class="setting-item data-item">
            <div class="setting-label-group">
              <span class="setting-name">历史数据智能归档</span>
              <span class="setting-subtext">归档并清理 30 天前已结束的历史日程</span>
            </div>
            <button class="icon-btn test-btn" :class="{ danger: destructiveConfirm === 'archive' }" :disabled="isArchiving" @click="handleArchive">
              {{ isArchiving ? '归档中…' : destructiveConfirm === 'archive' ? '确认清理 30 天前日程' : '清理归档' }}
            </button>
          </div>

          <div class="setting-item data-item">
            <div class="setting-label-group">
              <span class="setting-name">清空推送审计日志</span>
              <span class="setting-subtext">清空已记录的桌面通知与弹窗历史</span>
            </div>
            <button class="icon-btn test-btn" :class="{ danger: destructiveConfirm === 'history' }" :disabled="isClearingHistory" @click="handleClearHistory">
              {{ isClearingHistory ? '清空中…' : destructiveConfirm === 'history' ? '确认永久清空记录' : '清空记录' }}
            </button>
          </div>

          <div class="setting-item data-item">
            <div class="setting-label-group">
              <span class="setting-name">全量数据多格式导出 & 恢复</span>
              <span class="setting-subtext">支持 JSON 全保真迁移备份、Markdown 待办清单与 CSV 表格</span>
            </div>
            <div class="export-btns">
              <button class="icon-btn test-btn" title="导出 JSON 备份" @click="handleExportJSON">
                JSON 备份
              </button>
              <button class="icon-btn test-btn" title="导入恢复 JSON" @click="triggerImportJSON">
                📥 恢复 JSON
              </button>
              <button class="icon-btn test-btn" @click="handleExportMD">
                Markdown
              </button>
              <button class="icon-btn test-btn" @click="handleExportCSV">
                Excel CSV
              </button>
              <input
                ref="jsonFileInputRef"
                type="file"
                accept=".json,application/json"
                style="display: none"
                @change="onJSONFileSelected"
              />
            </div>
          </div>

          <div class="setting-item data-item">
            <div class="setting-label-group">
              <span class="setting-name">数据库体检与整理</span>
              <span class="setting-subtext">执行 PRAGMA 完整性检测与 VACUUM 碎片释放</span>
            </div>
            <button class="icon-btn test-btn" :disabled="isOptimizingDB" @click="handleOptimizeDB">
              {{ isOptimizingDB ? '检测中...' : '开始体检整理' }}
            </button>
          </div>
          <div v-if="dbOptimizeResult" class="test-feedback success">
            {{ dbOptimizeResult }}
          </div>

          <div class="setting-item data-item">
            <div class="setting-label-group">
              <span class="setting-name">已删除日程管理</span>
              <span class="setting-subtext">查看或还原已移入废纸篓的历史日程</span>
            </div>
            <button class="icon-btn test-btn" @click="$emit('open-trash')">
              打开废纸篓 🗑️
            </button>
          </div>
        </div>

        <!-- Architecture Info -->
        <div class="settings-section">
          <h4 class="section-title">技术架构一览</h4>
          <div class="tech-grid">
            <div class="tech-item">
              <span class="tech-label">客户端内核</span>
              <span class="tech-val">Wails v3.1.0</span>
            </div>
            <div class="tech-item">
              <span class="tech-label">前端框架</span>
              <span class="tech-val">Vue 3 + TypeScript</span>
            </div>
            <div class="tech-item">
              <span class="tech-label">构建系统</span>
              <span class="tech-val">Vite 8</span>
            </div>
            <div class="tech-item">
              <span class="tech-label">后台主机</span>
              <span class="tech-val">Golang 1.27</span>
            </div>
            <div class="tech-item">
              <span class="tech-label">本地数据库</span>
              <span class="tech-val">SQLite (modernc.org)</span>
            </div>
            <div class="tech-item">
              <span class="tech-label">数据存储目录</span>
              <span class="tech-val">~/.agenda/agenda.db</span>
            </div>
          </div>
        </div>

        <div class="about-footer">
          <p>日程管家 PC 桌面版 · Agenda Butler AI</p>
          <p class="about-sub">Wails3 + Vite + Vue3 + TS + Go + SQLite + LLM 智能日程管理终端</p>
        </div>
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
  width: 540px;
  max-width: 92vw;
  max-height: 85vh;
  border-radius: 18px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    radial-gradient(65% 40% at 88% 0%, color-mix(in srgb, var(--tide) 9%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal-head {
  flex: none;
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

.settings-eyebrow {
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

.settings-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--fill-subtle);
  padding: 13px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-l1);
}

.ai-section {
  border-color: var(--accent-border);
  background: radial-gradient(65% 50% at 100% 0%, var(--accent-soft), transparent 70%), var(--surface);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  margin: 0;
  font: 700 10.5px var(--font-mono);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.ai-section .section-title {
  color: var(--tide-text);
}

.ai-chip {
  font: 700 9.5px var(--font-mono);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  color: var(--tide-text);
}

.db-chip {
  font: 700 9.5px var(--font-mono);
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 34%, transparent);
  color: var(--success);
}

.export-btns {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.field-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}

.form-input {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--border-l1);
  background: var(--input-bg);
  color: var(--text-primary);
  font-size: 12.5px;
  outline: none;
  transition: all 0.15s ease;
}

.form-input:focus {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.ai-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.test-feedback {
  font-size: 11.5px;
  padding: 6px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  color: var(--danger);
  word-break: break-all;
  line-height: 1.4;
}

.test-feedback.success {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
  color: var(--success);
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting-name {
  font-size: 13px;
  color: var(--text-secondary);
}

.lead-pill-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
}

.lead-pill-btn {
  height: 24px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--text-tertiary);
  font: 600 11px var(--font-mono);
  cursor: pointer;
  transition: all var(--motion-fast);
}

.lead-pill-btn:hover {
  color: var(--text-primary);
  background: var(--fill-hover);
}

.lead-pill-btn.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--tide-text);
}

.setting-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--brand-primary);
}

.test-btn {
  width: auto;
  padding: 0 10px;
  height: 28px;
  font-size: 12px;
  font-weight: 600;
}

.save-ai-btn {
  height: 30px;
  font-size: 12px;
  padding: 0 14px;
  background: var(--cta-bg);
  color: var(--cta-ink);
  border: 1px solid transparent;
  border-radius: 999px;
}

.tech-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

/* Theme Grid */
.theme-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-card {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-l1);
  background: var(--fill-subtle);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  transition: all 0.15s ease;
}

.theme-card:hover {
  background: var(--fill-hover);
  border-color: var(--border-l2);
}

.theme-card.active {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent-border);
}

.theme-preview {
  display: flex;
  align-items: center;
  gap: 6px;
}

.theme-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  box-shadow: 0 0 8px currentColor;
  flex-shrink: 0;
}

.theme-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.theme-desc {
  font-size: 10px;
  color: var(--text-muted);
}

.setting-label-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-subtext {
  font-size: 10.5px;
  color: var(--text-muted);
}

.audio-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.audio-test-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  height: 26px;
  padding: 0 8px;
}

.tech-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tech-label {
  font-size: 10.5px;
  color: var(--text-muted);
}

.tech-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
}

.about-footer {
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-top: 4px;
}

.about-sub {
  font-size: 10.5px;
  color: var(--text-muted);
  opacity: 0.8;
}

.dnd-controls-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dnd-time-input {
  background: var(--input-bg);
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  color: var(--text-primary);
  padding: 3px 8px;
  font: 600 11px var(--font-mono);
}

.dnd-sep {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
