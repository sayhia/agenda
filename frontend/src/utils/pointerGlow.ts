/**
 * Scrolltide Lumen / Midwater lightweight pointer-tracking spotlight helper.
 * Updates --mx / --my CSS variables without triggering layout reflows.
 */
export function handlePointerGlow(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  target.style.setProperty('--mx', `${Math.round(event.clientX - rect.left)}px`);
  target.style.setProperty('--my', `${Math.round(event.clientY - rect.top)}px`);
}

export function resetPointerGlow(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  target.style.removeProperty('--mx');
  target.style.removeProperty('--my');
}
