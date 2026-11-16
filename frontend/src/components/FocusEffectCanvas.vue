<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { FocusDialHudStyle, FocusEffectStyle, FocusPhaseMode } from '../utils/focus';

const props = withDefaults(
  defineProps<{
    active: boolean;
    running: boolean;
    mode: FocusPhaseMode;
    effectStyle: FocusEffectStyle;
    dialHudStyle?: FocusDialHudStyle;
    showDialHud?: boolean;
    fxEnabled: boolean;
    completionSignal: number;
    startSignal?: number;
    sprintActive?: boolean;
    zenActive?: boolean;
    secondsLeft?: number;
  }>(),
  {
    dialHudStyle: 'spectrum',
    showDialHud: true,
    startSignal: 0,
    sprintActive: false,
    zenActive: false,
    secondsLeft: 0,
  },
);

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  angle: number;
  spin: number;
  z: number;
  orbitAngle: number;
  orbitRadius: number;
  tone: 'primary' | 'secondary' | 'seal';
}

interface RippleWave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  lineWidth: number;
  tone: 'primary' | 'secondary' | 'seal';
}

interface BurstSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  tone: 'primary' | 'secondary' | 'seal';
}

const canvasRef = ref<HTMLCanvasElement | null>(null);

let rafId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let cleanupListeners: (() => void) | null = null;

let reducedMotion = false;
let width = 0;
let height = 0;
let dpr = 1;
let lastFrame = 0;
let tickPhase = 0;

let pointerX = -1000;
let pointerY = -1000;
let pointerActive = false;

let palette = {
  primary: '#46b7ff',
  secondary: '#d9ff54',
  seal: '#e05246',
  success: '#00d294',
  warning: '#fcbb00',
  isLight: false,
};

let particles: Particle[] = [];
let ripples: RippleWave[] = [];
let bursts: BurstSpark[] = [];

function readThemePalette() {
  if (typeof document === 'undefined') return;
  const styles = getComputedStyle(document.documentElement);
  palette = {
    primary: styles.getPropertyValue('--tide').trim() || styles.getPropertyValue('--accent').trim() || '#46b7ff',
    secondary: styles.getPropertyValue('--theme-secondary').trim() || styles.getPropertyValue('--lime-strong').trim() || '#c8f936',
    seal: styles.getPropertyValue('--seal-red').trim() || '#e05246',
    success: styles.getPropertyValue('--success').trim() || '#00d294',
    warning: styles.getPropertyValue('--warning').trim() || '#fcbb00',
    isLight: document.documentElement.getAttribute('data-color-scheme') === 'light',
  };
}

function resolveColor(tone: 'primary' | 'secondary' | 'seal'): string {
  if (props.mode === 'shortBreak' && tone === 'primary') return palette.success;
  if (props.mode === 'longBreak' && tone === 'primary') return palette.warning;
  if (tone === 'secondary') return palette.secondary;
  if (tone === 'seal') return palette.seal;
  return palette.primary;
}

function getDialAnchor(): { cx: number; cy: number; r: number } {
  const host = canvasRef.value?.parentElement;
  const dialEl = host?.querySelector('.stage-anchor') as HTMLElement | null;
  if (host && dialEl) {
    const hostRect = host.getBoundingClientRect();
    const dialRect = dialEl.getBoundingClientRect();
    if (dialRect.width > 0 && hostRect.width > 0) {
      return {
        cx: dialRect.left - hostRect.left + dialRect.width * 0.5,
        cy: dialRect.top - hostRect.top + dialRect.height * 0.5,
        r: Math.min(dialRect.width, dialRect.height) * 0.5,
      };
    }
  }
  return { cx: width * 0.5, cy: height * 0.44, r: 124 };
}

