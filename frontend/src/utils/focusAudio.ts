/**
 * Regenerated Focus Module Web Audio Synthesis Engine
 * Pure procedural stereo synthesis: zero external audio assets, zero latency, offline-ready.
 */

import {
  getAudioContext,
  getSoundProfile,
  getSoundVolume,
  isSoundPlaybackEnabled,
  type SoundProfile,
} from './audioCore.ts';

export type FocusSoundMode = 'focus' | 'shortBreak' | 'longBreak';

export type AmbientSound =
  | 'none'
  | 'stream'
  | 'rain'
  | 'forest'
  | 'fireplace'
  | 'alpha'
  | 'whitenoise';

export interface AmbientSoundMeta {
  id: AmbientSound;
  name: string;
  hint: string;
}

export const AMBIENT_SOUND_OPTIONS: AmbientSoundMeta[] = [
  { id: 'none', name: '静音', hint: '静默无声，纯粹专注' },
  { id: 'stream', name: '幽谷溪泉', hint: '立体山涧流泉、清冽水泡涟漪' },
  { id: 'rain', name: '舒缓雨声', hint: '广域暮雨绵密、檐滴轻叩微响' },
  { id: 'forest', name: '松风林籁', hint: '林海松涛巡游、远林清风呼吸' },
  { id: 'fireplace', name: '围炉夜话', hint: '暖炉低焰微燃、松木噼啪余温' },
  { id: 'alpha', name: 'Alpha 波', hint: '双耳 10Hz 谐振、温润泛音冥想铺底' },
  { id: 'whitenoise', name: '柔白噪声', hint: '双声道粉白柔滤、隔绝外界杂音' },
];

// ---------------------------------------------------------------------------
// Low-level DSP & Routing Helpers
// ---------------------------------------------------------------------------

function safeFreq(ctx: AudioContext, freq: number): number {
  const maxSafe = Math.max(1000, Math.min(20000, ctx.sampleRate * 0.45));
  return Math.max(20, Math.min(maxSafe, freq));
}

function safeGain(v: number): number {
  return Math.max(0.0001, v);
}

function connectPanned(
  ctx: AudioContext,
  source: AudioNode,
  dest: AudioNode,
  pan: number,
): AudioNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime);
    source.connect(panner);
    panner.connect(dest);
    return panner;
  }
  source.connect(dest);
  return source;
}

let cachedBurstBuffer: { ctx: AudioContext; buffer: AudioBuffer } | null = null;

/** Returns a tiny stereo white-noise buffer used for mallet strikes, ticks, drops & crackles. */
function getBurstNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedBurstBuffer && cachedBurstBuffer.ctx === ctx) {
    return cachedBurstBuffer.buffer;
  }
  const length = Math.max(256, Math.floor(ctx.sampleRate * 0.16));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  cachedBurstBuffer = { ctx, buffer };
  return buffer;
}

/** Creates a soft-limited bus so rich multi-voice chimes never clip. */
function createFocusChimeBus(ctx: AudioContext, gainLevel: number): AudioNode {
  const master = ctx.createGain();
  master.gain.setValueAtTime(Math.max(0.01, Math.min(1.2, gainLevel)), ctx.currentTime);
  if (typeof ctx.createDynamicsCompressor === 'function') {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-14, ctx.currentTime);
    comp.knee.setValueAtTime(16, ctx.currentTime);
    comp.ratio.setValueAtTime(3.5, ctx.currentTime);
    comp.attack.setValueAtTime(0.004, ctx.currentTime);
    comp.release.setValueAtTime(0.18, ctx.currentTime);
    master.connect(comp);
    comp.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }
  return master;
}

interface HarmonicPartial {
  ratio: number;
  weight: number;
  decayScale?: number;
  type?: OscillatorType;
  detuneHz?: number;
}

interface HarmonicToneOptions {
  startTime: number;
  freq: number;
  endFreq?: number;
  glideTime?: number;
  gain: number;
  attack?: number;
  decay: number;
  pan?: number;
  type?: OscillatorType;
  lowpassStart?: number;
  lowpassEnd?: number;
  partials?: HarmonicPartial[];
}

function playHarmonicTone(ctx: AudioContext, dest: AudioNode, opts: HarmonicToneOptions): void {
  const {
    startTime,
    freq,
    endFreq,
    glideTime = 0.08,
    gain: peakGain,
    attack = 0.012,
    decay,
    pan = 0,
    type = 'sine',
    lowpassStart,
    lowpassEnd,
    partials = [{ ratio: 1, weight: 1 }],
  } = opts;

  const voiceGain = ctx.createGain();
  const maxHold = partials.reduce((m, p) => Math.max(m, decay * (p.decayScale ?? 1)), decay);

  let targetOut: AudioNode = voiceGain;
  if (lowpassStart && lowpassEnd) {
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.Q.setValueAtTime(0.7, startTime);
    lpf.frequency.setValueAtTime(safeFreq(ctx, lowpassStart), startTime);
    lpf.frequency.exponentialRampToValueAtTime(safeFreq(ctx, lowpassEnd), startTime + Math.max(0.05, maxHold * 0.85));
    voiceGain.connect(lpf);
    targetOut = lpf;
  }
  connectPanned(ctx, targetOut, dest, pan);

  voiceGain.gain.setValueAtTime(0.0001, startTime);
  voiceGain.gain.linearRampToValueAtTime(safeGain(peakGain), startTime + attack);
  voiceGain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);

  for (const p of partials) {
    const osc = ctx.createOscillator();
    const pGain = ctx.createGain();
    const pDecay = decay * (p.decayScale ?? 1);
    const f0 = freq * p.ratio + (p.detuneHz ?? 0);

    osc.type = p.type ?? type;
    osc.frequency.setValueAtTime(Math.max(20, f0), startTime);
    if (endFreq && endFreq > 0) {
      const f1 = endFreq * p.ratio + (p.detuneHz ?? 0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), startTime + glideTime);
    }

    pGain.gain.setValueAtTime(safeGain(p.weight), startTime);
    if (p.decayScale && p.decayScale < 1) {
      pGain.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + pDecay);
    }

    osc.connect(pGain);
    pGain.connect(voiceGain);
    osc.start(startTime);
    osc.stop(startTime + attack + maxHold + 0.06);
  }
}

