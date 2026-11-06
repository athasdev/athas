const FILE_TREE_ROW_LINE_HEIGHT = 1.35;
const FILE_TREE_ROW_VERTICAL_PADDING = 8;
const FILE_TREE_ROW_BORDER_WIDTH = 2;

/**
 * Whole pixels: with fractional heights the rows, guides and sticky headers land between device
 * pixels, and a scroll offset the browser rounds can leave a parent header hidden under the stack
 * without pinning it.
 */
export function getFileTreeRowHeight(uiFontSize: number): number {
  return Math.round(
    uiFontSize * FILE_TREE_ROW_LINE_HEIGHT +
      FILE_TREE_ROW_VERTICAL_PADDING +
      FILE_TREE_ROW_BORDER_WIDTH,
  );
}
