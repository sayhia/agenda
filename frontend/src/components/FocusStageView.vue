<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { FocusPhaseMode, FocusViewForm } from '../utils/focus';
import type { BreathingCue } from '../utils/focus';

const props = withDefaults(
  defineProps<{
    viewForm: FocusViewForm;
    displayClock: string;
    progressPercent: number;
    mode: FocusPhaseMode;
    isRunning: boolean;
    fxEnabled: boolean;
    isSprint?: boolean;
    phaseLabel: string;
    intention?: string;
    zenMode?: boolean;
    breathingCue?: BreathingCue | null;
  }>(),
  {
    isSprint: false,
    intention: '',
    zenMode: false,
    breathingCue: null,
  },
);

const dialRadius = 104;
const dialCircumference = 2 * Math.PI * dialRadius;
const dialOffset = computed(() => dialCircumference * (1 - props.progressPercent / 100));
const dialTipPos = computed(() => {
  const angle = ((props.progressPercent / 100) * 360 - 90) * (Math.PI / 180);
  return {
    x: 130 + dialRadius * Math.cos(angle),
    y: 130 + dialRadius * Math.sin(angle),
  };
});

// 1. Liquid Vessel tidal height & color tokens
const liquidFillPercent = computed(() => 14 + (props.progressPercent / 100) * 80);
const liquidTopOffset = computed(() => 100 - liquidFillPercent.value);
const phasePrimaryToken = computed(() =>
  props.mode === 'shortBreak'
    ? 'var(--success)'
    : props.mode === 'longBreak'
      ? 'var(--warning)'
      : 'var(--tide)',
);
const phaseSecondaryToken = computed(() =>
  props.mode === 'shortBreak'
    ? 'var(--tide)'
    : props.mode === 'longBreak'
      ? 'var(--seal-red, var(--warning))'
      : 'var(--theme-secondary, var(--lime-strong, var(--tide)))',
);

// 2. Hourglass top & bottom sand geometry
const sandRemainingRatio = computed(() => Math.max(0, Math.min(1, 1 - props.progressPercent / 100)));
const sandFallenRatio = computed(() => Math.max(0, Math.min(1, props.progressPercent / 100)));
const topSandY = computed(() => 24 + (1 - sandRemainingRatio.value) * 76);
const bottomSandTopY = computed(() => 196 - sandFallenRatio.value * 66);

// 3. Split-Flap Flip Clock digit array + per-slot change flash
const clockCharacters = computed(() => props.displayClock.split(''));
const flippedIndices = ref<Record<number, boolean>>({});
const flipTimers = new Map<number, ReturnType<typeof setTimeout>>();

watch(
  () => props.displayClock,
  (nextVal, prevVal) => {
    if (!prevVal) return;
    const nextChars = nextVal.split('');
    const prevChars = prevVal.split('');
    nextChars.forEach((ch, idx) => {
      if (ch !== prevChars[idx] && ch !== ':') {
        const existingTimer = flipTimers.get(idx);
        if (existingTimer) clearTimeout(existingTimer);
        flippedIndices.value[idx] = true;
        const timer = setTimeout(() => {
          flippedIndices.value[idx] = false;
          flipTimers.delete(idx);
        }, 320);
        flipTimers.set(idx, timer);
      }
    });
  },
);

onUnmounted(() => {
  for (const timer of flipTimers.values()) clearTimeout(timer);
  flipTimers.clear();
});

// 4. Glassmorphic Blooming Lotus Mandala (12 outer petals + 6 inner crown petals)
const outerLotusPetals = computed(() => {
  const total = 12;
  const pct = Math.max(0, Math.min(100, props.progressPercent));
  return Array.from({ length: total }, (_, idx) => {
    const stepStart = (idx / total) * 100;
    const stepSpan = 100 / total;
    const bloom = Math.max(0, Math.min(1, (pct - stepStart) / stepSpan));
    return {
      index: idx,
      angle: idx * 30,
      bloom,
      scale: 0.72 + bloom * 0.28,
      fillOpacity: 0.14 + bloom * 0.56,
      strokeOpacity: 0.28 + bloom * 0.54,
    };
  });
});

