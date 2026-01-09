/**
 * Fuzzy search scoring function
 * @param text - The text to search in
 * @param query - The search query
 * @returns Score (higher is better, 0 means no match)
 */
export const fuzzyScore = (text: string, query: string): number => {
  if (!query) return 0;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match gets highest score
  if (textLower === queryLower) return 1000;

  // Starts with query gets high score
  if (textLower.startsWith(queryLower)) return 800;

  // Contains query as substring gets medium score
  if (textLower.includes(queryLower)) return 600;

  // For very short queries (1-2 chars), don't do fuzzy matching
  // Only substring matches (handled above) are allowed for short queries
  if (queryLower.length <= 2) return 0;

  // Fuzzy matching - check if all query characters exist in order
  // But require a minimum density of matches to avoid garbage results
  let textIndex = 0;
  let queryIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;
  let totalGaps = 0;

  while (textIndex < textLower.length && queryIndex < queryLower.length) {
    if (textLower[textIndex] === queryLower[queryIndex]) {
      score += 10;
      consecutiveMatches++;
      // Bonus for consecutive matches
      if (consecutiveMatches > 1) {
        score += consecutiveMatches * 5;
      }
      queryIndex++;
    } else {
      if (consecutiveMatches > 0) {
        totalGaps++;
      }
      consecutiveMatches = 0;
    }
    textIndex++;
  }

  // If we matched all query characters, it's a valid fuzzy match
  if (queryIndex === queryLower.length) {
    // Penalize matches that are too spread out (too many gaps)
    // If gaps exceed query length, it's probably a garbage match
    if (totalGaps > queryLower.length) {
      return 0;
    }

    // Bonus for shorter text (more precise match)
    score += Math.max(0, 100 - textLower.length);

    // Penalize based on how spread out the match is
    score -= totalGaps * 10;

    return Math.max(score, 1);
  }

  return 0; // No match
};
