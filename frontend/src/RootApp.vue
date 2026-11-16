<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted } from 'vue';
import type { AgendaView } from './types/ui';
import { setSoundProfile, setSoundVolume, type SoundProfile } from './utils/audio';
import { setLanguage, type Language } from './utils/i18n';
import { applyThemeToDocument, resolveEffectiveThemeId } from './utils/themes';

const App = defineAsyncComponent(() => import('./App.vue'));
const QuickAddWindow = defineAsyncComponent(() => import('./components/windows/QuickAddWindow.vue'));
const TrayPopoverWindow = defineAsyncComponent(() => import('./components/windows/TrayPopoverWindow.vue'));
const FocusStandaloneWindow = defineAsyncComponent(() => import('./components/windows/FocusStandaloneWindow.vue'));
const AIStandaloneWindow = defineAsyncComponent(() => import('./components/windows/AIStandaloneWindow.vue'));

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
const windowKind = params.get('window') || 'main';
const viewParam = params.get('view') as AgendaView | null;
const validViews: AgendaView[] = ['list', 'week', 'month', 'matrix'];
const initialView: AgendaView | undefined = viewParam && validViews.includes(viewParam) ? viewParam : undefined;
const isSecondaryWorkspace = computed(() => windowKind === 'workspace');

function handleCrossWindowStorage(e: StorageEvent) {
  if (!e.key) return;
  if (
    e.key === 'agenda_theme' ||
    e.key === 'agenda_theme_mode' ||
    e.key === 'agenda_custom_accent' ||
    e.key === 'agenda_canvas_intensity' ||
    e.key === 'agenda_high_contrast' ||
    e.key === 'agenda_shanshui_serif'
  ) {
    applyThemeToDocument(resolveEffectiveThemeId(), { animate: false, persist: false, dispatch: false });
    return;
  }
  if (e.key === 'agenda_sound_profile' && e.newValue) {
    setSoundProfile(e.newValue as SoundProfile);
    return;
  }
  if (e.key === 'agenda_sound_volume' && e.newValue) {
    const v = Number(e.newValue);
    if (Number.isFinite(v)) setSoundVolume(v);
    return;
  }
  if (e.key === 'agenda_sound_enabled') {
    window.dispatchEvent(new CustomEvent('agenda:sound-preference', { detail: e.newValue !== 'false' }));
    return;
  }
  if (e.key === 'agenda_language' && e.newValue) {
    setLanguage(e.newValue as Language);
  }
}

onMounted(() => {
  applyThemeToDocument(resolveEffectiveThemeId(), { animate: false, persist: false, dispatch: false });
  window.addEventListener('storage', handleCrossWindowStorage);
});

onUnmounted(() => {
  window.removeEventListener('storage', handleCrossWindowStorage);
});
</script>

<template>
  <QuickAddWindow v-if="windowKind === 'quick-add'" />
  <TrayPopoverWindow v-else-if="windowKind === 'tray-popover'" />
  <FocusStandaloneWindow v-else-if="windowKind === 'focus'" />
  <AIStandaloneWindow v-else-if="windowKind === 'ai'" />
  <App
    v-else
    :isSecondaryWorkspace="isSecondaryWorkspace"
    :initialView="initialView"
  />
</template>