const innerLotusPetals = computed(() => {
  const total = 6;
  const pct = Math.max(0, Math.min(100, props.progressPercent));
  return Array.from({ length: total }, (_, idx) => {
    const stepStart = (idx / total) * 85;
    const bloom = Math.max(0, Math.min(1, (pct - stepStart) / 22));
    return {
      index: idx,
      angle: idx * 60 + 15,
      bloom,
      scale: 0.76 + bloom * 0.24,
      fillOpacity: 0.18 + bloom * 0.58,
    };
  });
});
</script>

<template>
  <!-- FORM 1: Holographic Dial HUD -->
  <div
    v-if="viewForm === 'dial'"
    class="timer-dial-wrap stage-anchor"
    :class="{
      running: isRunning,
      break: mode === 'shortBreak',
      'long-break': mode === 'longBreak',
      'fx-on': fxEnabled,
      'is-sprint': isSprint,
      'is-breathing': Boolean(breathingCue),
    }"
  >
    <div v-if="fxEnabled" class="dial-orbit-ring" aria-hidden="true"></div>
    <div v-if="fxEnabled" class="dial-orbit-ring-inner" aria-hidden="true"></div>
    <div v-if="breathingCue && fxEnabled" class="dial-breath-halo" aria-hidden="true"></div>
    <svg class="timer-svg" width="248" height="248" viewBox="0 0 260 260" aria-hidden="true">
      <defs>
        <linearGradient id="focusArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--tide)" />
          <stop offset="100%" stop-color="var(--theme-secondary, var(--lime-strong, var(--tide)))" />
        </linearGradient>
        <linearGradient id="shortBreakArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--success)" />
          <stop offset="100%" stop-color="var(--tide)" />
        </linearGradient>
        <linearGradient id="longBreakArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--warning)" />
          <stop offset="100%" stop-color="var(--seal-red, var(--theme-secondary, var(--warning)))" />
        </linearGradient>
      </defs>
      <g class="dial-ticks">
        <line
          v-for="tickIndex in 60"
          :key="tickIndex"
          :x1="130 + Math.cos(((tickIndex * 6 - 90) * Math.PI) / 180) * (tickIndex % 5 === 0 ? 117 : 121)"
          :y1="130 + Math.sin(((tickIndex * 6 - 90) * Math.PI) / 180) * (tickIndex % 5 === 0 ? 117 : 121)"
          :x2="130 + Math.cos(((tickIndex * 6 - 90) * Math.PI) / 180) * 126"
          :y2="130 + Math.sin(((tickIndex * 6 - 90) * Math.PI) / 180) * 126"
          :stroke-width="tickIndex % 5 === 0 ? 1.6 : 0.9"
          :opacity="tickIndex * (100 / 60) <= progressPercent ? 0.92 : tickIndex % 5 === 0 ? 0.5 : 0.22"
          :stroke="tickIndex * (100 / 60) <= progressPercent ? phasePrimaryToken : 'currentColor'"
        />
      </g>
      <circle
        class="timer-circle-bg"
        cx="130"
        cy="130"
        :r="dialRadius"
        fill="none"
        stroke="var(--border-strong)"
        stroke-width="8"
      />
      <circle
        class="timer-circle-progress"
        :class="{
          'break-stroke': mode === 'shortBreak',
          'long-break-stroke': mode === 'longBreak',
        }"
        cx="130"
        cy="130"
        :r="dialRadius"
        fill="none"
        :stroke="mode === 'shortBreak' ? 'url(#shortBreakArcGrad)' : mode === 'longBreak' ? 'url(#longBreakArcGrad)' : 'url(#focusArcGrad)'"
        stroke-width="8"
        stroke-linecap="round"
        :stroke-dasharray="dialCircumference"
        :stroke-dashoffset="dialOffset"
        transform="rotate(-90 130 130)"
      />
      <g v-if="fxEnabled && progressPercent > 0">
        <circle
          class="dial-comet-halo"
          :class="{ 'is-break': mode === 'shortBreak', 'is-long-break': mode === 'longBreak' }"
          :cx="dialTipPos.x"
          :cy="dialTipPos.y"
          r="9"
        />
        <circle
          class="dial-comet-core"
          :class="{ 'is-break': mode === 'shortBreak', 'is-long-break': mode === 'longBreak' }"
          :cx="dialTipPos.x"
          :cy="dialTipPos.y"
          r="4"
        />
      </g>
    </svg>

    <div class="timer-center-text">
      <span class="timer-digits tabular-nums">{{ displayClock }}</span>
      <span class="timer-phase">{{ phaseLabel }}</span>
      <span v-if="breathingCue" class="breathing-cue-pill">呼吸引导 · {{ breathingCue.hint }}</span>
      <span v-else-if="zenMode && intention" class="zen-intention-pill">{{ intention }}</span>
    </div>
  </div>

  <!-- FORM 2: Tidal Liquid Zen Vessel -->
  <div
    v-else-if="viewForm === 'liquid'"
    class="liquid-vessel-wrap stage-anchor"
    :class="{ running: isRunning, 'is-sprint': isSprint }"
  >
    <div class="liquid-sphere" :style="{ '--phase-color': phasePrimaryToken, '--phase-sec': phaseSecondaryToken }">
      <div class="liquid-level-box" :style="{ transform: `translateY(${liquidTopOffset}%)` }">
        <svg class="wave-svg wave-back" viewBox="0 0 240 24" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,12 C40,2 80,22 120,12 C160,2 200,22 240,12 L240,24 L0,24 Z" :fill="phaseSecondaryToken" />
        </svg>
        <svg class="wave-svg wave-front" viewBox="0 0 240 24" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,12 C40,22 80,2 120,12 C160,22 200,2 240,12 L240,24 L0,24 Z" :fill="phasePrimaryToken" />
        </svg>
        <div class="liquid-body" :style="{ background: `linear-gradient(180deg, ${phasePrimaryToken}, color-mix(in srgb, ${phaseSecondaryToken} 70%, ${phasePrimaryToken}))` }"></div>
      </div>

      <!-- Rising Micro Bubbles inside liquid -->
      <div v-if="fxEnabled" class="liquid-bubbles" aria-hidden="true">
        <span class="bubble b1"></span>
        <span class="bubble b2"></span>
        <span class="bubble b3"></span>
        <span class="bubble b4"></span>
      </div>

      <div class="vessel-gloss" aria-hidden="true"></div>

      <div class="liquid-readout">
        <span class="timer-digits tabular-nums">{{ displayClock }}</span>
        <span class="timer-phase">{{ phaseLabel }} · {{ Math.round(progressPercent) }}%</span>
        <span v-if="breathingCue" class="breathing-cue-pill">{{ breathingCue.hint }}</span>
      </div>
    </div>
  </div>

  <!-- FORM 3: Physical Falling-Sand Hourglass -->
  <div
    v-else-if="viewForm === 'hourglass'"
    class="hourglass-stage stage-anchor"
    :class="{ running: isRunning }"
  >
    <svg class="hourglass-svg" width="170" height="214" viewBox="0 0 180 220" aria-hidden="true">
      <defs>
        <clipPath id="hgTopClip">
          <path d="M36,24 L144,24 L95,104 L85,104 Z" />
        </clipPath>
        <clipPath id="hgBotClip">
          <path d="M85,116 L95,116 L144,196 L36,196 Z" />
        </clipPath>
        <linearGradient id="sandGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" :stop-color="phaseSecondaryToken" />
          <stop offset="100%" :stop-color="phasePrimaryToken" />
        </linearGradient>
      </defs>

      <!-- End caps -->
      <rect x="26" y="14" width="128" height="9" rx="4.5" fill="var(--border-strong)" />
      <rect x="26" y="197" width="128" height="9" rx="4.5" fill="var(--border-strong)" />

      <!-- Glass silhouette outline -->
      <path
        d="M35,23 L145,23 L96,105 L96,115 L145,197 L35,197 L84,115 L84,105 Z"
        fill="color-mix(in srgb, var(--surface) 45%, transparent)"
        stroke="var(--border-strong)"
        stroke-width="2"
      />

      <!-- Top remaining sand -->
      <g clip-path="url(#hgTopClip)">
        <rect x="30" :y="topSandY" width="120" height="90" fill="url(#sandGrad)" opacity="0.88" />
        <ellipse cx="90" :cy="topSandY" rx="46" ry="4" :fill="phaseSecondaryToken" opacity="0.55" />
      </g>

      <!-- Falling central stream when running -->
      <line
        v-if="sandRemainingRatio > 0.01"
        class="sand-stream"
        :class="{ flowing: isRunning }"
        x1="90"
        y1="104"
        x2="90"
        :y2="bottomSandTopY + 6"
        :stroke="phasePrimaryToken"
        stroke-width="2.6"
        stroke-linecap="round"
      />

      <!-- Bottom accumulating sand cone -->
      <g clip-path="url(#hgBotClip)">
        <path
          :d="`M28,200 L64,${bottomSandTopY + 14} Q90,${bottomSandTopY - 8} 116,${bottomSandTopY + 14} L152,200 Z`"
          fill="url(#sandGrad)"
          opacity="0.92"
        />
      </g>

      <!-- Glass specular reflection -->
      <path d="M46,32 L80,96 M46,188 L80,124" stroke="var(--text-primary)" stroke-width="1.5" opacity="0.16" stroke-linecap="round" />
    </svg>

    <div class="hourglass-readout">
      <span class="timer-digits tabular-nums">{{ displayClock }}</span>
      <span class="timer-phase">{{ phaseLabel }} · 流逝 {{ Math.round(progressPercent) }}%</span>
      <span v-if="breathingCue" class="breathing-cue-pill">{{ breathingCue.hint }}</span>
    </div>
  </div>

  <!-- FORM 4: 3D Tactile Split-Flap Flip Clock -->
  <div
    v-else-if="viewForm === 'flipclock'"
    class="flipclock-stage stage-anchor"
    :class="{ running: isRunning }"
  >
    <div class="flip-row" aria-label="机械翻页时钟">
      <template v-for="(ch, idx) in clockCharacters" :key="idx">
        <span v-if="ch === ':'" class="flip-colon" :class="{ blink: isRunning }">:</span>
        <div v-else class="flip-card" :class="{ flipping: flippedIndices[idx] }">
          <span class="flip-digit tabular-nums">{{ ch }}</span>
          <span class="flip-hinge" aria-hidden="true"></span>
        </div>
      </template>
    </div>

    <div class="flip-meta-row">
      <span class="timer-phase">{{ phaseLabel }}</span>
      <span class="flip-pct tabular-nums">{{ Math.round(progressPercent) }}%</span>
    </div>

    <div class="flip-progress-rail" aria-hidden="true">
      <div
        class="flip-progress-fill"
        :style="{
          width: `${progressPercent}%`,
          background: `linear-gradient(90deg, ${phasePrimaryToken}, ${phaseSecondaryToken})`,
        }"
      >
        <span v-if="progressPercent > 1" class="flip-laser-head" :style="{ background: phaseSecondaryToken }"></span>
      </div>
    </div>
    <span v-if="breathingCue" class="breathing-cue-pill">{{ breathingCue.hint }}</span>
  </div>

  <!-- FORM 5: Glassmorphic Blooming Lotus Mandala -->
  <div
    v-else
    class="lotus-stage stage-anchor"
    :class="{ running: isRunning }"
    :style="{ '--phase-color': phasePrimaryToken, '--phase-sec': phaseSecondaryToken }"
  >
    <svg class="lotus-svg" width="248" height="248" viewBox="0 0 260 260" aria-hidden="true">
      <defs>
        <linearGradient id="lotusOuterGrad" x1="50%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%" :stop-color="phasePrimaryToken" stop-opacity="0.35" />
          <stop offset="65%" :stop-color="phasePrimaryToken" stop-opacity="0.82" />
          <stop offset="100%" :stop-color="phaseSecondaryToken" stop-opacity="0.95" />
        </linearGradient>
        <linearGradient id="lotusInnerGrad" x1="50%" y1="100%" x2="50%" y2="0%">
          <stop offset="0%" :stop-color="phaseSecondaryToken" stop-opacity="0.3" />
          <stop offset="100%" :stop-color="phaseSecondaryToken" stop-opacity="0.9" />
        </linearGradient>
        <radialGradient id="lotusCoreVeil" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="var(--surface-overlay)" stop-opacity="0.94" />
          <stop offset="72%" stop-color="var(--surface-overlay)" stop-opacity="0.72" />
          <stop offset="100%" stop-color="var(--surface-overlay)" stop-opacity="0" />
        </radialGradient>
      </defs>

      <!-- Delicate outer meridian halo -->
      <circle
        cx="130"
        cy="130"
        r="116"
        fill="none"
        stroke="var(--border-subtle)"
        stroke-width="1"
        stroke-dasharray="3 6"
      />

      <!-- 12 Translucent Outer Petals -->
      <g class="lotus-outer-group" :class="{ spinning: isRunning }">
        <g
          v-for="p in outerLotusPetals"
          :key="'outer-' + p.index"
          :transform="`rotate(${p.angle} 130 130) translate(130 130) scale(${p.scale}) translate(-130 -130)`"
        >
          <path
            d="M130,130 C106,96 108,46 130,18 C152,46 154,96 130,130 Z"
            fill="url(#lotusOuterGrad)"
            :fill-opacity="p.fillOpacity"
            :stroke="phasePrimaryToken"
            :stroke-opacity="p.strokeOpacity"
            stroke-width="1.15"
          />
        </g>
      </g>

      <!-- 6 Inner Crown Petals -->
      <g class="lotus-inner-group" :class="{ spinning: isRunning }">
        <g
          v-for="p in innerLotusPetals"
          :key="'inner-' + p.index"
          :transform="`rotate(${p.angle} 130 130) translate(130 130) scale(${p.scale}) translate(-130 -130)`"
        >
          <path
            d="M130,130 C114,104 115,72 130,46 C145,72 146,104 130,130 Z"
            fill="url(#lotusInnerGrad)"
            :fill-opacity="p.fillOpacity"
            :stroke="phaseSecondaryToken"
            stroke-opacity="0.55"
            stroke-width="1"
          />
        </g>
      </g>

      <!-- Soft Frosted Center Veil so digits stay razor crisp -->
      <circle cx="130" cy="130" r="64" fill="url(#lotusCoreVeil)" />
      <circle
        cx="130"
        cy="130"
        r="52"
        fill="none"
        :stroke="phasePrimaryToken"
        stroke-opacity="0.28"
        stroke-width="1.1"
      />
    </svg>

    <div class="lotus-center-readout">
      <span class="timer-digits tabular-nums">{{ displayClock }}</span>
      <span class="timer-phase">{{ phaseLabel }} · 绽放 {{ Math.round(progressPercent) }}%</span>
      <span v-if="breathingCue" class="breathing-cue-pill">{{ breathingCue.hint }}</span>
      <span v-else-if="zenMode && intention" class="zen-intention-pill">{{ intention }}</span>
    </div>
  </div>
