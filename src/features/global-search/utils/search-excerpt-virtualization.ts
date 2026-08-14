import type { SearchExcerpt } from "./search-excerpts";

const VIRTUALIZATION_FILE_THRESHOLD = 12;
const VIRTUALIZATION_LINE_THRESHOLD = 240;
const FILE_HEADER_HEIGHT = 29;
const CODE_VERTICAL_PADDING = 16;
const SECTION_DIVIDER_HEIGHT = 1;

export function shouldVirtualizeSearchExcerpts(excerpts: readonly SearchExcerpt[]) {
  if (excerpts.length > VIRTUALIZATION_FILE_THRESHOLD) return true;

  let lineCount = 0;
  for (const excerpt of excerpts) {
    lineCount += excerpt.lineNumberMap.length;
    if (lineCount > VIRTUALIZATION_LINE_THRESHOLD) return true;
  }

  return false;
}

export function estimateSearchExcerptHeight(
  excerpt: SearchExcerpt | undefined,
  lineHeight: number,
) {
  const lineCount = excerpt?.lineNumberMap.length ?? 1;
  return (
    FILE_HEADER_HEIGHT + CODE_VERTICAL_PADDING + SECTION_DIVIDER_HEIGHT + lineCount * lineHeight
  );
}

export function getStickySearchExcerptIndex(
  virtualItems: readonly { index: number; start: number }[],
  scrollOffset: number,
) {
  let activeIndex = virtualItems[0]?.index ?? -1;

  for (const item of virtualItems) {
    if (item.start > scrollOffset) break;
    activeIndex = item.index;
  }

  return activeIndex;
}
