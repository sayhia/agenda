<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  getAllSolarTerms,
  getApproxSolarTerm,
  getChineseShichen,
  getCurrentSeasonMeta,
  getFourSeasonsMeta,
  getNextSolarTerm,
  type FourSeasonInfo,
  type SolarTermDetail,
} from '../utils/shanshui';
import { getThemeDefinition } from '../utils/themes';

const props = defineProps<{
  visible: boolean;
  currentTheme?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select-theme', themeId: string): void;
  (e: 'create-on-date', dateKey: string): void;
}>();

const baseYear = new Date().getFullYear();
const selectedYear = ref(baseYear);
const activeSeasonFilter = ref<'all' | '春' | '夏' | '秋' | '冬'>('all');

const seasonsMeta = getFourSeasonsMeta();

const liveSnapshot = computed(() => {
  const now = new Date();
  return {
    solar: getApproxSolarTerm(now),
    season: getCurrentSeasonMeta(now),
    next: getNextSolarTerm(now),
    shichen: getChineseShichen(now),
  };
});

watch(
  () => props.visible,
  (v) => {
    if (v) {
      selectedYear.value = new Date().getFullYear();
      activeSeasonFilter.value = 'all';
    }
  },
);

const yearTerms = computed<SolarTermDetail[]>(() => getAllSolarTerms(selectedYear.value));

const filteredTerms = computed<SolarTermDetail[]>(() => {
  if (activeSeasonFilter.value === 'all') return yearTerms.value;
  return yearTerms.value.filter((t) => t.season === activeSeasonFilter.value);
});

const highlightedSeason = computed<FourSeasonInfo>(() => {
  if (activeSeasonFilter.value === 'all') return liveSnapshot.value.season;
  return seasonsMeta.find((s) => s.season === activeSeasonFilter.value) || liveSnapshot.value.season;
});

const recommendedThemesForSeason = computed(() =>
  highlightedSeason.value.recommendedThemeIds
    .map((id) => getThemeDefinition(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item)),
);

function isCurrentSolarTerm(term: SolarTermDetail): boolean {
  return selectedYear.value === baseYear && term.name === liveSnapshot.value.solar.name;
}

function getRelativeDayTag(term: SolarTermDetail): string | null {
  if (isCurrentSolarTerm(term)) return '当令节气';
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((term.date.getTime() - todayStart.getTime()) / 86_400_000);
  if (diffDays === 0) return '今日交节';
  if (diffDays > 0 && diffDays <= 45) return `${diffDays} 天后`;
  return null;
}

function handlePickTheme(themeId: string) {
  emit('select-theme', themeId);
}

