/**
 * Web Audio API Chime & Focus Soundscape Synthesizer
 * Generates harmonic reminder chimes and delegates focus module audio to focusAudio.ts.
 */

import {
  getAudioContext,
  getSoundProfile,
  getSoundProfileLabel,
  getSoundVolume,
  isSoundPlaybackEnabled,
  setSoundProfile,
  setSoundVolume,
  SOUND_PROFILE_LABELS,
  type SoundProfile,
} from './audioCore.ts';

export {
  getSoundProfile,
  getSoundProfileLabel,
  getSoundVolume,
  isSoundPlaybackEnabled,
  setSoundProfile,
  setSoundVolume,
  SOUND_PROFILE_LABELS,
  type SoundProfile,
};

export {
  AMBIENT_SOUND_OPTIONS,
  getActiveAmbientSound,
  isAmbientPreviewActive,
  playFocusCompleteChime,
  playFocusDistractionSound,
  playFocusPauseSound,
  playFocusStartSound,
  playFocusTickSound,
  previewAmbientSound,
  setAmbientVolume,
  startAmbientSound,
  stopAmbientPreviewIfIdle,
  stopAmbientSound,
  type AmbientSound,
  type AmbientSoundMeta,
  type FocusSoundMode,
} from './focusAudio.ts';

export function playReminderChime(volume: number = getSoundVolume(), overrideProfile?: SoundProfile): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const profile = overrideProfile || getSoundProfile();
    const now = ctx.currentTime;

    if (profile === 'cyber') {
      // Cyber Tech: rapid two-frequency burst
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(880, now + 0.08);
      osc.frequency.setValueAtTime(1320, now + 0.16);
      gain.gain.setValueAtTime(volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);
      return;
    }

    if (profile === 'zen') {
      // Zen Singing Bowl: deep fundamental + subtle harmonic
      const freqs = [293.66, 587.33]; // D4, D5
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(volume * (idx === 0 ? 0.35 : 0.18), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.8);
      });
      return;
    }

    if (profile === 'droplet') {
      // Soft Liquid Droplet
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.18);
      gain.gain.setValueAtTime(volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
      return;
    }

    if (profile === 'guqin') {
      // 中国古琴五声音阶（宫商角徵羽：C5, E5, G5, A5）轻拨余韵
      const pentatonic = [523.25, 659.25, 783.99, 880.0];
      pentatonic.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const overtone = ctx.createOscillator();
        const gain = ctx.createGain();
        const startAt = now + idx * 0.11;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startAt);
        overtone.type = 'sine';
        overtone.frequency.setValueAtTime(freq * 2, startAt);
        gain.gain.setValueAtTime(0.001, startAt);
        gain.gain.exponentialRampToValueAtTime((volume * 0.38) / (1 + idx * 0.25), startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.45);
        osc.connect(gain);
        overtone.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        overtone.start(startAt);
        osc.stop(startAt + 1.5);
        overtone.stop(startAt + 1.5);
      });
      return;
    }

    if (profile === 'qing') {
      // 山寺古磬清响（G4 基音与双倍泛音慢衰）
      const partials = [
        { freq: 392.0, weight: 0.42, decay: 2.1 },
        { freq: 784.0, weight: 0.16, decay: 1.5 },
        { freq: 1174.66, weight: 0.08, decay: 1.0 },
      ];
      partials.forEach((p) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(p.freq, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(volume * p.weight, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + p.decay + 0.05);
      });
      return;
    }

    // Default 'crystal': Harmonic Chord (E5 = 659.25Hz, A5 = 880Hz, C#6 = 1108.73Hz)
    const tones = [659.25, 880, 1108.73];

    tones.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      const startTime = now + idx * 0.08;
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(volume / (idx + 1), startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 1.3);
    });
  } catch (e) {
    console.warn('Audio playback not allowed or failed:', e);
  }
}

export function playCompleteSound(volume: number = 0.2): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.1); // G5
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}