interface FilteredBurstOptions {
  startTime: number;
  freq: number;
  q?: number;
  gain: number;
  attack?: number;
  decay: number;
  pan?: number;
  filterType?: BiquadFilterType;
}

function playFilteredBurst(ctx: AudioContext, dest: AudioNode, opts: FilteredBurstOptions): void {
  const {
    startTime,
    freq,
    q = 2.4,
    gain: peakGain,
    attack = 0.0015,
    decay,
    pan = 0,
    filterType = 'bandpass',
  } = opts;

  const src = ctx.createBufferSource();
  src.buffer = getBurstNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(safeFreq(ctx, freq), startTime);
  filter.Q.setValueAtTime(Math.max(0.3, q), startTime);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, startTime);
  env.gain.linearRampToValueAtTime(safeGain(peakGain), startTime + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);

  src.connect(filter);
  filter.connect(env);
  connectPanned(ctx, env, dest, pan);

  const offset = Math.random() * 0.08;
  const dur = Math.min(0.14, attack + decay + 0.015);
  src.start(startTime, offset, dur);
}

// ---------------------------------------------------------------------------
// Focus Lifecycle & Interaction Cues
// ---------------------------------------------------------------------------

/** Plays a warm, grounded harmonic chime when entering a focus or break phase. */
export function playFocusStartSound(mode: FocusSoundMode = 'focus'): void {
  if (!isSoundPlaybackEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const vol = Math.min(0.34, Math.max(0.1, getSoundVolume() * 0.72));
    const bus = createFocusChimeBus(ctx, 1);

    if (mode === 'focus') {
      // Grounded ascending pentatonic bloom (D4 -> A4) with soft felt mallet strike
      playFilteredBurst(ctx, bus, {
        startTime: now,
        freq: 1350,
        q: 1.6,
        gain: vol * 0.14,
        attack: 0.002,
        decay: 0.018,
        pan: -0.14,
      });
      playHarmonicTone(ctx, bus, {
        startTime: now,
        freq: 293.66, // D4
        gain: vol * 0.42,
        attack: 0.014,
        decay: 0.55,
        pan: -0.18,
        lowpassStart: 2800,
        lowpassEnd: 900,
        partials: [
          { ratio: 1, weight: 0.85 },
          { ratio: 2, weight: 0.28, decayScale: 0.65 },
          { ratio: 3, weight: 0.08, decayScale: 0.4 },
        ],
      });
      playHarmonicTone(ctx, bus, {
        startTime: now + 0.095,
        freq: 440.0, // A4
        gain: vol * 0.46,
        attack: 0.016,
        decay: 0.78,
        pan: 0.18,
        lowpassStart: 3200,
        lowpassEnd: 1050,
        partials: [
          { ratio: 1, weight: 0.85 },
          { ratio: 2, weight: 0.3, decayScale: 0.7 },
          { ratio: 3, weight: 0.09, decayScale: 0.45 },
        ],
      });
      return;
    }

    // Break start: gentle descending exhale interval (A4 -> E4)
    playHarmonicTone(ctx, bus, {
      startTime: now,
      freq: 440.0,
      gain: vol * 0.36,
      attack: 0.018,
      decay: 0.52,
      pan: 0.16,
      partials: [
        { ratio: 1, weight: 0.85 },
        { ratio: 2, weight: 0.2, decayScale: 0.55 },
      ],
    });
    playHarmonicTone(ctx, bus, {
      startTime: now + 0.12,
      freq: 329.63,
      gain: vol * 0.4,
      attack: 0.02,
      decay: 0.72,
      pan: -0.16,
      partials: [
        { ratio: 1, weight: 0.88 },
        { ratio: 2, weight: 0.22, decayScale: 0.6 },
      ],
    });
  } catch {
    // Ignore audio errors in restricted environments.
  }
}

/** Plays a quiet, grounded wood-breath release cue when pausing a focus session. */
export function playFocusPauseSound(): void {
  if (!isSoundPlaybackEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const vol = Math.min(0.2, Math.max(0.06, getSoundVolume() * 0.45));
    const bus = createFocusChimeBus(ctx, 1);

    playFilteredBurst(ctx, bus, {
      startTime: now,
      freq: 620,
      q: 2.2,
      gain: vol * 0.22,
      attack: 0.002,
      decay: 0.028,
      pan: 0,
    });
    playHarmonicTone(ctx, bus, {
      startTime: now,
      freq: 330,
      endFreq: 220,
      glideTime: 0.11,
      gain: vol * 0.42,
      attack: 0.006,
      decay: 0.14,
      type: 'triangle',
      partials: [{ ratio: 1, weight: 1 }],
    });
  } catch {
    // Ignore audio errors.
  }
}

let internalTickCounter = 0;

/**
 * Plays a delicate alternating temple-woodblock / escapement tick-tock
 * designed for sustained focus without ear fatigue.
 */
export function playFocusTickSound(tickIndex?: number): void {
  if (!isSoundPlaybackEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const step = typeof tickIndex === 'number' ? tickIndex : internalTickCounter++;
    const isTick = step % 2 === 0;
    const vol = Math.min(0.11, Math.max(0.025, getSoundVolume() * 0.24));
    const pan = isTick ? -0.07 : 0.07;

    // Hollow wooden body resonance (tuned inharmonic temple-block mode pair)
    const f0 = isTick ? 820 : 695;
    playHarmonicTone(ctx, ctx.destination, {
      startTime: now,
      freq: f0,
      gain: vol * 0.55,
      attack: 0.0018,
      decay: 0.036,
      pan,
      type: 'sine',
      partials: [
        { ratio: 1, weight: 0.85 },
        { ratio: 1.62, weight: 0.32, decayScale: 0.6 },
      ],
    });

    // Crisp mechanical escapement / wood grain transient
    playFilteredBurst(ctx, ctx.destination, {
      startTime: now,
      freq: isTick ? 2350 : 1920,
      q: 3.4,
      gain: vol * 0.36,
      attack: 0.001,
      decay: 0.012,
      pan,
    });
  } catch {
    // Ignore audio errors.
  }
}

