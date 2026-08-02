export const MIN_RESPONSIVE_PANE_WIDTH = 50;
const MIN_MAIN_CONTENT_WIDTH = 360;

export function getResponsivePaneMaxWidth(viewportWidth: number, reservedWidth: number) {
  return Math.max(
    MIN_RESPONSIVE_PANE_WIDTH,
    viewportWidth - reservedWidth - MIN_MAIN_CONTENT_WIDTH,
  );
}

export function clampResponsivePaneWidth({
  value,
  minWidth,
  viewportWidth,
  reservedWidth,
}: {
  value: number;
  minWidth: number;
  viewportWidth: number;
  reservedWidth: number;
}) {
  const maxWidth = getResponsivePaneMaxWidth(viewportWidth, reservedWidth);
  const responsiveMinWidth = Math.min(minWidth, maxWidth);
  return Math.max(responsiveMinWidth, Math.min(value, maxWidth));
}
