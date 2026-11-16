/**
 * Deterministic tag color system for Agenda Butler.
 * Automatically preserves vivid luminescence on dark surfaces and deep ink contrast on Daylight.
 */

function makeTagSwatch(hex: string): { bg: string; text: string; border: string } {
  return {
    bg: `color-mix(in oklab, ${hex} 13%, transparent)`,
    text: `color-mix(in oklab, ${hex} 78%, var(--text-primary))`,
    border: `color-mix(in oklab, ${hex} 32%, transparent)`,
  };
}

const PRESET_TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  工作: makeTagSwatch('#3b82f6'),
  生活: makeTagSwatch('#10b981'),
  健康: makeTagSwatch('#f43f5e'),
  会议: makeTagSwatch('#f59e0b'),
  投放: makeTagSwatch('#0ea5e9'),
  学习: makeTagSwatch('#06b6d4'),
  重要: makeTagSwatch('#ef4444'),
  限流: makeTagSwatch('#ea580c'),
};

const PALETTE = [
  makeTagSwatch('#2563eb'),
  makeTagSwatch('#f97316'),
  makeTagSwatch('#14b8a6'),
  makeTagSwatch('#46b7ff'),
  makeTagSwatch('#eab308'),
];

const CUSTOM_TAG_STORAGE_KEY = 'agenda_custom_tag_colors';

export function setCustomTagColor(tag: string, hex: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(CUSTOM_TAG_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[tag.trim()] = hex;
    localStorage.setItem(CUSTOM_TAG_STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function getCustomTagColors(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(CUSTOM_TAG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getTagColor(tagName: string): { bg: string; text: string; border: string } {
  const clean = tagName.trim();
  const customMap = getCustomTagColors();
  if (customMap[clean]) {
    return makeTagSwatch(customMap[clean]);
  }

  if (PRESET_TAG_COLORS[clean]) {
    return PRESET_TAG_COLORS[clean];
  }

  // Deterministic hash
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
}