function handleScheduleTerm(term: SolarTermDetail) {
  emit('close');
  emit('create-on-date', term.dateKey);
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="solar-modal-card st-reticle" role="dialog" aria-modal="true" aria-label="四时与二十四节气图鉴">
      <!-- Header -->
      <div class="solar-head">
        <div class="solar-head-left">
          <div class="solar-title-row">
            <span class="shanshui-seal baiwen" title="节气印信">节</span>
            <h3 class="modal-title">四时流转 · 二十四节气图鉴</h3>
            <span class="solar-live-chip">
              当下 {{ liveSnapshot.season.alias }} · {{ liveSnapshot.solar.name }} · {{ liveSnapshot.shichen.branch }}时
            </span>
          </div>
          <p class="solar-subtitle">
            距下一节气「{{ liveSnapshot.next.term.name }}」（{{ liveSnapshot.next.term.monthDayLabel }}）尚余
            <strong>{{ liveSnapshot.next.daysRemaining }}</strong> 天 · {{ liveSnapshot.solar.verse }}
          </p>
        </div>

        <div class="solar-head-right">
          <button
            v-if="selectedYear !== baseYear"
            type="button"
            class="filter-all-pill"
            title="回到今年"
            @click="selectedYear = baseYear"
          >
            回今年
          </button>
          <div class="year-stepper" role="group" aria-label="切换年份">
            <button type="button" title="上一年" aria-label="上一年" @click="selectedYear--">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span class="tabular-nums">{{ selectedYear }} 年</span>
            <button type="button" title="下一年" aria-label="下一年" @click="selectedYear++">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          <button class="modal-close-btn" title="关闭" aria-label="关闭" @click="$emit('close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Four Seasons Cards -->
      <div class="seasons-strip" role="tablist" aria-label="四季选择">
        <button
          v-for="s in seasonsMeta"
          :key="s.season"
          type="button"
          class="season-card"
          :class="{
            active: activeSeasonFilter === s.season,
            'is-live': s.season === liveSnapshot.season.season,
          }"
          :style="{ '--season-accent': s.color }"
          @click="activeSeasonFilter = activeSeasonFilter === s.season ? 'all' : s.season"
        >
          <div class="season-card-top">
            <span class="shanshui-seal">{{ s.sealChar }}</span>
            <span class="season-title">{{ s.title }}</span>
            <span v-if="s.season === liveSnapshot.season.season" class="season-now-badge">当季</span>
          </div>
          <div class="season-card-meta">
            <span>{{ s.alias }} · 6 节气</span>
            <span class="season-tea">{{ s.tea }}</span>
          </div>
          <p class="season-poem">「{{ s.poem }}」</p>
        </button>
      </div>

      <!-- Focused Season Guidance & Matching Shanshui Themes -->
      <div class="season-focus-banner">
        <div class="season-focus-copy">
          <div class="season-focus-title-row">
            <button
              type="button"
              class="filter-all-pill"
              :class="{ active: activeSeasonFilter === 'all' }"
              @click="activeSeasonFilter = 'all'"
            >
              全部 24 节气
            </button>
            <span class="season-focus-tag">{{ highlightedSeason.alias }}时令起居</span>
            <span class="season-advice">{{ highlightedSeason.rhythmAdvice }}</span>
          </div>
        </div>
        <div class="season-theme-picks">
          <span class="picks-label">适季山水</span>
          <button
            v-for="theme in recommendedThemesForSeason"
            :key="theme.id"
            type="button"
            class="season-theme-btn"
            :class="{ active: currentTheme === theme.id }"
            :title="`${theme.name} · ${theme.poem || theme.desc}`"
            @click="handlePickTheme(theme.id)"
          >
            <span class="shanshui-seal" :style="{ '--seal-red': theme.sealColor }">{{ theme.sealChar }}</span>
            <span class="theme-dot-mini" :style="{ background: theme.color }"></span>
            <span>{{ theme.badge || theme.name }}</span>
          </button>
        </div>
      </div>

      <!-- 24 Solar Terms Grid -->
      <div class="solar-terms-grid">
        <div
          v-for="term in filteredTerms"
          :key="term.index"
          class="solar-term-card"
          :class="[
            'season-' + term.season,
            { 'is-current': isCurrentSolarTerm(term) },
          ]"
        >
          <div class="term-card-top">
            <div class="term-title-group">
              <span class="shanshui-seal" :class="{ baiwen: isCurrentSolarTerm(term) }">{{ term.sealChar }}</span>
              <strong class="term-name">{{ term.name }}</strong>
              <span class="term-season-chip">{{ term.season }}</span>
            </div>
            <div class="term-date-group">
              <span v-if="getRelativeDayTag(term)" class="term-rel-tag">{{ getRelativeDayTag(term) }}</span>
              <span class="term-date tabular-nums">{{ term.monthDayLabel }}</span>
            </div>
          </div>

          <p class="term-verse">{{ term.verse }}</p>
          <div class="term-sanhou"><strong>三候</strong> · {{ term.sanHou }}</div>
          <div class="term-card-foot">
            <span class="term-custom">{{ term.custom }}</span>
            <button
              type="button"
              class="term-add-btn st-inline-icon"
              :title="`在 ${term.dateKey}（${term.name}）新建日程`"
              @click="handleScheduleTerm(term)"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>记日程</span>
            </button>
          </div>
        </div>
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

.solar-modal-card {
  position: relative;
  width: 900px;
  max-width: 94vw;
  max-height: 88vh;
  border-radius: 18px;
  padding: 20px 24px;
  background:
    radial-gradient(65% 45% at 88% 0%, color-mix(in srgb, var(--tide) 10%, transparent), transparent 65%),
    var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}

.solar-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.solar-head-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.solar-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.modal-title {
  margin: 0;
  font-size: 16.5px;
  font-weight: 750;
  color: var(--text-primary);
}

