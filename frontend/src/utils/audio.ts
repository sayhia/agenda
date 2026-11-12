/**
 * Web Audio API Chime Synthesizer
 * Generates an elegant dual-tone harmonic crystal chime without external audio assets.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export type SoundProfile = 'crystal' | 'cyber' | 'zen' | 'droplet';

export function getSoundProfile(): SoundProfile {
  return (localStorage.getItem('agenda_sound_profile') as SoundProfile) || 'crystal';
}

export function setSoundProfile(profile: SoundProfile): void {
  localStorage.setItem('agenda_sound_profile', profile);
}

export function playReminderChime(volume: number = 0.25, overrideProfile?: SoundProfile): void {
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

export function playFocusCompleteChime(): void {
  playReminderChime(0.35, 'crystal');
}