/** Plays a soft, non-judgmental mindfulness bell rim tap when logging a distraction. */
export function playFocusDistractionSound(): void {
  if (!isSoundPlaybackEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const vol = Math.min(0.18, Math.max(0.05, getSoundVolume() * 0.4));
    playHarmonicTone(ctx, ctx.destination, {
      startTime: now,
      freq: 528,
      gain: vol * 0.45,
      attack: 0.006,
      decay: 0.38,
      partials: [
        { ratio: 1, weight: 0.85 },
        { ratio: 2.756, weight: 0.14, decayScale: 0.45 },
      ],
    });
  } catch {
    // Ignore audio errors.
  }
}

// ---------------------------------------------------------------------------
// Focus Phase Completion Chimes (Tailored per SoundProfile & Phase)
// ---------------------------------------------------------------------------

function playCrystalCompletion(ctx: AudioContext, bus: AudioNode, now: number, vol: number, isFocus: boolean): void {
  const notes = isFocus ? [659.25, 830.61, 987.77, 1479.98] : [493.88, 659.25, 830.61];
  const pans = isFocus ? [-0.28, -0.1, 0.1, 0.28] : [-0.2, 0, 0.2];
  notes.forEach((freq, idx) => {
    const t = now + idx * (isFocus ? 0.095 : 0.085);
    playFilteredBurst(ctx, bus, {
      startTime: t,
      freq: freq * 2.2,
      q: 2.0,
      gain: vol * 0.07,
      decay: 0.014,
      pan: pans[idx] ?? 0,
    });
    playHarmonicTone(ctx, bus, {
      startTime: t,
      freq,
      gain: (vol * 0.48) / (1 + idx * 0.14),
      attack: 0.01,
      decay: isFocus ? 1.55 + idx * 0.18 : 1.05,
      pan: pans[idx] ?? 0,
      lowpassStart: 5600,
      lowpassEnd: 1600,
      partials: [
        { ratio: 1, weight: 0.85 },
        { ratio: 2, weight: 0.28, decayScale: 0.7 },
        { ratio: 3, weight: 0.1, decayScale: 0.45 },
      ],
    });
  });
}

function playZenCompletion(ctx: AudioContext, bus: AudioNode, now: number, vol: number, isFocus: boolean): void {
  // Authentic singing bowl with beating pair + inharmonic rim modes (2.756x, 5.404x)
  const base = isFocus ? 220.0 : 392.0;
  const decay = isFocus ? 3.2 : 1.9;

  playFilteredBurst(ctx, bus, {
    startTime: now,
    freq: base * 3.1,
    q: 1.5,
    gain: vol * 0.12,
    attack: 0.005,
    decay: 0.035,
    pan: 0,
  });
  playHarmonicTone(ctx, bus, {
    startTime: now,
    freq: base,
    gain: vol * 0.45,
    attack: 0.03,
    decay,
    pan: -0.22,
    partials: [
      { ratio: 1, weight: 0.9 },
      { ratio: 2.756, weight: 0.24, decayScale: 0.58 },
      { ratio: 5.404, weight: 0.08, decayScale: 0.3 },
    ],
  });
  playHarmonicTone(ctx, bus, {
    startTime: now,
    freq: base + (isFocus ? 1.6 : 1.3),
    gain: vol * 0.38,
    attack: 0.034,
    decay: decay * 0.96,
    pan: 0.22,
    partials: [
      { ratio: 1, weight: 0.85 },
      { ratio: 2.756, weight: 0.18, decayScale: 0.55 },
    ],
  });
}

function playGuqinCompletion(ctx: AudioContext, bus: AudioNode, now: number, vol: number, isFocus: boolean): void {
  // Expressive Guqin pentatonic phrase with plucked string attack & tonic micro-slide
  const phrase = isFocus
    ? [
        { freq: 293.66, t: 0, pan: -0.25 },
        { freq: 329.63, t: 0.13, pan: -0.12 },
        { freq: 392.0, t: 0.26, pan: 0.02 },
        { freq: 440.0, t: 0.4, pan: 0.15 },
        { freq: 587.33, startGlideFrom: 523.25, t: 0.56, pan: 0.26 },
      ]
    : [
        { freq: 392.0, t: 0, pan: -0.18 },
        { freq: 440.0, t: 0.13, pan: 0.0 },
        { freq: 587.33, t: 0.27, pan: 0.2 },
      ];

  phrase.forEach((n, idx) => {
    const start = now + n.t;
    const isLast = idx === phrase.length - 1;
    playFilteredBurst(ctx, bus, {
      startTime: start,
      freq: n.freq * 2.6,
      q: 2.5,
      gain: vol * 0.11,
      decay: 0.015,
      pan: n.pan,
    });
    playHarmonicTone(ctx, bus, {
      startTime: start,
      freq: n.startGlideFrom ?? n.freq,
      endFreq: n.startGlideFrom ? n.freq : undefined,
      glideTime: 0.14,
      gain: vol * (isLast ? 0.52 : 0.36),
      attack: 0.01,
      decay: isLast ? 2.2 : 1.1,
      pan: n.pan,
      type: 'triangle',
      lowpassStart: 2600,
      lowpassEnd: 680,
      partials: [
        { ratio: 1, weight: 0.88, type: 'triangle' },
        { ratio: 2, weight: 0.34, decayScale: 0.72, type: 'sine' },
        { ratio: 3, weight: 0.12, decayScale: 0.45, type: 'sine' },
      ],
    });
  });
}