.solar-live-chip {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--accent-border);
  background: var(--accent-soft);
  color: var(--tide-text);
  font: 700 10px var(--font-mono);
}

.solar-subtitle {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.solar-subtitle strong {
  color: var(--tide-text);
}

.solar-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.year-stepper {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 29px;
  padding: 0 6px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--text-primary);
  font: 600 11.5px var(--font-mono);
}

.year-stepper button {
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.year-stepper button:hover {
  background: var(--fill-hover);
  color: var(--text-primary);
}

.seasons-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.season-card {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  border-top: 2px solid color-mix(in srgb, var(--season-accent) 46%, transparent);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.16s ease;
}

.season-card:hover {
  background: var(--fill-hover);
  border-color: color-mix(in srgb, var(--season-accent) 52%, transparent);
  transform: translateY(-1px);
}

.season-card.is-live {
  border-color: color-mix(in srgb, var(--season-accent) 48%, var(--border-subtle));
}

.season-card.active {
  background: color-mix(in srgb, var(--season-accent) 14%, var(--surface));
  border-color: color-mix(in srgb, var(--season-accent) 76%, transparent);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--season-accent) 16%, transparent);
}

.season-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.season-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-primary);
  flex: 1;
}

.season-now-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--seal-red, #e05246) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--seal-red, #e05246) 45%, transparent);
  color: var(--seal-red, #e05246);
  font-size: 9.5px;
  font-weight: 700;
}

.season-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 10px;
  color: var(--text-tertiary);
}

.season-tea {
  color: var(--tide-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.season-poem {
  margin: 0;
  font-size: 10.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.season-focus-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
}

.season-focus-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-all-pill {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 650;
  cursor: pointer;
}

.filter-all-pill.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
  color: var(--tide-text);
}

.season-focus-tag {
  font: 700 10px var(--font-mono);
  color: var(--tide-text);
}

.season-advice {
  font-size: 11px;
  color: var(--text-secondary);
}

.season-theme-picks {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.picks-label {
  font: 700 10px var(--font-mono);
  color: var(--text-quaternary);
}

.season-theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 4px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 10.5px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.season-theme-btn:hover {
  border-color: var(--accent-border);
  color: var(--text-primary);
}

.season-theme-btn.active {
  background: var(--accent-soft);
  border-color: var(--tide);
  color: var(--tide-text);
  font-weight: 650;
}

.theme-dot-mini {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  border: 1px solid color-mix(in srgb, var(--text-primary) 24%, transparent);
}

.solar-terms-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding-right: 4px;
}

.solar-term-card {
  padding: 10px 12px;
  border-radius: 11px;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.solar-term-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.solar-term-card.is-current {
  border-color: color-mix(in srgb, var(--seal-red, #e05246) 58%, var(--tide));
  background: color-mix(in srgb, var(--seal-red, #e05246) 5%, var(--surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--seal-red, #e05246) 24%, transparent);
}

.term-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.term-title-group,
.term-date-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.term-name {
  font-size: 13.5px;
  font-weight: 750;
  color: var(--text-primary);
}

.term-season-chip {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  font-size: 9.5px;
}

.term-rel-tag {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--tide-text);
  font: 700 9px var(--font-mono);
}

.term-date {
  font: 600 10.5px var(--font-mono);
  color: var(--text-tertiary);
}

.term-verse {
  margin: 0;
  font-size: 11.5px;
  font-weight: 550;
  color: var(--text-secondary);
}

.term-sanhou {
  font-size: 10.5px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.term-sanhou strong {
  color: var(--tide-text);
  font-weight: 600;
}

.term-card-foot {
  margin-top: auto;
  padding-top: 4px;
  border-top: 1px dashed var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.term-custom {
  font-size: 10px;
  color: var(--text-quaternary);
}

.term-add-btn {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  background: var(--fill-subtle);
  color: var(--tide-text);
  font-size: 10px;
  font-weight: 650;
  cursor: pointer;
  flex: none;
  transition: all 0.14s ease;
}

.term-add-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

@media (max-width: 820px) {
  .seasons-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .solar-terms-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 560px) {
  .solar-terms-grid { grid-template-columns: 1fr; }
}
</style>