function seedParticles() {
  const style = props.effectStyle;
  const count =
    style === 'mist'
      ? 20
      : style === 'starfield' || style === 'nebula'
        ? 48
        : style === 'petal' || style === 'snow' || style === 'spectrum'
          ? 34
          : 30;
  const w = Math.max(width, 460);
  const h = Math.max(height, 480);
  const tones: ('primary' | 'secondary' | 'seal')[] = ['primary', 'primary', 'secondary', 'seal'];
  particles = Array.from({ length: count }, (_, idx) => {
    const isRain = style === 'ripple';
    const isEmber = style === 'embers';
    const isSnowOrPetal = style === 'snow' || style === 'petal';
    return {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: isRain
        ? -0.55
        : isEmber || isSnowOrPetal
          ? (Math.random() - 0.5) * 0.48
          : (Math.random() - 0.5) * 0.36,
      vy: isRain
        ? 2.1 + Math.random() * 1.8
        : isEmber
          ? -(0.48 + Math.random() * 0.82)
          : isSnowOrPetal
            ? 0.5 + Math.random() * 0.72
            : style === 'matrix'
              ? 1.15 + Math.random() * 1.4
              : (Math.random() - 0.5) * 0.32,
      size:
        style === 'mist'
          ? 24 + Math.random() * 32
          : style === 'petal'
            ? 4.2 + Math.random() * 3.4
            : style === 'snow'
              ? 3.2 + Math.random() * 2.8
              : 1.8 + Math.random() * 2.6,
      alpha: style === 'mist' ? 0.08 + Math.random() * 0.09 : 0.42 + Math.random() * 0.46,
      phase: (idx / count) * Math.PI * 2,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.04,
      z: 0.25 + Math.random() * 0.95,
      orbitAngle: (idx / count) * Math.PI * 2,
      orbitRadius: 42 + Math.random() * 175,
      tone: tones[idx % tones.length],
    };
  });
}

function spawnPulseWave(cx: number, cy: number, tone: 'primary' | 'secondary' | 'seal' = 'primary') {
  if (!props.fxEnabled || reducedMotion || !width || !height) return;
  ripples.push({
    x: cx,
    y: cy,
    radius: 20,
    maxRadius: Math.max(width, height) * 0.58,
    alpha: 0.52,
    lineWidth: 1.6,
    tone,
  });
}

function spawnPointerBurst(x: number, y: number, count: number = 14) {
  if (!props.fxEnabled || reducedMotion) return;
  const tones: ('primary' | 'secondary' | 'seal')[] = ['primary', 'secondary', 'seal'];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const speed = 1.1 + Math.random() * 2.4;
    bursts.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1.7 + Math.random() * 2.1,
      life: 0,
      maxLife: 26 + Math.floor(Math.random() * 14),
      tone: tones[i % tones.length],
    });
  }
}

function spawnPointerSpark(x: number, y: number) {
  if (!props.fxEnabled || reducedMotion || bursts.length > 96) return;
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.28 + Math.random() * 0.85;
  bursts.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 0.15,
    size: 1.5 + Math.random() * 1.6,
    life: 0,
    maxLife: 24 + Math.floor(Math.random() * 12),
    tone: Math.random() > 0.45 ? 'primary' : 'secondary',
  });
}

function spawnCompletionBurst() {
  if (!props.fxEnabled || reducedMotion || !width || !height) return;
  const { cx, cy } = getDialAnchor();
  const tones: ('primary' | 'secondary' | 'seal')[] = ['primary', 'secondary', 'seal'];
  for (let i = 0; i < 48; i++) {
    const angle = (i / 48) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
    const speed = 1.8 + Math.random() * 3.8;
    bursts.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2.2 + Math.random() * 2.8,
      life: 0,
      maxLife: 44 + Math.floor(Math.random() * 20),
      tone: tones[i % tones.length],
    });
  }
  ripples.push(
    { x: cx, y: cy, radius: 34, maxRadius: Math.max(width, height) * 0.68, alpha: 0.56, lineWidth: 2, tone: 'primary' },
    { x: cx, y: cy, radius: 18, maxRadius: Math.max(width, height) * 0.52, alpha: 0.42, lineWidth: 1.4, tone: 'secondary' },
  );
}

