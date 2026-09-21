import type { SearchExcerpt } from "./search-excerpts";

const FILE_HEADER_HEIGHT = 29;
const CODE_VERTICAL_PADDING = 16;
const SECTION_DIVIDER_HEIGHT = 1;

/**
 * Placeholder height for a search excerpt whose body the multibuffer has not
 * mounted yet, so scrolling through many files keeps a stable scrollbar.
 */
export function estimateSearchExcerptHeight(
  excerpt: SearchExcerpt | undefined,
  lineHeight: number,
) {
  const lineCount = excerpt?.lineNumberMap.length ?? 1;
  return (
    FILE_HEADER_HEIGHT + CODE_VERTICAL_PADDING + SECTION_DIVIDER_HEIGHT + lineCount * lineHeight
  );
}