function playQingCompletion(ctx: AudioContext, bus: AudioNode, now: number, vol: number, isFocus: boolean): void {
  // Mountain temple jade chime (玉磬): pure fundamental + fifth + shimmering octave partials
  const strikes = isFocus ? [392.0, 587.33] : [587.33, 784.0];
  strikes.forEach((freq, idx) => {
    const t = now + idx * 0.24;
    playFilteredBurst(ctx, bus, {
      startTime: t,
      freq: freq * 3.0,
      q: 2.2,
      gain: vol * 0.09,
      decay: 0.018,
      pan: idx === 0 ? -0.16 : 0.16,
    });
    playHarmonicTone(ctx, bus, {
      startTime: t,
      freq,
      gain: vol * (idx === 0 ? 0.5 : 0.4),
      attack: 0.012,
      decay: isFocus ? 2.7 : 1.7,
      pan: idx === 0 ? -0.16 : 0.16,
      partials: [
        { ratio: 1, weight: 0.9 },
        { ratio: 1.498, weight: 0.22, decayScale: 0.65 },
        { ratio: 2, weight: 0.26, decayScale: 0.7 },
        { ratio: 3, weight: 0.11, decayScale: 0.45 },
      ],
    });
  });
}

function playDropletCompletion(ctx: AudioContext, bus: AudioNode, now: number, vol: number, isFocus: boolean): void {
  // Cascading mountain spring bubble chimes + subtle water pad
  const drops = isFocus
    ? [
        { f0: 587.33, f1: 1046.5, t: 0, pan: -0.35 },
        { f0: 783.99, f1: 1396.91, t: 0.13, pan: 0.3 },
        { f0: 987.77, f1: 1760.0, t: 0.25, pan: -0.15 },
        { f0: 1174.66, f1: 2093.0, t: 0.37, pan: 0.18 },
      ]
    : [
        { f0: 659.25, f1: 1174.66, t: 0, pan: -0.22 },
        { f0: 880.0, f1: 1567.98, t: 0.14, pan: 0.22 },
      ];

  playHarmonicTone(ctx, bus, {
    startTime: now,
    freq: isFocus ? 293.66 : 329.63,
    gain: vol * 0.22,
    attack: 0.04,
    decay: isFocus ? 1.5 : 0.95,
    partials: [
      { ratio: 1, weight: 0.85 },
      { ratio: 2, weight: 0.2, decayScale: 0.6 },
    ],
  });

  drops.forEach((d, idx) => {
    playHarmonicTone(ctx, bus, {
      startTime: now + d.t,
      freq: d.f0,
      endFreq: d.f1,
      glideTime: 0.065,
      gain: vol * (0.38 - idx * 0.04),
      attack: 0.004,
      decay: 0.26,
      pan: d.pan,
      partials: [{ ratio: 1, weight: 1 }],
    });
  });
}

function playCyberCompletion(ctx: AudioContext, bus: AudioNode, now: number, vol: number, isFocus: boolean): void {
  // Warm analog poly-synth resolution (filtered detuned saw/triangle, no harsh buzz)
  const notes = isFocus ? [220.0, 329.63, 493.88, 554.37] : [329.63, 440.0, 493.88];
  notes.forEach((freq, idx) => {
    const t = now + idx * 0.075;
    playHarmonicTone(ctx, bus, {
      startTime: t,
      freq,
      gain: vol * 0.26,
      attack: 0.018,
      decay: isFocus ? 1.35 : 0.85,
      pan: (idx - (notes.length - 1) / 2) * 0.22,
      type: 'sawtooth',
      lowpassStart: 2800,
      lowpassEnd: 460,
      partials: [
        { ratio: 1, weight: 0.65, detuneHz: -1.4 },
        { ratio: 1, weight: 0.65, detuneHz: 1.4 },
        { ratio: 2, weight: 0.22, decayScale: 0.6, type: 'triangle' },
      ],
    });
  });
}

/** Plays a rich, profile-matched completion chime for focus or break phases. */
export function playFocusCompleteChime(mode: FocusSoundMode = 'focus'): void {
  if (!isSoundPlaybackEnabled()) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const rawVol = Math.max(0.18, getSoundVolume());
    const vol = mode === 'focus' ? rawVol : Math.max(0.14, rawVol * 0.84);
    const profile: SoundProfile = getSoundProfile();
    const isFocus = mode === 'focus';
    const bus = createFocusChimeBus(ctx, 1);

    if (profile === 'zen') {
      playZenCompletion(ctx, bus, now, vol, isFocus);
    } else if (profile === 'guqin') {
      playGuqinCompletion(ctx, bus, now, vol, isFocus);
    } else if (profile === 'qing') {
      playQingCompletion(ctx, bus, now, vol, isFocus);
    } else if (profile === 'droplet') {
      playDropletCompletion(ctx, bus, now, vol, isFocus);
    } else if (profile === 'cyber') {
      playCyberCompletion(ctx, bus, now, vol, isFocus);
    } else {
      playCrystalCompletion(ctx, bus, now, vol, isFocus);
    }
  } catch {
    // Ignore audio errors in restricted environments.
  }
}

// ---------------------------------------------------------------------------
// Stereo Procedural Ambient Soundscape Engine
// ---------------------------------------------------------------------------

type NoiseFlavor = 'pink' | 'brown' | 'rain' | 'stream';

const AMBIENT_BUFFER_LRU_LIMIT = 3;
const ambientBufferCache = new Map<string, AudioBuffer>();

