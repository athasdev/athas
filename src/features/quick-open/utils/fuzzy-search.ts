export const fuzzyScore = (text: string, query: string): number => {
  if (!query) return 0;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  if (textLower === queryLower) return 1000;
  if (textLower.startsWith(queryLower)) return 800;
  if (textLower.includes(queryLower)) return 600;

  // For short queries, only allow substring matches (handled above)
  if (queryLower.length <= 2) return 0;

  // Early exit: if the first query char doesn't appear in text, skip fuzzy
  if (!textLower.includes(queryLower[0])) return 0;

  // Fuzzy matching - require minimum density to avoid garbage results
  let textIndex = 0;
  let queryIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;
  let totalGaps = 0;

  while (textIndex < textLower.length && queryIndex < queryLower.length) {
    if (textLower[textIndex] === queryLower[queryIndex]) {
      score += 10;
      consecutiveMatches++;
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

  if (queryIndex === queryLower.length) {
    if (totalGaps > queryLower.length) return 0;

    score += Math.max(0, 100 - textLower.length);
    score -= totalGaps * 10;

    return Math.max(score, 1);
  }

  return 0;
};