</template>

<style scoped>
/* === Shared digits === */
.timer-digits {
  font-family: var(--font-mono);
  font-size: 46px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  line-height: 1.08;
}

.timer-phase {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  margin-top: 4px;
}

.zen-intention-pill {
  margin-top: 6px;
  font-size: 11px;
  color: var(--tide);
  max-width: 170px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breathing-cue-pill {
  margin-top: 6px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 32%, transparent);
}

/* === FORM 1: Holographic Dial === */
.timer-dial-wrap {
  position: relative;
  width: 248px;
  height: 248px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.timer-dial-wrap::before {
  content: '';
  position: absolute;
  inset: 14px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--tide) 14%, transparent) 0%, transparent 72%);
  opacity: 0.45;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.timer-dial-wrap.running::before {
  animation: dial-breathe 3.6s ease-in-out infinite;
  opacity: 0.92;
}

.timer-dial-wrap.break::before {
  background: radial-gradient(circle, color-mix(in srgb, var(--success) 18%, transparent) 0%, transparent 72%);
}

.timer-dial-wrap.long-break::before {
  background: radial-gradient(circle, color-mix(in srgb, var(--warning) 18%, transparent) 0%, transparent 72%);
}

@keyframes dial-breathe {
  0%, 100% {
    transform: scale(0.95);
    opacity: 0.48;
  }
  50% {
    transform: scale(1.06);
    opacity: 0.92;
  }
}

