export type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
};

export type SearchMatch = {
  start: number;
  end: number;
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
export function findAllMatches(content: string, regex: RegExp): SearchMatch[] {
  const matches: SearchMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex to ensure we start from the beginning
  regex.lastIndex = 0;

  match = regex.exec(content);
  while (match !== null) {
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
