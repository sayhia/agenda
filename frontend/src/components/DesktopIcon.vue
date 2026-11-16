<script setup lang="ts">
export type DesktopIconName =
  | 'bolt'
  | 'popover'
  | 'timer'
  | 'sparkle'
  | 'calendar'
  | 'grid'
  | 'windows-hide'
  | 'pin'
  | 'popout'
  | 'close'
  | 'moon'
  | 'clock-snooze'
  | 'coffee'
  | 'play'
  | 'pause'
  | 'check'
  | 'alert'
  | 'reset'
  | 'skip'
  | 'volume-off'
  | 'headphones'
  | 'minimize'
  | 'maximize'
  | 'plus';

withDefaults(
  defineProps<{
    name: DesktopIconName;
    size?: number;
    strokeWidth?: number;
  }>(),
  {
    size: 14,
    strokeWidth: 1.8,
  },
);
</script>

<template>
  <svg
    class="desktop-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <polygon v-if="name === 'bolt'" points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />

    <template v-else-if="name === 'popover'">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6M9 16h4" />
    </template>

    <template v-else-if="name === 'timer'">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6M12 2v3" />
    </template>

    <path v-else-if="name === 'sparkle'" d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z" />

    <template v-else-if="name === 'calendar'">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </template>

    <template v-else-if="name === 'grid'">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </template>

    <template v-else-if="name === 'windows-hide'">
      <rect x="3" y="4" width="14" height="11" rx="2" />
      <path d="M7 19h11a2 2 0 0 0 2-2V8" />
      <path d="M3 3l18 18" />
    </template>

    <template v-else-if="name === 'pin'">
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a1 1 0 0 1 1-1h.5a.5.5 0 0 0 0-1h-9a.5.5 0 0 0 0 1H8a1 1 0 0 1 1 1z" />
    </template>

    <template v-else-if="name === 'popout'">
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </template>

    <template v-else-if="name === 'close'">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </template>

    <path v-else-if="name === 'moon'" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />

    <template v-else-if="name === 'clock-snooze'">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M5 3L2 6M22 6l-3-3" />
    </template>

    <template v-else-if="name === 'coffee'">
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <line x1="6" y1="2" x2="6" y2="4" />
      <line x1="10" y1="2" x2="10" y2="4" />
      <line x1="14" y1="2" x2="14" y2="4" />
    </template>

    <polygon v-else-if="name === 'play'" points="6 4 20 12 6 20 6 4" />

    <template v-else-if="name === 'pause'">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </template>

    <polyline v-else-if="name === 'check'" points="20 6 9 17 4 12" />

    <template v-else-if="name === 'alert'">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </template>

    <template v-else-if="name === 'reset'">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </template>

    <template v-else-if="name === 'skip'">
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </template>

    <template v-else-if="name === 'volume-off'">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </template>

    <path v-else-if="name === 'headphones'" d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />

    <template v-else-if="name === 'minimize'">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </template>

    <template v-else-if="name === 'maximize'">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </template>

    <path v-else-if="name === 'plus'" d="M12 5v14M5 12h14" />
  </svg>
</template>

<style scoped>
.desktop-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