.dial-orbit-ring {
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  border: 1px dashed color-mix(in srgb, var(--tide) 36%, transparent);
  pointer-events: none;
  animation: dial-slow-orbit 26s linear infinite;
}

.timer-dial-wrap.break .dial-orbit-ring {
  border-color: color-mix(in srgb, var(--success) 36%, transparent);
}

.timer-dial-wrap.long-break .dial-orbit-ring {
  border-color: color-mix(in srgb, var(--warning) 36%, transparent);
}

.dial-orbit-ring-inner {
  position: absolute;
  inset: 11px;
  border-radius: 50%;
  border: 1px dotted color-mix(in srgb, var(--theme-secondary, var(--tide)) 34%, transparent);
  pointer-events: none;
  animation: dial-slow-orbit-rev 18s linear infinite;
}

.dial-breath-halo {
  position: absolute;
  inset: 22px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--success) 38%, transparent);
  pointer-events: none;
  animation: dial-breath-sync 16s ease-in-out infinite;
}

.timer-dial-wrap.is-sprint .dial-orbit-ring {
  border-color: color-mix(in srgb, var(--seal-red, var(--warning)) 62%, transparent);
  animation-duration: 9s;
}

@keyframes dial-slow-orbit {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes dial-slow-orbit-rev {
  from { transform: rotate(360deg); }
  to { transform: rotate(0deg); }
}

@keyframes dial-breath-sync {
  0%, 100% { transform: scale(0.92); opacity: 0.35; }
  25%, 50% { transform: scale(1.06); opacity: 0.85; }
  75% { transform: scale(0.92); opacity: 0.35; }
}

.timer-circle-progress {
  transition: stroke-dashoffset 0.35s linear;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--tide) 38%, transparent));
}

