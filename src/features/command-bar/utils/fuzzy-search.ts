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

  // Fuzzy matching - check if all query characters exist in order
  let textIndex = 0;
  let queryIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;

  while (textIndex < textLower.length && queryIndex < queryLower.length) {
    if (textLower[textIndex] === queryLower[queryIndex]) {
      score += 10;
      consecutiveMatches++;
      // Bonus for consecutive matches
      if (consecutiveMatches > 1) {
        score += consecutiveMatches * 2;
      }
      queryIndex++;
    } else {
      consecutiveMatches = 0;
    }
    textIndex++;
  }

  // If we matched all query characters, it's a valid fuzzy match
  if (queryIndex === queryLower.length) {
    // Bonus for shorter text (more precise match)
    score += Math.max(0, 100 - textLower.length);
    return score;
  }

  return 0; // No match
};
