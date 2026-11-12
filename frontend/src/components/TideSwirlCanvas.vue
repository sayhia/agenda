<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let motionQuery: MediaQueryList | null = null;

interface Palette {
  tide: string;
  lime: string;
  isLight: boolean;
}

function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  const tide = styles.getPropertyValue('--tide').trim() || '#46b7ff';
  const lime = styles.getPropertyValue('--lime-strong').trim() || '#c8f936';
  const isLight = document.documentElement.getAttribute('data-theme') === 'daylight';
  return { tide, lime, isLight };
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

    // Gentle ~30fps ambient cadence keeps CPU usage near zero
    if (lastFrame && ts - lastFrame < 32 && !reducedMotion) {
      rafId = requestAnimationFrame(drawFrame);
      return;
    }
    lastFrame = ts;
    ctx.clearRect(0, 0, width, height);

    const strands = [
      { yFrac: 0.12, amp: 24, freq: 1.5, speed: 0.9, color: palette.tide, alpha: palette.isLight ? 0.09 : 0.13, width: 1.4 },
      { yFrac: 0.19, amp: 32, freq: 1.15, speed: -0.7, color: palette.lime, alpha: palette.isLight ? 0.065 : 0.085, width: 1.1 },
      { yFrac: 0.27, amp: 20, freq: 2.05, speed: 1.15, color: palette.tide, alpha: palette.isLight ? 0.055 : 0.07, width: 0.9 },
      { yFrac: 0.35, amp: 16, freq: 1.65, speed: -0.55, color: palette.tide, alpha: palette.isLight ? 0.035 : 0.045, width: 0.75 },
    ];

    for (const s of strands) {
      const grad = ctx.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.24, s.color);
      grad.addColorStop(0.76, s.color);
      grad.addColorStop(1, 'transparent');

      ctx.save();
      ctx.globalAlpha = s.alpha;
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

    if (!reducedMotion && !document.hidden) {
      phase += 0.012;
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
    if (reducedMotion) startLoop();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  resizeObserver = new ResizeObserver(() => {
    syncSize();
    if (reducedMotion) startLoop();
  });
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);

  syncSize();
  startLoop();

  onUnmounted(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    motionQuery?.removeEventListener('change', onMotionChange);
    document.removeEventListener('visibilitychange', onVisibility);
  });
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
