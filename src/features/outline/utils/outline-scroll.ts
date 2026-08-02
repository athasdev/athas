interface OutlineRevealGeometry {
  scrollTop: number;
  viewportTop: number;
  viewportBottom: number;
  rowTop: number;
  rowBottom: number;
  padding?: number;
}

export function getOutlineRevealScrollTop({
  scrollTop,
  viewportTop,
  viewportBottom,
  rowTop,
  rowBottom,
  padding = 4,
}: OutlineRevealGeometry): number | null {
  const visibleTop = viewportTop + padding;
  const visibleBottom = viewportBottom - padding;

  if (rowTop < visibleTop) {
    return Math.max(0, scrollTop - (visibleTop - rowTop));
  }

  if (rowBottom > visibleBottom) {
    return Math.max(0, scrollTop + rowBottom - visibleBottom);
  }

  return null;
}