/** Draws 6 distinct holographic Dial HUD modes (Spectrum, Radar, Gyro, Cyber, Bagua, Chronograph). */
function drawDialHudEffects(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dialR: number,
  alphaBase: number,
  speedBoost: number,
) {
  const hud = props.dialHudStyle || 'spectrum';
  const style = props.effectStyle;
  const activeScale = props.running ? 1 : 0.52;

  // Base breathing aura halo behind the dial
  const glowR = dialR * (1.28 + 0.08 * Math.sin(tickPhase * 1.6));
  const bgGlow = ctx.createRadialGradient(cx, cy, dialR * 0.42, cx, cy, glowR);
  bgGlow.addColorStop(0, 'transparent');
  bgGlow.addColorStop(0.65, resolveColor('primary'));
  bgGlow.addColorStop(1, 'transparent');
  ctx.save();
  ctx.globalAlpha = (props.running ? 0.14 : 0.07) * alphaBase;
  ctx.fillStyle = bgGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (hud === 'radar') {
    // Holographic Sonar Sweep: sweeping conic wedge + laser edge + concentric range rings + blip dots
    const sweepAng = tickPhase * (props.running ? 1.45 : 0.45) - Math.PI / 2;
    const sweepR = dialR + 10;

    ctx.save();
    for (let ringIdx = 0; ringIdx < 3; ringIdx++) {
      ctx.strokeStyle = resolveColor(ringIdx % 2 === 0 ? 'primary' : 'secondary');
      ctx.lineWidth = ringIdx === 2 ? 1.3 : 0.8;
      ctx.globalAlpha = (0.16 + ringIdx * 0.08) * alphaBase;
      ctx.setLineDash(ringIdx === 1 ? [4, 5] : []);
      ctx.beginPath();
      ctx.arc(cx, cy, dialR - 22 + ringIdx * 16, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Radar sweep sector wedge
    for (let slice = 0; slice < 14; slice++) {
      const sliceAlpha = ((14 - slice) / 14) * 0.15 * activeScale * alphaBase;
      const a0 = sweepAng - (slice + 1) * 0.048;
      const a1 = sweepAng - slice * 0.048;
      ctx.fillStyle = resolveColor('primary');
      ctx.globalAlpha = sliceAlpha;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, sweepR, a0, a1);
      ctx.closePath();
      ctx.fill();
    }

    // Sweeping laser arm
    ctx.strokeStyle = resolveColor('secondary');
    ctx.lineWidth = 1.9;
    ctx.globalAlpha = 0.72 * activeScale * alphaBase;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(sweepAng) * (dialR * 0.42), cy + Math.sin(sweepAng) * (dialR * 0.42));
    ctx.lineTo(cx + Math.cos(sweepAng) * sweepR, cy + Math.sin(sweepAng) * sweepR);
    ctx.stroke();

    // Pinging radar target blips around perimeter
    const blipAngles = [0.6, 2.35, 4.1, 5.25];
    for (const ba of blipAngles) {
      const diff = ((sweepAng - ba) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const ping = diff < 1.8 ? Math.max(0, 1 - diff / 1.8) : 0.15;
      const bx = cx + Math.cos(ba) * (dialR + 4);
      const by = cy + Math.sin(ba) * (dialR + 4);
      ctx.fillStyle = resolveColor(ping > 0.6 ? 'seal' : 'secondary');
      ctx.globalAlpha = ping * 0.9 * alphaBase;
      ctx.beginPath();
      ctx.arc(bx, by, 2.2 + ping * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (hud === 'gyro') {
    // Celestial Astrolabe Gyroscope: 3 intersecting tilted 3D-foreshortened elliptical orbits + nodes
    const tilts = [-0.52, 0.56, 1.52];
    const tones: ('primary' | 'secondary' | 'seal')[] = ['primary', 'secondary', 'seal'];
    for (let g = 0; g < 3; g++) {
      const rot = tilts[g] + tickPhase * (g % 2 === 0 ? 0.22 : -0.18) * speedBoost;
      const flatten = 0.34 + 0.14 * Math.sin(tickPhase * 0.8 + g * 2.1);
      const rx = dialR + 8 + g * 4;
      const ry = rx * flatten;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = resolveColor(tones[g]);
      ctx.lineWidth = g === 0 ? 1.6 : 1.2;
      ctx.globalAlpha = (props.running ? 0.48 : 0.26) * alphaBase;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Orbiting planetary node along the tilted ellipse
      const nodeAng = tickPhase * (1.1 + g * 0.35) * speedBoost + g * 2.1;
      const nx = Math.cos(nodeAng) * rx;
      const ny = Math.sin(nodeAng) * ry;
      ctx.fillStyle = resolveColor(tones[(g + 1) % 3]);
      ctx.globalAlpha = 0.92 * alphaBase;
      ctx.beginPath();
      ctx.arc(nx, ny, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (hud === 'cyber') {
    // Cyber Mecha Telemetry Reticle: segmented locking quadrants, corner chevrons & counter-rotating dash ring
    const innerRot = tickPhase * 0.7 * speedBoost;
    const outerRot = -tickPhase * 0.55 * speedBoost;
    const pulseOffset = props.running ? Math.sin(tickPhase * 3.2) * 3 : 0;

    ctx.save();
    for (let q = 0; q < 4; q++) {
      const baseA = q * (Math.PI / 2) + outerRot;
      ctx.strokeStyle = resolveColor(q % 2 === 0 ? 'primary' : 'secondary');
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 0.56 * activeScale * alphaBase;
      ctx.beginPath();
      ctx.arc(cx, cy, dialR + 9 + pulseOffset, baseA - 0.34, baseA + 0.34);
      ctx.stroke();

      // Corner targeting tick triangle
      const tipR = dialR + 16 + pulseOffset;
      const tx = cx + Math.cos(baseA) * tipR;
      const ty = cy + Math.sin(baseA) * tipR;
      ctx.fillStyle = resolveColor('seal');
      ctx.globalAlpha = 0.85 * alphaBase;
      ctx.beginPath();
      ctx.arc(tx, ty, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Inner dashed telemetry track
    ctx.strokeStyle = resolveColor('primary');
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 6]);
    ctx.globalAlpha = 0.44 * alphaBase;
    ctx.beginPath();
    ctx.arc(cx, cy, dialR + 3, innerRot, innerRot + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  } else if (hud === 'bagua') {
    // Shanshui Eight-Trigram Compass: 8 vector trigrams + 24 fine meridian needles + Taiji orbiting pearls
    const compassRot = tickPhase * 0.14 * speedBoost;
    ctx.save();

    // 24 seasonal meridian needles around outer ring
    for (let m = 0; m < 24; m++) {
      const ma = (m / 24) * Math.PI * 2 + compassRot;
      const rIn = dialR + 2;
      const rOut = dialR + (m % 3 === 0 ? 11 : 6);
      ctx.strokeStyle = resolveColor(m % 6 === 0 ? 'seal' : 'primary');
      ctx.lineWidth = m % 3 === 0 ? 1.3 : 0.8;
      ctx.globalAlpha = (m % 3 === 0 ? 0.5 : 0.25) * alphaBase;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ma) * rIn, cy + Math.sin(ma) * rIn);
      ctx.lineTo(cx + Math.cos(ma) * rOut, cy + Math.sin(ma) * rOut);
      ctx.stroke();
    }

    // 8 crisp vector Trigram blocks tangent outside ring
    const trigrams = [
      [1, 1, 1],
      [0, 1, 1],
      [1, 0, 1],
      [0, 0, 1],
      [1, 1, 0],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ];
    for (let t = 0; t < 8; t++) {
      const ang = (t / 8) * Math.PI * 2 - compassRot * 0.8;
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * (dialR + 17), cy + Math.sin(ang) * (dialR + 17));
      ctx.rotate(ang + Math.PI / 2);
      ctx.strokeStyle = resolveColor(t % 2 === 0 ? 'primary' : 'secondary');
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.58 * alphaBase;
      for (let bar = 0; bar < 3; bar++) {
        const yOff = (bar - 1) * 3.4;
        if (trigrams[t][bar] === 1) {
          ctx.beginPath();
          ctx.moveTo(-6, yOff);
          ctx.lineTo(6, yOff);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(-6, yOff);
          ctx.lineTo(-1.5, yOff);
          ctx.moveTo(1.5, yOff);
          ctx.lineTo(6, yOff);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    ctx.restore();
  } else if (hud === 'chronograph') {
    // Precision Tourbillon Chronometer: rotating toothed escapement ring + sweeping laser second-hand needle
    const gearRot = tickPhase * 0.28 * speedBoost;
    ctx.save();
    const teeth = 36;
    for (let i = 0; i < teeth; i++) {
      const ta = (i / teeth) * Math.PI * 2 + gearRot;
      const r0 = dialR + 3;
      const r1 = dialR + (i % 3 === 0 ? 10 : 6.5);
      ctx.strokeStyle = resolveColor(i % 9 === 0 ? 'seal' : i % 3 === 0 ? 'secondary' : 'primary');
      ctx.lineWidth = i % 3 === 0 ? 2 : 1.1;
      ctx.globalAlpha = (i % 3 === 0 ? 0.56 : 0.28) * alphaBase;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ta) * r0, cy + Math.sin(ta) * r0);
      ctx.lineTo(cx + Math.cos(ta) * r1, cy + Math.sin(ta) * r1);
      ctx.stroke();
    }

    // Sweeping second-hand indicator synced cleanly to secondsLeft % 60
    const secFrac = (60 - ((props.secondsLeft || 0) % 60)) / 60;
    const secAng = secFrac * Math.PI * 2 - Math.PI / 2;
    const tipR = dialR + 13;
    const innerNeedleR = dialR - 14;
    ctx.strokeStyle = resolveColor('seal');
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.globalAlpha = (props.running ? 0.92 : 0.45) * alphaBase;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(secAng) * innerNeedleR, cy + Math.sin(secAng) * innerNeedleR);
    ctx.lineTo(cx + Math.cos(secAng) * tipR, cy + Math.sin(secAng) * tipR);
    ctx.stroke();

    ctx.fillStyle = resolveColor('seal');
    ctx.beginPath();
    ctx.arc(cx + Math.cos(secAng) * tipR, cy + Math.sin(secAng) * tipR, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    // Default 'spectrum': Dual-mirror 72-bar Harmonic EQ Corona + Scanner Arcs
    ctx.save();
    const scanR = dialR + 6;
    const sweepAngle = tickPhase * (props.running ? 1.15 : 0.35);
    for (let i = 0; i < 2; i++) {
      const aStart = sweepAngle + i * Math.PI;
      const aEnd = aStart + (props.running ? 0.85 : 0.55);
      ctx.strokeStyle = resolveColor(i === 0 ? 'primary' : 'secondary');
      ctx.lineWidth = props.running ? 2 : 1.3;
      ctx.lineCap = 'round';
      ctx.globalAlpha = (props.running ? 0.52 : 0.25) * alphaBase;
      ctx.beginPath();
      ctx.arc(cx, cy, scanR + i * 4, aStart, aEnd);
      ctx.stroke();
    }

    const bars = 72;
    const barBaseR = dialR + 2;
    const isRich = style === 'spectrum' || style === 'matrix' || style === 'starfield' || style === 'nebula';
    for (let b = 0; b < bars; b++) {
      const theta = (b / bars) * Math.PI * 2 - Math.PI / 2;
      const wave1 = Math.sin(b * 0.45 + tickPhase * 2.5 * speedBoost);
      const wave2 = Math.cos(b * 0.22 - tickPhase * 1.8 * speedBoost);
      const amp = isRich ? 15 : 9.5;
      const barLen = (3 + Math.abs(wave1 * 0.6 + wave2 * 0.4) * amp) * activeScale;
      const x1 = cx + Math.cos(theta) * (barBaseR - barLen * 0.24);
      const y1 = cy + Math.sin(theta) * (barBaseR - barLen * 0.24);
      const x2 = cx + Math.cos(theta) * (barBaseR + barLen);
      const y2 = cy + Math.sin(theta) * (barBaseR + barLen);

      ctx.strokeStyle = resolveColor(b % 4 === 0 ? 'secondary' : b % 9 === 0 ? 'seal' : 'primary');
      ctx.lineWidth = isRich ? 1.7 : 1.35;
      ctx.lineCap = 'round';
      ctx.globalAlpha = (isRich ? 0.58 : 0.38) * activeScale * alphaBase;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Twin Orbiting Satellite Orbs shared across all HUD modes for cohesive depth
  ctx.save();
  for (let s = 0; s < 2; s++) {
    const orbitR = dialR + (s === 0 ? 11 : 17);
    const dir = s === 0 ? 1 : -1;
    const ang = tickPhase * (s === 0 ? 0.95 : 0.62) * speedBoost * dir + s * 2.1;
    const sx = cx + Math.cos(ang) * orbitR;
    const sy = cy + Math.sin(ang) * orbitR;
    const tone: 'primary' | 'secondary' = s === 0 ? 'primary' : 'secondary';

    ctx.strokeStyle = resolveColor(tone);
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.36 * activeScale * alphaBase;
    ctx.beginPath();
    if (dir > 0) ctx.arc(cx, cy, orbitR, ang - 0.55, ang);
    else ctx.arc(cx, cy, orbitR, ang, ang + 0.55);
    ctx.stroke();

    const orbGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 7);
    orbGrad.addColorStop(0, resolveColor(tone));
    orbGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = orbGrad;
    ctx.globalAlpha = 0.85 * alphaBase;
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = resolveColor(tone);
    ctx.globalAlpha = 0.95 * alphaBase;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawAuroraRibbons(ctx: CanvasRenderingContext2D, alphaBase: number, speedBoost: number) {
  ctx.save();
  for (let r = 0; r < 2; r++) {
    const baseY = height * (0.14 + r * 0.14);
    const tone = r === 0 ? 'primary' : 'secondary';
    const grad = ctx.createLinearGradient(0, baseY - 40, width, baseY + 50);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.5, resolveColor(tone));
    grad.addColorStop(1, 'transparent');
    ctx.strokeStyle = grad;
    ctx.lineWidth = r === 0 ? 28 : 20;
    ctx.globalAlpha = (props.running ? 0.14 : 0.08) * alphaBase;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 20) {
      const y = baseY + Math.sin(x * 0.013 + tickPhase * 0.85 + r * 1.7) * (16 * speedBoost * 0.5);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawBambooLightShafts(ctx: CanvasRenderingContext2D, alphaBase: number) {
  ctx.save();
  for (let i = 0; i < 4; i++) {
    const xBase = width * (0.12 + i * 0.23) + Math.sin(tickPhase * 0.35 + i) * 12;
    const grad = ctx.createLinearGradient(xBase, 0, xBase + 62, height);
    grad.addColorStop(0, resolveColor(i % 2 === 0 ? 'primary' : 'secondary'));
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.globalAlpha = (props.running ? 0.08 : 0.045) * alphaBase;
    ctx.beginPath();
    ctx.moveTo(xBase, 0);
    ctx.lineTo(xBase + 42, 0);
    ctx.lineTo(xBase + 98, height);
    ctx.lineTo(xBase + 52, height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawFrame(ts: number) {
  rafId = null;
  const canvas = canvasRef.value;
  if (!canvas || !width || !height) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (!props.active || !props.fxEnabled) {
    ctx.clearRect(0, 0, width, height);
    return;
  }

  if (lastFrame && ts - lastFrame < 32 && !reducedMotion) {
    rafId = requestAnimationFrame(drawFrame);
    return;
  }
  lastFrame = ts;
  ctx.clearRect(0, 0, width, height);

  const sprintMult = props.sprintActive ? 1.55 : 1;
  const speedBoost = (props.running ? 1.4 : 0.65) * sprintMult;
  const zenBoost = props.zenActive ? 1.15 : 1;
  // Strong mineral contrast in light themes so visuals never wash out on white paper
  const alphaBase = (palette.isLight ? 0.88 : 0.96) * zenBoost;
  const style = props.effectStyle;
  const dialAnchor = getDialAnchor();

  // Style atmospheric wash
  if (style === 'aurora') {
    drawAuroraRibbons(ctx, alphaBase, speedBoost);
  } else if (style === 'bamboo') {
    drawBambooLightShafts(ctx, alphaBase);
  } else if (style === 'mist' || style === 'embers' || style === 'nebula') {
    const cx = style === 'embers' ? width * 0.5 : dialAnchor.cx + Math.cos(tickPhase * 0.45) * 24;
    const cy = style === 'embers' ? height * 0.86 : dialAnchor.cy + Math.sin(tickPhase * 0.55) * 14;
    const auraRadius = Math.max(width, height) * 0.58;
    const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, auraRadius);
    grad.addColorStop(0, resolveColor(style === 'embers' ? 'seal' : 'primary'));
    grad.addColorStop(0.55, resolveColor('secondary'));
    grad.addColorStop(1, 'transparent');
    ctx.save();
    ctx.globalAlpha = (props.running ? 0.14 : 0.08) * alphaBase;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // Dial Kinetic HUD (only when Focus view form is Holographic Dial)
  if (props.showDialHud) {
    drawDialHudEffects(ctx, dialAnchor.cx, dialAnchor.cy, dialAnchor.r, alphaBase, speedBoost);
  }

  // Final-minute subtle outer sprint shimmer glow
  if (props.sprintActive && props.running) {
    const pulse = 0.5 + 0.5 * Math.sin(tickPhase * 3.4);
    ctx.save();
    ctx.strokeStyle = resolveColor('seal');
    ctx.lineWidth = 2.2;
    ctx.globalAlpha = 0.18 + pulse * 0.24;
    ctx.strokeRect(2, 2, width - 4, height - 4);
    ctx.restore();
  }

  // Pointer interactive gravity halo
  if (pointerActive && pointerX > 0 && pointerY > 0) {
    const pGrad = ctx.createRadialGradient(pointerX, pointerY, 0, pointerX, pointerY, 84);
    pGrad.addColorStop(0, resolveColor('primary'));
    pGrad.addColorStop(1, 'transparent');
    ctx.save();
    ctx.globalAlpha = 0.14 * alphaBase;
    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.arc(pointerX, pointerY, 84, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Auto water ripples during ripple / bamboo
  if ((style === 'ripple' || style === 'bamboo') && ripples.length < 4 && Math.random() < (props.running ? 0.045 : 0.018)) {
    ripples.push({
      x: width * (0.14 + Math.random() * 0.72),
      y: height * (0.18 + Math.random() * 0.64),
      radius: 4,
      maxRadius: 62 + Math.random() * 58,
      alpha: 0.36,
      lineWidth: 1.3,
      tone: Math.random() > 0.35 ? 'primary' : 'secondary',
    });
  }

  // Expanding ripples
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.radius += 1.25 * speedBoost;
    const ratio = 1 - r.radius / r.maxRadius;
    if (ratio <= 0) {
      ripples.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.strokeStyle = resolveColor(r.tone);
    ctx.globalAlpha = r.alpha * ratio * alphaBase;
    ctx.lineWidth = r.lineWidth;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Update & draw particles
  const useConstellation =
    style === 'starfield' || style === 'aurora' || style === 'spectrum' || style === 'nebula' || style === 'firefly';

  for (let idx = 0; idx < particles.length; idx++) {
    const p = particles[idx];
    if (!reducedMotion) {
      p.phase += 0.032 * speedBoost;
      p.angle += p.spin * speedBoost;

      if (style === 'nebula') {
        p.orbitAngle += (0.008 + (1 - p.z * 0.5) * 0.006) * speedBoost;
        p.x = dialAnchor.cx + Math.cos(p.orbitAngle) * p.orbitRadius;
        p.y = dialAnchor.cy + Math.sin(p.orbitAngle) * (p.orbitRadius * 0.78);
      } else if (style === 'starfield') {
        const dx = p.x - dialAnchor.cx || 1;
        const dy = p.y - dialAnchor.cy || 1;
        const dist = Math.hypot(dx, dy) || 1;
        const radialVel = (0.55 + p.z * 1.55) * speedBoost;
        p.x += (dx / dist) * radialVel;
        p.y += (dy / dist) * radialVel;
        if (p.x < -12 || p.x > width + 12 || p.y < -12 || p.y > height + 12) {
          const randAngle = Math.random() * Math.PI * 2;
          const spawnDist = 12 + Math.random() * 34;
          p.x = dialAnchor.cx + Math.cos(randAngle) * spawnDist;
          p.y = dialAnchor.cy + Math.sin(randAngle) * spawnDist;
        }
      } else if (style === 'firefly') {
        p.vx += (Math.random() - 0.5) * 0.065;
        p.vy += (Math.random() - 0.5) * 0.065;
        p.vx = Math.max(-0.62, Math.min(0.62, p.vx));
        p.vy = Math.max(-0.62, Math.min(0.62, p.vy));
        p.x += p.vx * speedBoost;
        p.y += p.vy * speedBoost;
      } else {
        const sway = style === 'bamboo' || style === 'mist' || style === 'petal' || style === 'snow'
          ? Math.sin(p.phase) * (style === 'petal' ? 0.65 : 0.34)
          : 0;
        p.x += (p.vx + sway) * speedBoost;
        p.y += p.vy * speedBoost;
      }

      // Gentle magnetic deflection around cursor
      if (pointerActive && style !== 'nebula') {
        const pdx = p.x - pointerX;
        const pdy = p.y - pointerY;
        const pdist = Math.hypot(pdx, pdy);
        if (pdist > 2 && pdist < 85) {
          p.x += (pdx / pdist) * 0.9;
          p.y += (pdy / pdist) * 0.9;
        }
      }

      if (style !== 'starfield' && style !== 'nebula') {
        if (p.x < -30) p.x = width + 20;
        if (p.x > width + 30) p.x = -20;
        if (p.y < -30) p.y = height + 20;
        if (p.y > height + 30) p.y = -20;
      }
    }

    const pulse = style === 'firefly' ? 0.35 + 0.65 * Math.max(0, Math.sin(p.phase * 1.4)) : 0.72 + 0.28 * Math.sin(p.phase);
    const drawAlpha = p.alpha * pulse * (props.running ? 1 : 0.72) * alphaBase;

    // Constellation web links & pointer cursor magnetic filaments
    if (useConstellation) {
      if (pointerActive && Math.hypot(p.x - pointerX, p.y - pointerY) < 92) {
        ctx.save();
        ctx.strokeStyle = resolveColor('primary');
        ctx.lineWidth = 0.85;
        ctx.globalAlpha = 0.28 * alphaBase;
        ctx.beginPath();
        ctx.moveTo(pointerX, pointerY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.restore();
      }
      for (let j = idx + 1; j < particles.length; j++) {
        const q = particles[j];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 68) {
          ctx.save();
          ctx.strokeStyle = resolveColor(p.tone);
          ctx.lineWidth = 0.7;
          ctx.globalAlpha = (1 - d / 68) * 0.24 * alphaBase;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.save();
    ctx.fillStyle = resolveColor(p.tone);
    ctx.strokeStyle = resolveColor(p.tone);
    ctx.globalAlpha = drawAlpha;

    if (style === 'mist') {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      g.addColorStop(0, resolveColor(p.tone));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'ripple') {
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 4, p.y + 11);
      ctx.stroke();
    } else if (style === 'petal') {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'snow') {
      // Crystal snowflake + soft glowing core
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.lineWidth = 1.2;
      for (let arm = 0; arm < 3; arm++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath();
        ctx.moveTo(-p.size, 0);
        ctx.lineTo(p.size, 0);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.28, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'starfield') {
      const dx = p.x - dialAnchor.cx;
      const dy = p.y - dialAnchor.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const streak = Math.min(16, 2.5 + (dist / 30) * speedBoost);
      ctx.lineWidth = 1.45;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (dx / dist) * streak, p.y - (dy / dist) * streak);
      ctx.stroke();
    } else if (style === 'matrix') {
      const tail = 14 + p.size * 4;
      ctx.lineWidth = 1.45;
      const mGrad = ctx.createLinearGradient(p.x, p.y - tail, p.x, p.y);
      mGrad.addColorStop(0, 'transparent');
      mGrad.addColorStop(1, resolveColor(p.tone));
      ctx.strokeStyle = mGrad;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - tail);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillRect(p.x - 1.4, p.y - 1.4, 2.8, 2.8);
    } else if (style === 'firefly') {
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
      glow.addColorStop(0, resolveColor(p.tone));
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Bursts & pointer sparks
  for (let i = bursts.length - 1; i >= 0; i--) {
    const b = bursts[i];
    b.x += b.vx;
    b.y += b.vy;
    b.vx *= 0.955;
    b.vy *= 0.955;
    b.life += 1;
    const ratio = 1 - b.life / b.maxLife;
    if (ratio <= 0) {
      bursts.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.fillStyle = resolveColor(b.tone);
    ctx.globalAlpha = ratio * 0.9;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.size * ratio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (!reducedMotion && props.active && props.fxEnabled && !document.hidden) {
    tickPhase += 0.026 * speedBoost;
    rafId = requestAnimationFrame(drawFrame);
  }
}

function syncCanvasSize() {
  const canvas = canvasRef.value;
  if (!canvas || !canvas.parentElement) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = canvas.parentElement.clientWidth;
  height = canvas.parentElement.clientHeight;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (particles.length === 0) seedParticles();
}

function kickLoop() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(drawFrame);
}

watch(() => props.effectStyle, () => {
  seedParticles();
  kickLoop();
});

watch(() => [props.active, props.fxEnabled, props.running, props.sprintActive, props.zenActive, props.dialHudStyle, props.showDialHud], () => {
  syncCanvasSize();
  kickLoop();
});

watch(() => props.completionSignal, (val, prev) => {
  if (val && val !== prev) {
    spawnCompletionBurst();
    kickLoop();
  }
});

watch(() => props.startSignal, (val, prev) => {
  if (val && val !== prev && width && height) {
    const { cx, cy } = getDialAnchor();
    spawnPulseWave(cx, cy, 'primary');
    spawnPointerBurst(cx, cy, 18);
    kickLoop();
  }
});

onMounted(() => {
  readThemePalette();
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = motionQuery.matches;
  const onMotionChange = () => {
    reducedMotion = Boolean(motionQuery?.matches);
    kickLoop();
  };
  motionQuery.addEventListener('change', onMotionChange);

  themeObserver = new MutationObserver(() => {
    readThemePalette();
    kickLoop();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-color-scheme', 'data-custom-accent', 'style'],
  });

  const onVisibility = () => {
    if (!document.hidden && !reducedMotion && props.active && props.fxEnabled) {
      lastFrame = 0;
      kickLoop();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const host = canvasRef.value?.parentElement;
  if (host) {
    resizeObserver = new ResizeObserver(() => {
      syncCanvasSize();
      kickLoop();
    });
    resizeObserver.observe(host);

    const onPointerMove = (e: PointerEvent) => {
      if (!props.active || !props.fxEnabled) return;
      const rect = host.getBoundingClientRect();
      pointerX = e.clientX - rect.left;
      pointerY = e.clientY - rect.top;
      pointerActive = true;
      if (Math.random() < 0.55) {
        spawnPointerSpark(pointerX, pointerY);
      }
    };
    const onPointerLeave = () => {
      pointerActive = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!props.active || !props.fxEnabled) return;
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      spawnPulseWave(px, py, 'secondary');
      spawnPointerBurst(px, py, 14);
    };
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    host.addEventListener('pointerdown', onPointerDown);

    cleanupListeners = () => {
      motionQuery?.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('pointerdown', onPointerDown);
    };
  } else {
    cleanupListeners = () => {
      motionQuery?.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }

  syncCanvasSize();
  kickLoop();
});

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  resizeObserver?.disconnect();
  themeObserver?.disconnect();
  cleanupListeners?.();
  cleanupListeners = null;
});
</script>

<template>
  <canvas ref="canvasRef" class="focus-effect-canvas" aria-hidden="true"></canvas>
</template>

<style scoped>
.focus-effect-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  border-radius: inherit;
}
</style>