function getOrCreateSeamlessStereoBuffer(ctx: AudioContext, flavor: NoiseFlavor): AudioBuffer {
  const key = `${ctx.sampleRate}:${flavor}`;
  const existing = ambientBufferCache.get(key);
  if (existing) {
    // Refresh LRU position
    ambientBufferCache.delete(key);
    ambientBufferCache.set(key, existing);
    return existing;
  }

  const durationSec = 10;
  const sr = ctx.sampleRate;
  const totalSamples = Math.floor(sr * durationSec);
  const fadeSamples = Math.floor(sr * 0.8); // 800ms equal-power seamless loop overlap
  const rawSamples = totalSamples + fadeSamples;
  const buffer = ctx.createBuffer(2, totalSamples, sr);

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    const raw = new Float32Array(rawSamples);

    // Independent per-channel PRNG & filter states for wide natural stereo decorrelation
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    let brown = 0;
    let lp = 0;

    for (let i = 0; i < rawSamples; i++) {
      const white = Math.random() * 2 - 1;
      // Paul Kellet's refined 7-stage Voss-McCartney pink noise approximation
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.048;
      b6 = white * 0.115926;

      if (flavor === 'brown') {
        brown = (brown + 0.02 * white) / 1.02;
        raw[i] = Math.max(-0.95, Math.min(0.95, brown * 2.6 + pink * 0.12));
      } else if (flavor === 'stream') {
        brown = (brown + 0.036 * white) / 1.036;
        lp = lp * 0.84 + pink * 0.16;
        raw[i] = Math.max(-0.95, Math.min(0.95, brown * 1.45 + lp * 0.9 + pink * 0.32));
      } else if (flavor === 'rain') {
        brown = (brown + 0.018 * white) / 1.018;
        raw[i] = Math.max(-0.95, Math.min(0.95, pink * 0.82 + brown * 0.55));
      } else {
        // Silky pink-tinted white noise
        raw[i] = Math.max(-0.95, Math.min(0.95, pink * 0.9 + white * 0.045));
      }
    }

    // Equal-power crossfade tail into head so loop boundary has zero discontinuity
    for (let i = 0; i < totalSamples; i++) {
      if (i < fadeSamples) {
        const t = i / fadeSamples;
        const fadeIn = Math.sin(t * Math.PI * 0.5);
        const fadeOut = Math.cos(t * Math.PI * 0.5);
        out[i] = raw[i] * fadeIn + raw[totalSamples + i] * fadeOut;
      } else {
        out[i] = raw[i];
      }
    }
  }

  ambientBufferCache.set(key, buffer);
  if (ambientBufferCache.size > AMBIENT_BUFFER_LRU_LIMIT) {
    const oldestKey = ambientBufferCache.keys().next().value;
    if (oldestKey !== undefined) {
      ambientBufferCache.delete(oldestKey);
    }
  }
  return buffer;
}

function createStereoLoopSource(ctx: AudioContext, flavor: NoiseFlavor, playbackRate = 1): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = getOrCreateSeamlessStereoBuffer(ctx, flavor);
  src.loop = true;
  if (playbackRate !== 1) {
    src.playbackRate.setValueAtTime(playbackRate, ctx.currentTime);
  }
  return src;
}

function attachLfo(
  ctx: AudioContext,
  tracked: AudioNode[],
  freqHz: number,
  depth: number,
  param: AudioParam,
): void {
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(freqHz, ctx.currentTime);
  lfoGain.gain.setValueAtTime(depth, ctx.currentTime);
  lfo.connect(lfoGain);
  lfoGain.connect(param);
  lfo.start();
  tracked.push(lfo, lfoGain);
}

let ambientActiveNodes: AudioNode[] = [];
let ambientGainNode: GainNode | null = null;
let ambientStopTimer: ReturnType<typeof setTimeout> | null = null;
let ambientPreviewTimer: ReturnType<typeof setTimeout> | null = null;
let ambientSchedulerTimer: ReturnType<typeof setInterval> | null = null;
let currentAmbientKind: AmbientSound = 'none';
let ambientIsPreview = false;
let ambientSessionToken = 0;

function cleanupAmbientNodesNow(nodes: AudioNode[], gainNode: GainNode | null): void {
  for (const node of nodes) {
    try {
      (node as unknown as { stop?: () => void }).stop?.();
      node.disconnect();
    } catch {
      // Ignore already-stopped nodes.
    }
  }
  try {
    gainNode?.disconnect();
  } catch {
    // Ignore disconnect errors.
  }
}

function clearAmbientTimers(): void {
  if (ambientStopTimer) {
    clearTimeout(ambientStopTimer);
    ambientStopTimer = null;
  }
  if (ambientPreviewTimer) {
    clearTimeout(ambientPreviewTimer);
    ambientPreviewTimer = null;
  }
  if (ambientSchedulerTimer) {
    clearInterval(ambientSchedulerTimer);
    ambientSchedulerTimer = null;
  }
}

export function stopAmbientSound(): void {
  ambientSessionToken += 1;
  clearAmbientTimers();

  const staleNodes = ambientActiveNodes;
  const staleGain = ambientGainNode;
  ambientActiveNodes = [];
  ambientGainNode = null;
  currentAmbientKind = 'none';
  ambientIsPreview = false;

  if (staleNodes.length === 0 && !staleGain) return;

  try {
    const ctx = getAudioContext();
    if (staleGain && ctx) {
      const now = ctx.currentTime;
      staleGain.gain.cancelScheduledValues(now);
      staleGain.gain.setValueAtTime(Math.max(0.0001, staleGain.gain.value), now);
      staleGain.gain.linearRampToValueAtTime(0.0001, now + 0.2);
    }
    ambientStopTimer = setTimeout(() => {
      ambientStopTimer = null;
      cleanupAmbientNodesNow(staleNodes, staleGain);
    }, 230);
  } catch {
    cleanupAmbientNodesNow(staleNodes, staleGain);
  }
}

/** Stops ambient playback only if it is an idle audition preview (never interrupts running timer). */
export function stopAmbientPreviewIfIdle(): void {
  if (ambientIsPreview) {
    stopAmbientSound();
  }
}

export function isAmbientPreviewActive(): boolean {
  return ambientIsPreview;
}

/** Smoothly adjusts ambient volume while playing without restarting soundscape graphs. */
export function setAmbientVolume(volume: number): void {
  const clamped = Math.max(0.01, Math.min(1, Number.isFinite(volume) ? volume : 0.25));
  if (!ambientGainNode) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    ambientGainNode.gain.cancelScheduledValues(now);
    ambientGainNode.gain.setTargetAtTime(clamped, now, 0.08);
  } catch {
    // Ignore audio ramping errors.
  }
}

export function getActiveAmbientSound(): AmbientSound {
  return currentAmbientKind;
}

