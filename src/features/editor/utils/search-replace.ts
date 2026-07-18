import type { SearchMatch } from "./search";

export interface ReplaceSearchMatchResult {
  content: string;
  matches: SearchMatch[];
  currentMatchIndex: number;
}

export interface ReplaceSearchOptions {
  preserveCase?: boolean;
}

function hasLetters(value: string): boolean {
  return /[a-z]/i.test(value);
}

function isUpperCase(value: string): boolean {
  return hasLetters(value) && value === value.toUpperCase();
}

function isLowerCase(value: string): boolean {
  return hasLetters(value) && value === value.toLowerCase();
}

function isTitleCase(value: string): boolean {
  if (!hasLetters(value)) return false;

  const firstLetterIndex = value.search(/[a-z]/i);
  if (firstLetterIndex === -1) return false;

  const firstLetter = value[firstLetterIndex];
  const rest = `${value.slice(0, firstLetterIndex)}${value.slice(firstLetterIndex + 1)}`;
  return firstLetter === firstLetter.toUpperCase() && rest === rest.toLowerCase();
}

export function applyReplacementCase(replacement: string, matchedText: string): string {
  if (!replacement || !hasLetters(matchedText)) return replacement;
  if (isUpperCase(matchedText)) return replacement.toUpperCase();
  if (isLowerCase(matchedText)) return replacement.toLowerCase();

  if (isTitleCase(matchedText)) {
    const firstLetterIndex = replacement.search(/[a-z]/i);
    if (firstLetterIndex === -1) return replacement;

    return `${replacement.slice(0, firstLetterIndex)}${replacement[firstLetterIndex].toUpperCase()}${replacement
      .slice(firstLetterIndex + 1)
      .toLowerCase()}`;
  }

  return replacement;
}

export function replaceSearchMatch(
  content: string,
  matches: readonly SearchMatch[],
  currentMatchIndex: number,
  replacement: string,
  options: ReplaceSearchOptions = {},
): ReplaceSearchMatchResult | null {
  const match = matches[currentMatchIndex];
  if (!match) return null;

  const matchedText = content.slice(match.start, match.end);
  const nextReplacement = options.preserveCase
    ? applyReplacementCase(replacement, matchedText)
    : replacement;
  const contentBeforeMatch = content.slice(0, match.start);
  const contentAfterMatch = content.slice(match.end);
  const nextContent = `${contentBeforeMatch}${nextReplacement}${contentAfterMatch}`;
  const lengthDelta = nextReplacement.length - (match.end - match.start);
  const nextMatches = matches
    .filter((_, index) => index !== currentMatchIndex)
    .map((candidate) =>
      candidate.start > match.start
        ? {
            start: candidate.start + lengthDelta,
            end: candidate.end + lengthDelta,
          }
        : candidate,
    );

  return {
    content: nextContent,
    matches: nextMatches,
    currentMatchIndex:
      nextMatches.length > 0 ? Math.min(currentMatchIndex, nextMatches.length - 1) : -1,
  };
}

export function replaceAllSearchMatches(
  content: string,
  matches: readonly SearchMatch[],
  replacement: string,
  options: ReplaceSearchOptions = {},
): string {
  let nextContent = content;
  const sortedMatches = [...matches].sort((left, right) => right.start - left.start);

  for (const match of sortedMatches) {
    const matchedText = nextContent.slice(match.start, match.end);
    const nextReplacement = options.preserveCase
      ? applyReplacementCase(replacement, matchedText)
      : replacement;
    nextContent = `${nextContent.slice(0, match.start)}${nextReplacement}${nextContent.slice(match.end)}`;
  }

  return nextContent;
}