.timer-circle-progress.break-stroke {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--success) 38%, transparent));
}

.timer-circle-progress.long-break-stroke {
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--warning) 38%, transparent));
}

.dial-comet-halo {
  fill: color-mix(in srgb, var(--theme-secondary, var(--tide)) 32%, transparent);
  transition: cx 0.35s linear, cy 0.35s linear;
}

.dial-comet-core {
  fill: var(--theme-secondary, var(--tide));
  stroke: var(--surface-overlay);
  stroke-width: 1.5;
  transition: cx 0.35s linear, cy 0.35s linear;
}

.dial-comet-halo.is-break {
  fill: color-mix(in srgb, var(--success) 32%, transparent);
}
.dial-comet-core.is-break {
  fill: var(--success);
}
.dial-comet-halo.is-long-break {
  fill: color-mix(in srgb, var(--warning) 32%, transparent);
}
.dial-comet-core.is-long-break {
  fill: var(--warning);
}

.timer-center-text {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 28px;
}

/* === FORM 2: Liquid Zen Vessel === */
.liquid-vessel-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
}

.liquid-sphere {
  position: relative;
  width: 226px;
  height: 226px;
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid color-mix(in srgb, var(--phase-color, var(--tide)) 48%, var(--border-strong));
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  box-shadow:
    inset 0 6px 24px color-mix(in srgb, var(--phase-color, var(--tide)) 18%, transparent),
    0 12px 32px -12px color-mix(in srgb, var(--phase-color, var(--tide)) 45%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.liquid-level-box {
  position: absolute;
  inset: 0;
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.wave-svg {
  position: absolute;
  top: -15px;
  left: 0;
  width: 200%;
  height: 20px;
}

.wave-front {
  opacity: 0.72;
  animation: wave-slide 4.6s linear infinite;
}

.wave-back {
  top: -18px;
  opacity: 0.38;
  animation: wave-slide 7.2s linear infinite reverse;
}

@keyframes wave-slide {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

.liquid-body {
  width: 100%;
  height: 115%;
  opacity: 0.68;
}

.liquid-bubbles .bubble {
  position: absolute;
  bottom: -10px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, #ffffff 65%, var(--phase-sec, var(--tide)));
  opacity: 0;
  animation: bubble-rise 4.5s ease-in infinite;
}
.liquid-bubbles .b1 { left: 26%; animation-delay: 0s; width: 5px; height: 5px; }
.liquid-bubbles .b2 { left: 48%; animation-delay: 1.4s; width: 8px; height: 8px; }
.liquid-bubbles .b3 { left: 68%; animation-delay: 2.3s; width: 4px; height: 4px; }
.liquid-bubbles .b4 { left: 37%; animation-delay: 3.1s; width: 6px; height: 6px; }

@keyframes bubble-rise {
  0% { transform: translateY(0) scale(0.7); opacity: 0; }
  25% { opacity: 0.65; }
  100% { transform: translateY(-210px) scale(1.1); opacity: 0; }
}

.vessel-gloss {
  position: absolute;
  top: 12px;
  left: 20px;
  width: 82px;
  height: 44px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.34), transparent 72%);
  transform: rotate(-28deg);
  pointer-events: none;
}

.liquid-readout {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-overlay) 58%, transparent);
  backdrop-filter: blur(6px);
}

