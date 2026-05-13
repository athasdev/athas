export const GUTTER_CONFIG = {
  DEBUG_LANE_WIDTH: 12,
  GIT_LANE_WIDTH: 8,
  FOLD_LANE_WIDTH: 14,
  LINE_NUMBER_PADDING: 10,
  CHAR_WIDTH: 8,
  MIN_LINE_NUMBER_WIDTH: 34,
} as const;

export function calculateLineNumberWidth(totalLines: number): number {
  const digitCount = `${totalLines}`.length;
  return Math.max(
    GUTTER_CONFIG.MIN_LINE_NUMBER_WIDTH,
    digitCount * GUTTER_CONFIG.CHAR_WIDTH + GUTTER_CONFIG.LINE_NUMBER_PADDING,
  );
}

export function calculateTotalGutterWidth(totalLines: number): number {
  const lineNumberWidth = calculateLineNumberWidth(totalLines);
  return (
    GUTTER_CONFIG.DEBUG_LANE_WIDTH +
    GUTTER_CONFIG.GIT_LANE_WIDTH +
    lineNumberWidth +
    GUTTER_CONFIG.FOLD_LANE_WIDTH
  );
}
