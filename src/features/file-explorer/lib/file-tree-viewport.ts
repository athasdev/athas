export const FILE_TREE_VIEWPORT_OVERSCAN = 8;
export const FILE_TREE_VIEWPORT_PADDING = 4;

export type FileTreeScrollAlignment = "nearest" | "start" | "center" | "end";

interface FileTreeVirtualRange {
  startIndex: number;
  endIndex: number;
}

export function getFileTreeFirstVisibleIndex({
  rowCount,
  rowHeight,
  scrollTop,
  padding = FILE_TREE_VIEWPORT_PADDING,
}: {
  rowCount: number;
  rowHeight: number;
  scrollTop: number;
  padding?: number;
}) {
  if (rowCount <= 0 || rowHeight <= 0) return -1;

  const contentScrollTop = Math.max(0, scrollTop - padding);
  return Math.min(rowCount - 1, Math.floor(contentScrollTop / rowHeight));
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
  viewportStartOffset = 0,
  viewportHeight,
  padding = FILE_TREE_VIEWPORT_PADDING,
}: {
  alignment?: FileTreeScrollAlignment;
  currentScrollTop: number;
  index: number;
  rowCount: number;
  rowHeight: number;
  viewportStartOffset?: number;
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
  const topOffset = Math.max(
    0,
    Math.min(viewportStartOffset, Math.max(0, viewportHeight - rowHeight)),
  );
  let targetScrollTop = currentScrollTop;

  if (alignment === "nearest") {
    if (rowTop < currentScrollTop + topOffset) {
      targetScrollTop = rowTop - topOffset;
    } else if (rowBottom > currentScrollTop + viewportHeight) {
      targetScrollTop = rowBottom - viewportHeight;
    }
  } else if (alignment === "start") {
    targetScrollTop = rowTop - padding - topOffset;
  } else if (alignment === "center") {
    targetScrollTop = rowTop - (viewportHeight + topOffset - rowHeight) / 2;
  } else {
    targetScrollTop = rowBottom - viewportHeight + padding;
  }

  return Math.max(0, Math.min(targetScrollTop, maxScrollTop));
}

export const FILE_TREE_MAX_STICKY_ROWS = 7;

interface FileTreeStickyRow {
  index: number;
  /**
   * Offset from the top of the viewport; negative while a header is being pushed out. Deeper rows
   * draw under shallower ones.
   */
  top: number;
}

interface FileTreeStickyLayout {
  rows: FileTreeStickyRow[];
  /** Height of the visible part of the sticky stack. */
  height: number;
}

const NO_STICKY_ROWS: FileTreeStickyLayout = { rows: [], height: 0 };

/**
 * The folder headers to pin above the tree: the ancestors of the row just below the pinned stack,
 * outermost first. Each header is pushed up as the end of its folder scrolls under it, the way
 * VS Code's sticky scroll hands one header over to the next instead of snapping.
 */
export function getFileTreeStickyLayout({
  scrollTop,
  rowCount,
  rowHeight,
  viewportHeight,
  getAncestors,
  getSubtreeEnd,
  maxRows = FILE_TREE_MAX_STICKY_ROWS,
  padding = FILE_TREE_VIEWPORT_PADDING,
}: {
  scrollTop: number;
  rowCount: number;
  rowHeight: number;
  viewportHeight: number;
  /** Ancestor row indexes of a row, outermost first. */
  getAncestors: (index: number) => readonly number[];
  /** The last row index inside a folder row's subtree. */
  getSubtreeEnd: (index: number) => number;
  maxRows?: number;
  padding?: number;
}): FileTreeStickyLayout {
  if (rowCount <= 0 || rowHeight <= 0 || scrollTop <= padding) return NO_STICKY_ROWS;
  // Never let the stack take more than half of the tree.
  const limit = Math.min(maxRows, Math.max(1, Math.floor(viewportHeight / rowHeight / 2)));

  let stack: readonly number[] = [];
  while (stack.length < limit) {
    const probe = getFileTreeFirstVisibleIndex({
      rowCount,
      rowHeight,
      scrollTop: scrollTop + stack.length * rowHeight,
      padding,
    });
    if (probe < 0) break;
    const ancestors = getAncestors(probe);
    if (ancestors.length <= stack.length) break;
    if (stack.some((index, level) => ancestors[level] !== index)) break;
    stack = ancestors.slice(0, stack.length + 1);
  }
  if (stack.length === 0) return NO_STICKY_ROWS;

  // A header slides up under the one above it, which stays put until its own folder ends.
  const rows = stack
    .map((index, level) => {
      const subtreeBottom = padding + (getSubtreeEnd(index) + 1) * rowHeight - scrollTop;
      return { index, top: Math.min(level * rowHeight, subtreeBottom - rowHeight) };
    })
    .filter((row) => row.top + rowHeight > 0);
  const height = Math.max(0, ...rows.map((row) => row.top + rowHeight));
  return height > 0 ? { rows, height } : NO_STICKY_ROWS;
}

/** For each row, the index of the last row inside its subtree (itself for files and closed folders). */
export function getFileTreeSubtreeEnds(depths: readonly number[]): Int32Array {
  const ends = new Int32Array(depths.length);
  const open: number[] = [];
  for (let index = 0; index < depths.length; index++) {
    while (open.length > 0 && depths[open[open.length - 1]!]! >= depths[index]!) {
      ends[open.pop()!] = index - 1;
    }
    open.push(index);
  }
  while (open.length > 0) ends[open.pop()!] = depths.length - 1;
  return ends;
}
