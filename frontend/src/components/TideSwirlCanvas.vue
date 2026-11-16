<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getCanvasIntensity, isLightThemeId, normalizeThemeId, type CanvasIntensity } from '../utils/themes';
import {
  getSeasonalAtmosphere,
  getShanshuiThemeAtmosphere,
  type SeasonalAtmosphere,
  type ShanshuiThemeAtmosphere,
} from '../utils/shanshui';
import { focusEngineState } from '../utils/focusEngine';

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let motionQuery: MediaQueryList | null = null;
let cleanupListeners: (() => void) | null = null;

interface Palette {
  tide: string;
  lime: string;
  secondary: string;
  seal: string;
  themeId: string;
  isLight: boolean;
  isShanshui: boolean;
  intensity: CanvasIntensity;
  seasonal: SeasonalAtmosphere;
  atmosphere: ShanshuiThemeAtmosphere;
}

function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  const tide = styles.getPropertyValue('--tide').trim() || '#46b7ff';
  const lime = styles.getPropertyValue('--lime-strong').trim() || '#c8f936';
  const secondary = styles.getPropertyValue('--theme-secondary').trim() || lime;
  const seal = styles.getPropertyValue('--seal-red').trim() || '#e05246';
  const themeId = normalizeThemeId(document.documentElement.getAttribute('data-theme'));
  const isLight = isLightThemeId(themeId);
  const isShanshui = themeId.startsWith('shanshui-');
  const intensity = getCanvasIntensity();
  const seasonal = getSeasonalAtmosphere(new Date());
  const atmosphere = getShanshuiThemeAtmosphere(themeId);
  return { tide, lime, secondary, seal, themeId, isLight, isShanshui, intensity, seasonal, atmosphere };
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let phase = 0;
  let lastFrame = 0;
  let palette = readPalette();
  let reducedMotion = false;

  const syncSize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = parent.clientWidth;
    height = parent.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const drawFrame = (ts: number) => {
    rafId = null;
    if (!width || !height) return;

    if (palette.intensity === 'off') {
      ctx.clearRect(0, 0, width, height);
      return;
    }

    // Gentle ~30fps ambient cadence keeps CPU usage near zero
    if (lastFrame && ts - lastFrame < 32 && !reducedMotion) {
      rafId = requestAnimationFrame(drawFrame);
      return;
    }
    lastFrame = ts;
    ctx.clearRect(0, 0, width, height);

    const intensityScale = palette.intensity === 'vivid' ? 1.48 : palette.intensity === 'subtle' ? 0.56 : 1;

    if (palette.isShanshui) {
      // Distant vermilion sun / mountain moon aura
      const orbX = width * 0.84;
      const orbY = height * 0.13 + Math.sin(phase * 0.45) * 3;
      const orbGrad = ctx.createRadialGradient(orbX, orbY, 2, orbX, orbY, 82);
      orbGrad.addColorStop(0, palette.seal);
      orbGrad.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = Math.min(0.4, (palette.isLight ? 0.13 : 0.085) * intensityScale);
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(orbX, orbY, 82, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Three ink-wash layered mountain ridges (层峦叠嶂)
      const ridges = [
        { baseY: 0.24, amp: 34, freq: 1.8, drift: 0.25, color: palette.secondary, alpha: palette.isLight ? 0.085 : 0.065, depth: 110 },
        { baseY: 0.31, amp: 28, freq: 2.35, drift: -0.35, color: palette.tide, alpha: palette.isLight ? 0.11 : 0.08, depth: 130 },
        { baseY: 0.39, amp: 20, freq: 3.1, drift: 0.42, color: palette.tide, alpha: palette.isLight ? 0.065 : 0.05, depth: 120 },
      ];

      for (const r of ridges) {
        const y0 = height * r.baseY;
        const fillGrad = ctx.createLinearGradient(0, y0 - r.amp, 0, y0 + r.depth);
        fillGrad.addColorStop(0, r.color);
        fillGrad.addColorStop(1, 'transparent');

        ctx.save();
        ctx.globalAlpha = Math.min(0.35, r.alpha * intensityScale);
        ctx.fillStyle = fillGrad;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        const steps = 56;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const x = u * width;
          const peak =
            Math.sin(u * Math.PI * r.freq + phase * r.drift) * r.amp +
            Math.cos(u * Math.PI * (r.freq * 2.15) - phase * 0.28) * (r.amp * 0.46) +
            Math.sin(u * Math.PI * 5.2 + 1.1) * (r.amp * 0.18);
          const y = y0 - Math.abs(peak) * 0.85;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.lineTo(width, y0 + r.depth);
        ctx.lineTo(0, y0 + r.depth);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Soft horizon valley mist veil (山岚云带)
      const mistGrad = ctx.createLinearGradient(0, height * 0.33, 0, height * 0.48);
      mistGrad.addColorStop(0, 'transparent');
      mistGrad.addColorStop(0.5, palette.secondary);
      mistGrad.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = Math.min(0.16, (palette.isLight ? 0.065 : 0.045) * intensityScale);
      ctx.fillStyle = mistGrad;
      ctx.fillRect(0, height * 0.33, width, height * 0.15);
      ctx.restore();

      // Soft horizontal river mist & water ripples (江雾波纹)
      const ripples = [
        { yFrac: 0.46, amp: 7, freq: 2.2, speed: 0.65, color: palette.tide, alpha: palette.isLight ? 0.08 : 0.065 },
        { yFrac: 0.52, amp: 5, freq: 2.9, speed: -0.5, color: palette.lime, alpha: palette.isLight ? 0.065 : 0.045 },
      ];
      for (const rp of ripples) {
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.22, rp.color);
        grad.addColorStop(0.78, rp.color);
        grad.addColorStop(1, 'transparent');
        ctx.save();
        ctx.globalAlpha = Math.min(0.32, rp.alpha * intensityScale);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 42; i++) {
          const u = i / 42;
          const x = u * width;
          const y = height * rp.yFrac + Math.sin(u * Math.PI * 2 * rp.freq + phase * rp.speed) * rp.amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Theme-specific subtle Shanshui atmosphere details (all scaled by intensityScale)
      const motifAlpha = (base: number) => Math.min(0.42, base * intensityScale);
      const motif = palette.atmosphere.motif;
      if (motif === 'waterfall') {
        // Vertical cascading waterfall / canyon mist ribbons (飞瀑银练)
        const falls = [0.28, 0.31, 0.68];
        for (let idx = 0; idx < falls.length; idx++) {
          const fx = width * falls[idx];
          const fyTop = height * 0.24;
          const fyLen = height * (0.14 + (idx % 2) * 0.06);
          const fGrad = ctx.createLinearGradient(fx, fyTop, fx, fyTop + fyLen);
          fGrad.addColorStop(0, palette.tide);
          fGrad.addColorStop(0.6, palette.secondary);
          fGrad.addColorStop(1, 'transparent');
          ctx.save();
          ctx.globalAlpha = motifAlpha(0.065 + 0.025 * Math.sin(phase * 1.4 + idx));
          ctx.strokeStyle = fGrad;
          ctx.lineWidth = 2.2 - idx * 0.4;
          ctx.beginPath();
          ctx.moveTo(fx, fyTop);
          ctx.lineTo(fx + Math.sin(phase * 0.6 + idx) * 2, fyTop + fyLen);
          ctx.stroke();
          ctx.restore();
        }
      } else if (motif === 'alpine') {
        // Tranquil snow / alpine cloud motes (雪域浮尘)
        ctx.save();
        ctx.fillStyle = palette.secondary;
        for (let m = 0; m < 10; m++) {
          const mx = (width * (0.12 + m * 0.085) + phase * (6 + (m % 3) * 2)) % width;
          const my = height * (0.08 + ((m * 17) % 34) / 100) + Math.sin(phase * 0.7 + m) * 5;
          ctx.globalAlpha = motifAlpha(0.08 + (m % 3) * 0.03);
          ctx.beginPath();
          ctx.arc(mx, my, 1.1 + (m % 2) * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (motif === 'sunhalo') {
        // Warm outer halo rings around the sun/moon orb
        ctx.save();
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.1 : 0.075);
        ctx.strokeStyle = palette.seal;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(orbX, orbY, 26 + Math.sin(phase * 0.6) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.055 : 0.045);
        ctx.beginPath();
        ctx.arc(orbX, orbY, 44 - Math.sin(phase * 0.4) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (motif === 'cascade-pools') {
        // Tiered travertine emerald pools shimmering gently (九寨五花池)
        const pools = [
          { cx: 0.24, cy: 0.47, rx: 64, ry: 12 },
          { cx: 0.52, cy: 0.5, rx: 86, ry: 14 },
          { cx: 0.78, cy: 0.48, rx: 56, ry: 10 },
        ];
        for (let i = 0; i < pools.length; i++) {
          const p = pools[i];
          ctx.save();
          ctx.globalAlpha = motifAlpha(0.07 + 0.02 * Math.sin(phase + i));
          ctx.strokeStyle = i % 2 === 0 ? palette.tide : palette.secondary;
          ctx.lineWidth = 1.0;
          ctx.beginPath();
          ctx.ellipse(width * p.cx, height * p.cy, p.rx, p.ry, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      } else if (motif === 'moonwindow') {
        // Classical Suzhou moon-gate silhouette & gentle bamboo stalks (竹影月洞)
        ctx.save();
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.095 : 0.065);
        ctx.strokeStyle = palette.tide;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(width * 0.16, height * 0.23, 52, Math.PI * 0.15, Math.PI * 1.65);
        ctx.stroke();
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.08 : 0.055);
        for (let b = 0; b < 3; b++) {
          const bx = width * (0.12 + b * 0.024);
          const sway = Math.sin(phase * 0.55 + b) * 3.5;
          ctx.beginPath();
          ctx.moveTo(bx, height * 0.34);
          ctx.quadraticCurveTo(bx + sway * 0.5, height * 0.22, bx + sway, height * 0.11 + b * 8);
          ctx.stroke();
        }
        ctx.restore();
      } else if (motif === 'karst') {
        // Misty sandstone karst pillars (武陵群峰 / 漓江独秀)
        const pillars = [0.19, 0.25, 0.72, 0.77];
        for (let idx = 0; idx < pillars.length; idx++) {
          const px = width * pillars[idx];
          const pTop = height * (0.17 + (idx % 2) * 0.05);
          const pBot = height * 0.39;
          const pGrad = ctx.createLinearGradient(px, pTop, px, pBot);
          pGrad.addColorStop(0, palette.tide);
          pGrad.addColorStop(1, 'transparent');
          ctx.save();
          ctx.globalAlpha = motifAlpha(0.075);
          ctx.fillStyle = pGrad;
          ctx.fillRect(px - 6, pTop, 12 - (idx % 2) * 3, pBot - pTop);
          ctx.restore();
        }
      } else if (motif === 'caldera') {
        // Changbai crater lake mirror reflection (天池镜面)
        ctx.save();
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.11 : 0.08);
        ctx.strokeStyle = palette.tide;
        ctx.lineWidth = 1;
        for (let row = 0; row < 3; row++) {
          const ly = height * (0.44 + row * 0.022);
          const span = width * (0.18 - row * 0.04);
          ctx.beginPath();
          ctx.moveTo(width * 0.5 - span, ly);
          ctx.lineTo(width * 0.5 + span, ly);
          ctx.stroke();
        }
        ctx.restore();
      } else if (motif === 'rain-ripples') {
        // Celadon raindrop concentric ripples (雨过天青涟漪)
        const drops = [
          { cx: 0.24, cy: 0.45, offset: 0 },
          { cx: 0.56, cy: 0.49, offset: 1.9 },
          { cx: 0.78, cy: 0.43, offset: 3.4 },
        ];
        ctx.save();
        ctx.strokeStyle = palette.tide;
        ctx.lineWidth = 0.9;
        for (const d of drops) {
          const cycle = ((phase * 0.45 + d.offset) % 3.14) / 3.14;
          const rx = 14 + cycle * 48;
          const ry = 4 + cycle * 11;
          ctx.globalAlpha = motifAlpha((palette.isLight ? 0.14 : 0.1) * (1 - cycle));
          ctx.beginPath();
          ctx.ellipse(width * d.cx, height * d.cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      } else if (motif === 'bamboo-mist') {
        // Tall slender Qingcheng bamboo groves swaying gently in mountain mist (青城幽篁)
        ctx.save();
        ctx.strokeStyle = palette.tide;
        ctx.lineWidth = 1.15;
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.1 : 0.08);
        const stalks = [0.14, 0.175, 0.205, 0.84, 0.87];
        for (let b = 0; b < stalks.length; b++) {
          const bx = width * stalks[b];
          const sway = Math.sin(phase * 0.5 + b * 0.9) * 5;
          const topY = height * (0.08 + (b % 2) * 0.05);
          ctx.beginPath();
          ctx.moveTo(bx, height * 0.42);
          ctx.quadraticCurveTo(bx + sway * 0.45, height * 0.25, bx + sway, topY);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // Distant ink-wash wild geese silhouettes gliding across clouds (孤鹜远影)
        ctx.save();
        ctx.strokeStyle = palette.tide;
        ctx.lineWidth = 1.05;
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.16 : 0.13);
        for (let g = 0; g < 3; g++) {
          const gx = (width * (0.58 + g * 0.045) - phase * (4 + g * 0.6) + width) % width;
          const gy = height * (0.14 + g * 0.025) + Math.sin(phase * 0.9 + g) * 2.5;
          const wing = 5 - g * 0.6;
          ctx.beginPath();
          ctx.moveTo(gx - wing, gy + 1.5);
          ctx.quadraticCurveTo(gx - wing * 0.45, gy - 2.2, gx, gy);
          ctx.quadraticCurveTo(gx + wing * 0.45, gy - 2.2, gx + wing, gy + 1.5);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Subtle 4-season organic atmospheric particles (落英/流萤/丹枫/微雪)
      const pType = palette.seasonal.particleType;
      ctx.save();
      for (let k = 0; k < 6; k++) {
        const px = (width * (0.1 + k * 0.155) + phase * (pType === 'firefly' ? 3 : 5 + (k % 2) * 2)) % width;
        const py = height * (0.09 + ((k * 13) % 32) / 100) + Math.sin(phase * 0.8 + k * 1.7) * 6;
        ctx.globalAlpha = motifAlpha(palette.isLight ? 0.09 : 0.075);
        ctx.fillStyle = pType === 'maple' ? palette.seal : pType === 'petal' ? palette.seal : pType === 'firefly' ? palette.lime : palette.tide;
        ctx.beginPath();
        if (pType === 'petal' || pType === 'maple') {
          ctx.ellipse(px, py, 2.2, 1.1, phase * 0.6 + k, 0, Math.PI * 2);
        } else {
          ctx.arc(px, py, pType === 'firefly' ? 1.5 : 1.2, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.restore();
    } else {
      const strands = [
        { yFrac: 0.12, amp: 24, freq: 1.5, speed: 0.9, color: palette.tide, alpha: palette.isLight ? 0.09 : 0.13, width: 1.4 },
        { yFrac: 0.19, amp: 32, freq: 1.15, speed: -0.7, color: palette.secondary, alpha: palette.isLight ? 0.065 : 0.09, width: 1.1 },
        { yFrac: 0.27, amp: 20, freq: 2.05, speed: 1.15, color: palette.tide, alpha: palette.isLight ? 0.055 : 0.07, width: 0.9 },
        { yFrac: 0.35, amp: 16, freq: 1.65, speed: -0.55, color: palette.lime, alpha: palette.isLight ? 0.04 : 0.05, width: 0.75 },
      ];

      for (const s of strands) {
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.24, s.color);
        grad.addColorStop(0.76, s.color);
        grad.addColorStop(1, 'transparent');

        ctx.save();
        ctx.globalAlpha = Math.min(0.35, s.alpha * intensityScale);
        ctx.strokeStyle = grad;
        ctx.lineWidth = s.width;
        ctx.beginPath();

        const steps = 42;
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          const x = u * width;
          const wave =
            Math.sin(u * Math.PI * 2 * s.freq + phase * s.speed) * s.amp +
            Math.cos(u * Math.PI * 3.1 - phase * 0.6) * (s.amp * 0.35);
          const y = height * s.yFrac + wave;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // Curated theme signature accents (Cyber sonar ticks / Ember horizon / Orchid aura)
      if (palette.themeId === 'cyber') {
        ctx.save();
        ctx.globalAlpha = Math.min(0.24, 0.09 * intensityScale);
        ctx.strokeStyle = palette.tide;
        ctx.lineWidth = 1;
        const tickY = height * 0.42;
        for (let t = 0; t < 16; t++) {
          const tx = width * (0.1 + t * 0.052);
          const h = t % 4 === 0 ? 7 : 3;
          ctx.beginPath();
          ctx.moveTo(tx, tickY);
          ctx.lineTo(tx, tickY + h);
          ctx.stroke();
        }
        ctx.restore();
      } else if (palette.themeId === 'amber') {
        const emberGrad = ctx.createLinearGradient(0, height * 0.3, 0, height * 0.46);
        emberGrad.addColorStop(0, 'transparent');
        emberGrad.addColorStop(0.5, palette.tide);
        emberGrad.addColorStop(1, 'transparent');
        ctx.save();
        ctx.globalAlpha = Math.min(0.2, 0.06 * intensityScale);
        ctx.fillStyle = emberGrad;
        ctx.fillRect(0, height * 0.3, width, height * 0.16);
        ctx.restore();
      } else if (palette.themeId === 'aurora') {
        const orbX = width * (0.76 + Math.sin(phase * 0.3) * 0.05);
        const orbY = height * 0.16;
        const aura = ctx.createRadialGradient(orbX, orbY, 2, orbX, orbY, 130);
        aura.addColorStop(0, palette.secondary);
        aura.addColorStop(1, 'transparent');
        ctx.save();
        ctx.globalAlpha = Math.min(0.26, 0.08 * intensityScale);
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(orbX, orbY, 130, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (palette.themeId === 'daylight') {
        ctx.save();
        ctx.globalAlpha = Math.min(0.18, 0.07 * intensityScale);
        ctx.strokeStyle = palette.tide;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([4, 7]);
        ctx.beginPath();
        ctx.moveTo(width * 0.08, height * 0.41);
        ctx.lineTo(width * 0.92, height * 0.41);
        ctx.stroke();
        ctx.restore();
      } else {
        // Midnight bioluminescent deep-sea plankton motes
        ctx.save();
        for (let m = 0; m < 7; m++) {
          const mx = (width * (0.14 + m * 0.12) + phase * (3.5 + (m % 3))) % width;
          const my = height * (0.14 + ((m * 19) % 28) / 100) + Math.sin(phase * 0.8 + m) * 6;
          ctx.globalAlpha = Math.min(0.32, (0.09 + (m % 2) * 0.04) * intensityScale);
          ctx.fillStyle = m % 2 === 0 ? palette.tide : palette.lime;
          ctx.beginPath();
          ctx.arc(mx, my, 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Focus-Session Resonance Aura: gently synchronizes workspace waves with Pomodoro flow
    if (focusEngineState.isRunning && focusEngineState.prefs.fxEnabled) {
      const fxX = width * 0.5;
      const fxY = height * 0.28;
      const pulse = 0.5 + 0.5 * Math.sin(phase * 1.4);
      const isFocusPhase = focusEngineState.mode === 'focus';
      const primaryFXColor = isFocusPhase ? palette.tide : palette.secondary;
      const fxRadius = Math.min(width, height) * (0.26 + pulse * 0.09);

      const fxGrad = ctx.createRadialGradient(fxX, fxY, 4, fxX, fxY, fxRadius);
      fxGrad.addColorStop(0, primaryFXColor);
      fxGrad.addColorStop(0.6, palette.secondary);
      fxGrad.addColorStop(1, 'transparent');
      ctx.save();
      ctx.globalAlpha = Math.min(0.18, (0.055 + pulse * 0.03) * intensityScale);
      ctx.fillStyle = fxGrad;
      ctx.beginPath();
      ctx.arc(fxX, fxY, fxRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = primaryFXColor;
      ctx.lineWidth = 0.9;
      ctx.globalAlpha = Math.min(0.24, (0.08 + pulse * 0.05) * intensityScale);
      ctx.beginPath();
      ctx.arc(fxX, fxY, fxRadius * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Global focus completion resonance wave across the workspace
    if (focusEngineState.prefs.fxEnabled && focusEngineState.lastCompletionAt > 0) {
      const elapsedMs = Date.now() - focusEngineState.lastCompletionAt;
      if (elapsedMs >= 0 && elapsedMs < 1800) {
        const progress = elapsedMs / 1800;
        const ringRadius = Math.max(width, height) * (0.08 + progress * 0.65);
        ctx.save();
        ctx.strokeStyle = focusEngineState.lastCompletionMode === 'focus' ? palette.lime : palette.tide;
        ctx.lineWidth = 2.2 * (1 - progress);
        ctx.globalAlpha = 0.36 * (1 - progress);
        ctx.beginPath();
        ctx.arc(width * 0.5, height * 0.36, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (!reducedMotion && !document.hidden) {
      phase += focusEngineState.isRunning ? 0.017 : 0.012;
      rafId = requestAnimationFrame(drawFrame);
    }
  };

  const startLoop = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(drawFrame);
  };

  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = motionQuery.matches;

  const onMotionChange = () => {
    reducedMotion = Boolean(motionQuery?.matches);
    startLoop();
  };
  motionQuery.addEventListener('change', onMotionChange);

  const onVisibility = () => {
    if (!document.hidden && !reducedMotion) startLoop();
  };
  document.addEventListener('visibilitychange', onVisibility);

  themeObserver = new MutationObserver(() => {
    palette = readPalette();
    lastFrame = 0;
    if (palette.intensity === 'off' || reducedMotion || document.hidden || rafId === null) {
      startLoop();
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-color-scheme', 'data-canvas-intensity', 'data-custom-accent', 'style'],
  });

  resizeObserver = new ResizeObserver(() => {
    syncSize();
    if (reducedMotion) startLoop();
  });
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

  syncSize();
  startLoop();

  cleanupListeners = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    motionQuery?.removeEventListener('change', onMotionChange);
    document.removeEventListener('visibilitychange', onVisibility);
  };
});

onUnmounted(() => {
  cleanupListeners?.();
  cleanupListeners = null;
});
</script>

<template>
  <canvas ref="canvasRef" class="tide-swirl-canvas" aria-hidden="true"></canvas>
</template>

<style scoped>
.tide-swirl-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
</style>
