export const FILE_TREE_VIEWPORT_OVERSCAN = 8;
export const FILE_TREE_VIEWPORT_PADDING = 4;

export type FileTreeScrollAlignment = "nearest" | "start" | "center" | "end";

export interface FileTreeVirtualRange {
  startIndex: number;
  endIndex: number;
}

export function getFileTreeTotalHeight(
  rowCount: number,
  rowHeight: number,
  padding = FILE_TREE_VIEWPORT_PADDING,
) {
  return Math.max(0, rowCount) * rowHeight + padding * 2;
}

export function getFileTreeVirtualRange({
  rowCount,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = FILE_TREE_VIEWPORT_OVERSCAN,
  padding = FILE_TREE_VIEWPORT_PADDING,
}: {
  rowCount: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
  padding?: number;
}): FileTreeVirtualRange {
  if (rowCount <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: -1 };
  }

  const contentScrollTop = Math.max(0, scrollTop - padding);
  const visibleStart = Math.floor(contentScrollTop / rowHeight);
  const visibleEnd = Math.ceil((scrollTop + viewportHeight - padding) / rowHeight) - 1;

  return {
    startIndex: Math.max(0, visibleStart - overscan),
    endIndex: Math.min(rowCount - 1, Math.max(visibleStart, visibleEnd) + overscan),
  };
}

export function getFileTreeScrollTop({
  alignment = "nearest",
  currentScrollTop,
  index,
  rowCount,
  rowHeight,
  viewportHeight,
  padding = FILE_TREE_VIEWPORT_PADDING,
}: {
  alignment?: FileTreeScrollAlignment;
  currentScrollTop: number;
  index: number;
  rowCount: number;
  rowHeight: number;
  viewportHeight: number;
  padding?: number;
}): number | null {
  if (index < 0 || index >= rowCount || rowHeight <= 0 || viewportHeight <= 0) {
    return null;
  }

  const rowTop = padding + index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const totalHeight = getFileTreeTotalHeight(rowCount, rowHeight, padding);
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  let targetScrollTop = currentScrollTop;

  if (alignment === "nearest") {
    if (rowTop < currentScrollTop) {
      targetScrollTop = rowTop;
    } else if (rowBottom > currentScrollTop + viewportHeight) {
      targetScrollTop = rowBottom - viewportHeight;
    }
  } else if (alignment === "start") {
    targetScrollTop = rowTop - padding;
  } else if (alignment === "center") {
    targetScrollTop = rowTop - (viewportHeight - rowHeight) / 2;
  } else {
    targetScrollTop = rowBottom - viewportHeight + padding;
  }

  return Math.max(0, Math.min(targetScrollTop, maxScrollTop));
}
