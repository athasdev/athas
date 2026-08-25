export function getProjectCarouselWindow<T>(items: T[], currentIndex: number): T[] {
  if (currentIndex < 0 || currentIndex >= items.length) return [];
  return items.slice(Math.max(0, currentIndex - 1), Math.min(items.length, currentIndex + 2));
}

export function getProjectCarouselPageIndex(
  scrollLeft: number,
  pageWidth: number,
  pageCount: number,
): number | null {
  if (
    !Number.isFinite(scrollLeft) ||
    !Number.isFinite(pageWidth) ||
    pageWidth <= 0 ||
    pageCount <= 0
  ) {
    return null;
  }

  return Math.min(pageCount - 1, Math.max(0, Math.round(scrollLeft / pageWidth)));
}
