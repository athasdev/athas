export const UI_FONT_SIZE_MIN = 10;
export const UI_FONT_SIZE_MAX = 24;
export const UI_FONT_SIZE_STEP = 0.5;
export const UI_FONT_SIZE_DEFAULT = 14;

const UI_FONT_SCALE_PRECISION = 4;

export function normalizeUiFontSize(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return UI_FONT_SIZE_DEFAULT;

  const snapped = Math.round(parsed / UI_FONT_SIZE_STEP) * UI_FONT_SIZE_STEP;
  const clamped = Math.min(UI_FONT_SIZE_MAX, Math.max(UI_FONT_SIZE_MIN, snapped));

  return Number(clamped.toFixed(2));
}

export function shiftUiFontSize(currentSize: number, direction: -1 | 1): number {
  const next = normalizeUiFontSize(currentSize) + direction * UI_FONT_SIZE_STEP;
  return normalizeUiFontSize(next);
}

export function formatUiFontSize(value: number): string {
  return normalizeUiFontSize(value).toFixed(2);
}

export function getUiFontScale(value: number): number {
  const normalized = normalizeUiFontSize(value);
  return Number((normalized / UI_FONT_SIZE_DEFAULT).toFixed(UI_FONT_SCALE_PRECISION));
}
