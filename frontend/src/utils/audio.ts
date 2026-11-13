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

export type AmbientSound = 'none' | 'rain' | 'alpha' | 'whitenoise';

let ambientSourceNode: AudioNode | null = null;
let ambientGainNode: GainNode | null = null;

export function stopAmbientSound(): void {
  try {
    if (ambientGainNode) {
      ambientGainNode.gain.linearRampToValueAtTime(0.0001, 0.2);
    }
    if (ambientSourceNode) {
      setTimeout(() => {
        try {
          (ambientSourceNode as any)?.stop?.();
          ambientSourceNode?.disconnect();
          ambientSourceNode = null;
          ambientGainNode = null;
        } catch {}
      }, 250);
    }
  } catch {}
}

export function startAmbientSound(sound: AmbientSound, volume: number = 0.25): void {
  stopAmbientSound();
  if (sound === 'none') return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(Math.max(0.01, Math.min(1, volume)), ctx.currentTime + 0.3);
    gain.connect(ctx.destination);
    ambientGainNode = gain;

    if (sound === 'alpha') {
      // 10Hz Alpha wave focus beat (216Hz + 226Hz)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(216, ctx.currentTime);
      osc2.frequency.setValueAtTime(226, ctx.currentTime);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.35, ctx.currentTime);
      osc1.connect(subGain);
      osc2.connect(subGain);
      subGain.connect(gain);

      osc1.start();
      osc2.start();
      ambientSourceNode = osc1;
      return;
    }

    // Procedural noise buffer (Rain / White noise)
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (sound === 'rain') {
        data[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      } else {
        data[i] = white * 0.15;
      }
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    if (sound === 'rain') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, ctx.currentTime);
      noise.connect(filter);
      filter.connect(gain);
    } else {
      noise.connect(gain);
    }

    noise.start();
    ambientSourceNode = noise;
  } catch (e) {
    console.warn('Ambient sound failed:', e);
  }
}
