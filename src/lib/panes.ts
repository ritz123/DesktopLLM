export function clampPaneSize(size: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, size));
}