/* === FORM 3: Sand Hourglass === */
.hourglass-stage {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 6px 8px;
}

.hourglass-svg {
  flex-shrink: 0;
  filter: drop-shadow(0 8px 18px color-mix(in srgb, var(--tide) 20%, transparent));
}

.sand-stream {
  stroke-dasharray: 4 5;
  opacity: 0.35;
}

.sand-stream.flowing {
  opacity: 0.95;
  animation: sand-drip 0.45s linear infinite;
}

@keyframes sand-drip {
  from { stroke-dashoffset: 9; }
  to { stroke-dashoffset: 0; }
}

.hourglass-readout {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

/* === FORM 4: 3D Split-Flap Flip Clock === */
.flipclock-stage {
  width: 100%;
  padding: 20px 10px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.flip-row {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  perspective: 600px;
}

.flip-colon {
  font-family: var(--font-mono);
  font-size: 36px;
  font-weight: 800;
  color: var(--tide);
  margin: 0 2px;
}

.flip-colon.blink {
  animation: colon-pulse 1s steps(2, start) infinite;
}

@keyframes colon-pulse {
  50% { opacity: 0.35; }
}

.flip-card {
  position: relative;
  width: 52px;
  height: 76px;
  border-radius: 11px;
  background: linear-gradient(
    180deg,
    var(--surface-raised) 0%,
    var(--surface-overlay) 49%,
    color-mix(in srgb, var(--surface) 88%, var(--tide) 12%) 51%,
    var(--surface-raised) 100%
  );
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-sm), inset 0 1px 0 var(--highlight-edge);
  display: flex;
  align-items: center;
  justify-content: center;
  transform-origin: center center;
}

.flip-card.flipping {
  animation: flap-flip 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes flap-flip {
  0% { transform: rotateX(0deg); }
  45% { transform: rotateX(-38deg) scale(1.03); }
  100% { transform: rotateX(0deg); }
}

.flip-digit {
  font-family: var(--font-mono);
  font-size: 40px;
  font-weight: 800;
  color: var(--text-primary);
  line-height: 1;
}

.flip-hinge {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1.5px;
  background: color-mix(in srgb, var(--text-primary) 16%, transparent);
  pointer-events: none;
}

.flip-meta-row {
  width: 100%;
  max-width: 310px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.flip-pct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--tide);
}

.flip-progress-rail {
  width: 100%;
  max-width: 310px;
  height: 6px;
  border-radius: 99px;
  background: var(--fill-subtle);
  border: 1px solid var(--border-subtle);
  overflow: visible;
  position: relative;
}

.flip-progress-fill {
  height: 100%;
  border-radius: 99px;
  position: relative;
  transition: width 0.35s linear;
}

.flip-laser-head {
  position: absolute;
  right: -4px;
  top: 50%;
  transform: translateY(-50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 10px currentColor;
}

/* === FORM 5: Glassmorphic Blooming Lotus === */
.lotus-stage {
  position: relative;
  width: 248px;
  height: 248px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lotus-outer-group {
  transform-origin: 130px 130px;
  transition: transform 0.6s ease;
}

.lotus-outer-group.spinning {
  animation: lotus-rotate-cw 56s linear infinite;
}

.lotus-inner-group {
  transform-origin: 130px 130px;
}

.lotus-inner-group.spinning {
  animation: lotus-rotate-ccw 38s linear infinite;
}

@keyframes lotus-rotate-cw {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes lotus-rotate-ccw {
  from { transform: rotate(360deg); }
  to { transform: rotate(0deg); }
}

.lotus-center-readout {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .timer-dial-wrap.running::before,
  .dial-orbit-ring,
  .dial-orbit-ring-inner,
  .dial-breath-halo,
  .wave-front,
  .wave-back,
  .liquid-bubbles .bubble,
  .sand-stream.flowing,
  .flip-colon.blink,
  .flip-card.flipping,
  .lotus-outer-group.spinning,
  .lotus-inner-group.spinning {
    animation: none;
  }
}
</style>