function buildStreamSoundscape(ctx: AudioContext, masterGain: GainNode, tracked: AudioNode[], sessionToken: number): void {
  const now = ctx.currentTime;

  // Layer 1: Warm riverbed sub-current
  const bedSrc = createStereoLoopSource(ctx, 'brown');
  const bedLpf = ctx.createBiquadFilter();
  bedLpf.type = 'lowpass';
  bedLpf.frequency.setValueAtTime(safeFreq(ctx, 290), now);
  const bedGain = ctx.createGain();
  bedGain.gain.setValueAtTime(0.42, now);
  bedSrc.connect(bedLpf);
  bedLpf.connect(bedGain);
  bedGain.connect(masterGain);
  bedSrc.start();
  tracked.push(bedSrc, bedLpf, bedGain);

  // Layer 2: Dual staggered flowing water currents with organic LFO filter sweeps
  const bandFreqs = [540, 1080];
  const lfoRates = [0.11, 0.17];
  bandFreqs.forEach((center, idx) => {
    const src = createStereoLoopSource(ctx, 'stream', idx === 0 ? 1 : 0.93);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(safeFreq(ctx, center), now);
    bpf.Q.setValueAtTime(0.85, now);
    const g = ctx.createGain();
    g.gain.setValueAtTime(idx === 0 ? 0.55 : 0.3, now);

    attachLfo(ctx, tracked, lfoRates[idx], idx === 0 ? 170 : 280, bpf.frequency);
    attachLfo(ctx, tracked, lfoRates[idx] * 0.63, idx === 0 ? 0.1 : 0.07, g.gain);

    src.connect(bpf);
    bpf.connect(g);
    g.connect(masterGain);
    src.start();
    tracked.push(src, bpf, g);
  });

  // Layer 3: Real-time stochastic water droplets & rising bubble plinks
  ambientSchedulerTimer = setInterval(() => {
    if (sessionToken !== ambientSessionToken) return;
    if (Math.random() > 0.45) return;
    const t = ctx.currentTime + Math.random() * 0.08;
    const f0 = 460 + Math.random() * 780;
    const pan = Math.random() * 1.6 - 0.8;
    const amp = 0.025 + Math.random() * 0.045;
    playHarmonicTone(ctx, masterGain, {
      startTime: t,
      freq: f0,
      endFreq: f0 * (1.55 + Math.random() * 0.45),
      glideTime: 0.035 + Math.random() * 0.03,
      gain: amp,
      attack: 0.003,
      decay: 0.055 + Math.random() * 0.04,
      pan,
      partials: [{ ratio: 1, weight: 1 }],
    });
    if (Math.random() < 0.3) {
      // Soft ripple echo
      playHarmonicTone(ctx, masterGain, {
        startTime: t + 0.085,
        freq: f0 * 1.12,
        endFreq: f0 * 1.85,
        glideTime: 0.04,
        gain: amp * 0.35,
        attack: 0.004,
        decay: 0.05,
        pan: -pan * 0.5,
        partials: [{ ratio: 1, weight: 1 }],
      });
    }
  }, 115);
}

function buildRainSoundscape(ctx: AudioContext, masterGain: GainNode, tracked: AudioNode[], sessionToken: number): void {
  const now = ctx.currentTime;

  // Layer 1: Wide stereo steady rain sheet
  const rainSrc = createStereoLoopSource(ctx, 'rain');
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.setValueAtTime(safeFreq(ctx, 170), now);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(safeFreq(ctx, 2700), now);
  const rainGain = ctx.createGain();
  rainGain.gain.setValueAtTime(0.62, now);
  attachLfo(ctx, tracked, 0.055, 0.09, rainGain.gain);
  attachLfo(ctx, tracked, 0.041, 320, lpf.frequency);

  rainSrc.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(rainGain);
  rainGain.connect(masterGain);
  rainSrc.start();
  tracked.push(rainSrc, hpf, lpf, rainGain);

  // Layer 2: Warm distant eaves / sheltered roof body
  const warmSrc = createStereoLoopSource(ctx, 'brown', 0.89);
  const warmLpf = ctx.createBiquadFilter();
  warmLpf.type = 'lowpass';
  warmLpf.frequency.setValueAtTime(safeFreq(ctx, 360), now);
  const warmGain = ctx.createGain();
  warmGain.gain.setValueAtTime(0.36, now);
  warmSrc.connect(warmLpf);
  warmLpf.connect(warmGain);
  warmGain.connect(masterGain);
  warmSrc.start();
  tracked.push(warmSrc, warmLpf, warmGain);

  // Layer 3: Stochastic stereo raindrop patters on leaves & roof
  ambientSchedulerTimer = setInterval(() => {
    if (sessionToken !== ambientSessionToken) return;
    const count = Math.random() < 0.68 ? (Math.random() < 0.3 ? 2 : 1) : 0;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + Math.random() * 0.085;
      playFilteredBurst(ctx, masterGain, {
        startTime: t,
        freq: 1300 + Math.random() * 2900,
        q: 2.0 + Math.random() * 2.2,
        gain: 0.045 + Math.random() * 0.08,
        attack: 0.001,
        decay: 0.012 + Math.random() * 0.014,
        pan: Math.random() * 1.8 - 0.9,
      });
    }
  }, 90);
}

