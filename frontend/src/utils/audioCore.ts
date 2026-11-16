/**
 * Shared Web Audio API Context, Sound Profile & Volume Preferences.
 */

let audioCtx: AudioContext | null = null;

export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {
      // Ignore autoplay policy rejections until user interaction.
    });
  }
  return audioCtx;
}

export type SoundProfile = 'crystal' | 'cyber' | 'zen' | 'droplet' | 'guqin' | 'qing';

export const SOUND_PROFILE_LABELS: Record<SoundProfile, { label: string; short: string }> = {
  crystal: { label: '水晶清音', short: '晶' },
  cyber: { label: '电光脉冲', short: '电' },
  zen: { label: '禅意颂钵', short: '钵' },
  droplet: { label: '清泉落滴', short: '泉' },
  guqin: { label: '松风古琴', short: '琴' },
  qing: { label: '山寺玉磬', short: '磬' },
};

export function getSoundProfileLabel(profile?: SoundProfile): { label: string; short: string } {
  return SOUND_PROFILE_LABELS[profile || 'crystal'] || SOUND_PROFILE_LABELS.crystal;
}

export function getSoundProfile(): SoundProfile {
  if (typeof localStorage === 'undefined') return 'crystal';
  return (localStorage.getItem('agenda_sound_profile') as SoundProfile) || 'crystal';
}

export function setSoundProfile(profile: SoundProfile): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('agenda_sound_profile', profile);
}

export function getSoundVolume(): number {
  if (typeof localStorage === 'undefined') return 0.28;
  const raw = localStorage.getItem('agenda_sound_volume');
  if (raw) {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
  }
  return 0.28;
}

export function setSoundVolume(v: number): void {
  if (typeof localStorage === 'undefined') return;
  const clamped = Math.max(0, Math.min(1, v));
  localStorage.setItem('agenda_sound_volume', String(clamped));
}

export function isSoundPlaybackEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem('agenda_sound_enabled') !== 'false';
}
