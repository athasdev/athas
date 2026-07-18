const EDITOR_BOTTOM_SAFE_AREA_RATIO = 0.5;

export function getEditorBottomScrollPadding(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  return Math.round(viewportHeight * EDITOR_BOTTOM_SAFE_AREA_RATIO);
}