function buildForestSoundscape(ctx: AudioContext, masterGain: GainNode, tracked: AudioNode[], sessionToken: number): void {
  const now = ctx.currentTime;

  // Layer 1: Deep forest air floor
  const floorSrc = createStereoLoopSource(ctx, 'brown');
  const floorLpf = ctx.createBiquadFilter();
  floorLpf.type = 'lowpass';
  floorLpf.frequency.setValueAtTime(safeFreq(ctx, 310), now);
  const floorGain = ctx.createGain();
  floorGain.gain.setValueAtTime(0.3, now);
  floorSrc.connect(floorLpf);
  floorLpf.connect(floorGain);
  floorGain.connect(masterGain);
  floorSrc.start();
  tracked.push(floorSrc, floorLpf, floorGain);

  // Layer 2: Stereo sweeping pine wind gusts (left & right independent swells)
  const windConfigs = [
    { pan: -0.45, baseFreq: 380, lfoFreq: 0.053, rate: 1.0 },
    { pan: 0.45, baseFreq: 460, lfoFreq: 0.071, rate: 0.94 },
  ];
  windConfigs.forEach((cfg) => {
    const src = createStereoLoopSource(ctx, 'pink', cfg.rate);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(safeFreq(ctx, cfg.baseFreq), now);
    bpf.Q.setValueAtTime(1.25, now);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45, now);

    attachLfo(ctx, tracked, cfg.lfoFreq, 190, bpf.frequency);
    attachLfo(ctx, tracked, cfg.lfoFreq * 0.85, 0.22, g.gain);

    src.connect(bpf);
    bpf.connect(g);
    connectPanned(ctx, g, masterGain, cfg.pan);
    src.start();
    tracked.push(src, bpf, g);
  });

  // Layer 3: High-canopy leaf rustle shimmer
  const leafSrc = createStereoLoopSource(ctx, 'pink', 1.07);
  const leafBpf = ctx.createBiquadFilter();
  leafBpf.type = 'bandpass';
  leafBpf.frequency.setValueAtTime(safeFreq(ctx, 2350), now);
  leafBpf.Q.setValueAtTime(0.75, now);
  const leafGain = ctx.createGain();
  leafGain.gain.setValueAtTime(0.12, now);
  attachLfo(ctx, tracked, 0.083, 0.08, leafGain.gain);
  leafSrc.connect(leafBpf);
  leafBpf.connect(leafGain);
  leafGain.connect(masterGain);
  leafSrc.start();
  tracked.push(leafSrc, leafBpf, leafGain);

  // Layer 4: Sparse, soft distant woodland bird calls (lowpassed so never intrusive)
  ambientSchedulerTimer = setInterval(() => {
    if (sessionToken !== ambientSessionToken) return;
    if (Math.random() > 0.11) return;
    const base = 1650 + Math.random() * 650;
    const pan = (Math.random() > 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.5);
    const t0 = ctx.currentTime + 0.05;
    const notes = Math.random() > 0.45 ? 2 : 3;
    for (let n = 0; n < notes; n++) {
      const f = base * (n % 2 === 0 ? 1 : 1.18 + Math.random() * 0.12);
      playHarmonicTone(ctx, masterGain, {
        startTime: t0 + n * 0.14,
        freq: f,
        endFreq: f * (n % 2 === 0 ? 1.14 : 0.92),
        glideTime: 0.075,
        gain: 0.022 + Math.random() * 0.015,
        attack: 0.014,
        decay: 0.085,
        pan,
        lowpassStart: 2400,
        lowpassEnd: 1800,
        partials: [{ ratio: 1, weight: 1 }],
      });
    }
  }, 600);
}

function buildFireplaceSoundscape(ctx: AudioContext, masterGain: GainNode, tracked: AudioNode[], sessionToken: number): void {
  const now = ctx.currentTime;

  // Layer 1: Warm hearth flame rumble with irregular dual-LFO flicker
  const rumbleSrc = createStereoLoopSource(ctx, 'brown');
  const rumbleLpf = ctx.createBiquadFilter();
  rumbleLpf.type = 'lowpass';
  rumbleLpf.frequency.setValueAtTime(safeFreq(ctx, 185), now);
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0.65, now);
  attachLfo(ctx, tracked, 0.37, 0.11, rumbleGain.gain);
  attachLfo(ctx, tracked, 0.61, 0.08, rumbleGain.gain);
  rumbleSrc.connect(rumbleLpf);
  rumbleLpf.connect(rumbleGain);
  rumbleGain.connect(masterGain);
  rumbleSrc.start();
  tracked.push(rumbleSrc, rumbleLpf, rumbleGain);

  // Layer 2: Soft glowing flame draft
  const draftSrc = createStereoLoopSource(ctx, 'pink', 0.91);
  const draftBpf = ctx.createBiquadFilter();
  draftBpf.type = 'bandpass';
  draftBpf.frequency.setValueAtTime(safeFreq(ctx, 430), now);
  draftBpf.Q.setValueAtTime(0.85, now);
  const draftGain = ctx.createGain();
  draftGain.gain.setValueAtTime(0.24, now);
  attachLfo(ctx, tracked, 0.23, 0.07, draftGain.gain);
  draftSrc.connect(draftBpf);
  draftBpf.connect(draftGain);
  draftGain.connect(masterGain);
  draftSrc.start();
  tracked.push(draftSrc, draftBpf, draftGain);

  // Layer 3: Multi-stage pine wood crackles & hollow ember pops
  ambientSchedulerTimer = setInterval(() => {
    if (sessionToken !== ambientSessionToken) return;
    if (Math.random() > 0.38) return;

    const cluster = Math.random() < 0.28 ? 2 : 1;
    for (let c = 0; c < cluster; c++) {
      const t = ctx.currentTime + c * (0.025 + Math.random() * 0.045);
      const pan = Math.random() * 1.4 - 0.7;

      // Crisp dry pine snap
      playFilteredBurst(ctx, masterGain, {
        startTime: t,
        freq: 2100 + Math.random() * 2700,
        q: 2.8 + Math.random() * 2.5,
        gain: 0.06 + Math.random() * 0.14,
        attack: 0.0008,
        decay: 0.008 + Math.random() * 0.012,
        pan,
      });

      // Occasional warm hollow wood pop
      if (Math.random() < 0.35) {
        const popFreq = 260 + Math.random() * 260;
        playHarmonicTone(ctx, masterGain, {
          startTime: t,
          freq: popFreq,
          endFreq: popFreq * 0.55,
          glideTime: 0.024,
          gain: 0.035 + Math.random() * 0.045,
          attack: 0.0015,
          decay: 0.028,
          pan,
          type: 'triangle',
          partials: [{ ratio: 1, weight: 1 }],
        });
      }
    }
  }, 115);
}

