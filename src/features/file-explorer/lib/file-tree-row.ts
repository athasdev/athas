const FILE_TREE_ROW_LINE_HEIGHT = 1.35;
const FILE_TREE_ROW_VERTICAL_PADDING = 8;
const FILE_TREE_ROW_BORDER_WIDTH = 2;

export function getFileTreeRowHeight(uiFontSize: number): number {
  const height =
    uiFontSize * FILE_TREE_ROW_LINE_HEIGHT +
    FILE_TREE_ROW_VERTICAL_PADDING +
    FILE_TREE_ROW_BORDER_WIDTH;

  return Number(height.toFixed(2));
}

export const FILE_TREE_ROW_CLASS_NAME = "gap-1.5 px-1.5 py-1 ui-text-sm leading-[1.35]";
