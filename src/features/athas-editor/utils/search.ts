export type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
};

export type SearchMatch = {
  start: number;
  end: number;
};

export type LimitedSearchMatches = {
  matches: SearchMatch[];
  limited: boolean;
};

export type SearchViewportOffsetRange = {
  startOffset: number;
  endOffset: number;
};

export type CooperativeSearchOptions = {
  shouldCancel?: () => boolean;
  yieldEveryMs?: number;
};

/**
 * Builds a RegExp based on the search query and options.
 * Returns null if the query is empty or invalid regex when useRegex is true.
 */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null;

  let pattern = query;

  // Escape regex special characters unless using regex mode
  if (!options.useRegex) {
    pattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Wrap with word boundaries if whole word matching
  if (options.wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }

  // Build flags
  const flags = options.caseSensitive ? "g" : "gi";

  try {
    return new RegExp(pattern, flags);
  } catch {
    // Invalid regex pattern
    return null;
  }
}

/**
 * Finds all matches of a regex in the given content.
 */
export function findAllMatches(
  content: string,
  regex: RegExp,
  limitResultCount = Number.POSITIVE_INFINITY,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex to ensure we start from the beginning
  regex.lastIndex = 0;

  match = regex.exec(content);
  while (match !== null && matches.length < limitResultCount) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
    });

    // Prevent infinite loop on zero-width matches
    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }

    match = regex.exec(content);
  }

  return matches;
}

export function findLimitedMatches(
  content: string,
  regex: RegExp,
  limitResultCount: number,
): LimitedSearchMatches {
  const sentinelLimit = Math.max(0, Math.floor(limitResultCount)) + 1;
  const matches = findAllMatches(content, regex, sentinelLimit);
  const limited = matches.length >= sentinelLimit;

  return {
    matches: limited ? matches.slice(0, limitResultCount) : matches,
    limited,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function findLimitedMatchesCooperative(
  content: string,
  regex: RegExp,
  limitResultCount: number,
  { shouldCancel, yieldEveryMs = 8 }: CooperativeSearchOptions = {},
): Promise<LimitedSearchMatches | null> {
  const sentinelLimit = Math.max(0, Math.floor(limitResultCount)) + 1;
  const matches: SearchMatch[] = [];
  let lastYieldAt = performance.now();

  regex.lastIndex = 0;
  let match = regex.exec(content);

  while (match !== null && matches.length < sentinelLimit) {
    if (shouldCancel?.()) return null;

    matches.push({
      start: match.index,
      end: match.index + match[0].length,
    });

    if (match.index === regex.lastIndex) {
      regex.lastIndex++;
    }

    const now = performance.now();
    if (now - lastYieldAt >= yieldEveryMs) {
      await yieldToEventLoop();
      if (shouldCancel?.()) return null;
      lastYieldAt = performance.now();
    }

    match = regex.exec(content);
  }

  if (shouldCancel?.()) return null;

  const limited = matches.length >= sentinelLimit;
  return {
    matches: limited ? matches.slice(0, limitResultCount) : matches,
    limited,
  };
}

export function getSearchViewportOffsetRange(
  lineOffsets: readonly number[],
  contentLength: number,
  startLine: number,
  endLine: number,
): SearchViewportOffsetRange {
  const clampedStartLine = Math.max(0, Math.min(startLine, lineOffsets.length));
  const clampedEndLine = Math.max(clampedStartLine, Math.min(endLine, lineOffsets.length));

  return {
    startOffset: lineOffsets[clampedStartLine] ?? 0,
    endOffset:
      clampedEndLine >= lineOffsets.length
        ? contentLength
        : (lineOffsets[clampedEndLine] ?? contentLength),
  };
}

export function searchMatchOverlapsOffsetRange(
  match: SearchMatch,
  range: SearchViewportOffsetRange,
): boolean {
  const start = Math.min(match.start, match.end);
  const end = Math.max(match.start, match.end);

  return end > range.startOffset && start < range.endOffset;
}

export function getSearchMatchesInOffsetRange(
  matches: readonly SearchMatch[],
  range: SearchViewportOffsetRange,
): Array<{ match: SearchMatch; index: number }> {
  const visibleMatches: Array<{ match: SearchMatch; index: number }> = [];
  let low = 0;
  let high = matches.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const match = matches[mid];
    const end = Math.max(match.start, match.end);
    if (end <= range.startOffset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  for (let index = low; index < matches.length; index++) {
    const match = matches[index];
    const start = Math.min(match.start, match.end);
    if (start >= range.endOffset) break;
    if (searchMatchOverlapsOffsetRange(match, range)) {
      visibleMatches.push({ match, index });
    }
  }

  return visibleMatches;
}