function buildAlphaSoundscape(ctx: AudioContext, masterGain: GainNode, tracked: AudioNode[]): void {
  const now = ctx.currentTime;

  // True Stereo Binaural 10Hz Alpha Carrier (174Hz L / 184Hz R) + gentle harmonic cushion
  const leftCarrier = ctx.createOscillator();
  const rightCarrier = ctx.createOscillator();
  const leftOvertone = ctx.createOscillator();
  const rightOvertone = ctx.createOscillator();
  const warmPad = ctx.createOscillator();

  leftCarrier.type = 'sine';
  rightCarrier.type = 'sine';
  leftOvertone.type = 'sine';
  rightOvertone.type = 'sine';
  warmPad.type = 'sine';

  leftCarrier.frequency.setValueAtTime(174.0, now);
  rightCarrier.frequency.setValueAtTime(184.0, now); // +10Hz Alpha beat across ears
  leftOvertone.frequency.setValueAtTime(348.0, now);
  rightOvertone.frequency.setValueAtTime(358.0, now);
  warmPad.frequency.setValueAtTime(116.0, now); // Grounding warm foundation

  const leftGain = ctx.createGain();
  const rightGain = ctx.createGain();
  const leftOvGain = ctx.createGain();
  const rightOvGain = ctx.createGain();
  const padGain = ctx.createGain();

  leftGain.gain.setValueAtTime(0.2, now);
  rightGain.gain.setValueAtTime(0.2, now);
  leftOvGain.gain.setValueAtTime(0.035, now);
  rightOvGain.gain.setValueAtTime(0.035, now);
  padGain.gain.setValueAtTime(0.09, now);

  // Subtle 16-second breathing swell (0.0625 Hz)
  attachLfo(ctx, tracked, 0.0625, 0.025, padGain.gain);

  leftCarrier.connect(leftGain);
  leftOvertone.connect(leftOvGain);
  rightCarrier.connect(rightGain);
  rightOvertone.connect(rightOvGain);
  warmPad.connect(padGain);

  connectPanned(ctx, leftGain, masterGain, -0.88);
  connectPanned(ctx, leftOvGain, masterGain, -0.7);
  connectPanned(ctx, rightGain, masterGain, 0.88);
  connectPanned(ctx, rightOvGain, masterGain, 0.7);
  padGain.connect(masterGain);

  // Silky pink noise air cushion underneath so tones feel organic and plush
  const airSrc = createStereoLoopSource(ctx, 'pink', 0.92);
  const airLpf = ctx.createBiquadFilter();
  airLpf.type = 'lowpass';
  airLpf.frequency.setValueAtTime(safeFreq(ctx, 420), now);
  const airGain = ctx.createGain();
  airGain.gain.setValueAtTime(0.11, now);
  airSrc.connect(airLpf);
  airLpf.connect(airGain);
  airGain.connect(masterGain);

  leftCarrier.start();
  rightCarrier.start();
  leftOvertone.start();
  rightOvertone.start();
  warmPad.start();
  airSrc.start();

  tracked.push(
    leftCarrier,
    rightCarrier,
    leftOvertone,
    rightOvertone,
    warmPad,
    leftGain,
    rightGain,
    leftOvGain,
    rightOvGain,
    padGain,
    airSrc,
    airLpf,
    airGain,
  );
}

function buildWhitenoiseSoundscape(ctx: AudioContext, masterGain: GainNode, tracked: AudioNode[]): void {
  const now = ctx.currentTime;

  // True decorrelated stereo Voss-McCartney pink-tinted acoustic noise diffuser
  const src = createStereoLoopSource(ctx, 'pink');
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.setValueAtTime(safeFreq(ctx, 60), now);

  const warmShelf = ctx.createBiquadFilter();
  warmShelf.type = 'lowshelf';
  warmShelf.frequency.setValueAtTime(safeFreq(ctx, 240), now);
  warmShelf.gain.setValueAtTime(2.5, now);

  const lpf1 = ctx.createBiquadFilter();
  lpf1.type = 'lowpass';
  lpf1.frequency.setValueAtTime(safeFreq(ctx, 3100), now);
  lpf1.Q.setValueAtTime(0.55, now);

  const lpf2 = ctx.createBiquadFilter();
  lpf2.type = 'lowpass';
  lpf2.frequency.setValueAtTime(safeFreq(ctx, 3600), now);
  lpf2.Q.setValueAtTime(0.5, now);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.52, now);
  attachLfo(ctx, tracked, 0.045, 260, lpf1.frequency);

  src.connect(hpf);
  hpf.connect(warmShelf);
  warmShelf.connect(lpf1);
  lpf1.connect(lpf2);
  lpf2.connect(g);
  g.connect(masterGain);
  src.start();

  tracked.push(src, hpf, warmShelf, lpf1, lpf2, g);
}

function launchAmbientInternal(sound: AmbientSound, volume: number, isPreview: boolean, previewDurationMs: number): void {
  stopAmbientSound();
  if (sound === 'none') return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const sessionToken = ++ambientSessionToken;
    const targetVol = Math.max(0.01, Math.min(1, Number.isFinite(volume) ? volume : 0.25));
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(targetVol, ctx.currentTime + 0.45);
    gain.connect(ctx.destination);

    ambientGainNode = gain;
    currentAmbientKind = sound;
    ambientIsPreview = isPreview;

    const tracked: AudioNode[] = [];
    if (sound === 'stream') {
      buildStreamSoundscape(ctx, gain, tracked, sessionToken);
    } else if (sound === 'rain') {
      buildRainSoundscape(ctx, gain, tracked, sessionToken);
    } else if (sound === 'forest') {
      buildForestSoundscape(ctx, gain, tracked, sessionToken);
    } else if (sound === 'fireplace') {
      buildFireplaceSoundscape(ctx, gain, tracked, sessionToken);
    } else if (sound === 'alpha') {
      buildAlphaSoundscape(ctx, gain, tracked);
    } else {
      buildWhitenoiseSoundscape(ctx, gain, tracked);
    }

    ambientActiveNodes = tracked;

    if (isPreview) {
      ambientPreviewTimer = setTimeout(() => {
        if (sessionToken === ambientSessionToken && ambientIsPreview) {
          stopAmbientSound();
        }
      }, Math.max(800, previewDurationMs));
    }
  } catch (e) {
    console.warn('Focus ambient sound failed:', e);
  }
}

/** Starts continuous stereo ambient soundscape playback for an active focus session. */
export function startAmbientSound(sound: AmbientSound, volume: number = 0.25): void {
  launchAmbientInternal(sound, volume, false, 0);
}

/** Plays a short auto-fading audition preview of an ambient soundscape while idle. */
export function previewAmbientSound(
  sound: AmbientSound,
  volume: number = 0.25,
  durationMs: number = 4200,
): void {
  launchAmbientInternal(sound, volume, true, durationMs);
}
