export interface BracketMatchResult {
  activeOffset: number;
  matchingOffset: number | null;
  activeBracket: string;
  matchingBracket: string;
  direction: "forward" | "backward";
}

export interface BracketMatchOptions {
  maxScanChars?: number;
}

export interface BracketJumpTarget {
  offset: number;
  reason: "matching" | "enclosing" | "next";
}

export interface BracketSelectionRange {
  startOffset: number;
  endOffset: number;
}

export interface BracketPairRange {
  openOffset: number;
  closeOffset: number;
}

export interface BracketRemovalResult {
  content: string;
  cursorOffset: number;
}

export interface BracketSelectionOptions extends BracketMatchOptions {
  selectBrackets?: boolean;
}

const OPEN_TO_CLOSE = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

const CLOSE_TO_OPEN = new Map(Array.from(OPEN_TO_CLOSE, ([open, close]) => [close, open]));
const DEFAULT_MAX_SCAN_CHARS = 200_000;

function getBracketDirection(char: string): {
  bracket: string;
  matchingBracket: string;
  direction: "forward" | "backward";
} | null {
  const forwardMatch = OPEN_TO_CLOSE.get(char);
  if (forwardMatch) {
    return { bracket: char, matchingBracket: forwardMatch, direction: "forward" };
  }

  const backwardMatch = CLOSE_TO_OPEN.get(char);
  if (backwardMatch) {
    return { bracket: char, matchingBracket: backwardMatch, direction: "backward" };
  }

  return null;
}

function findBracketNearCursor(content: string, cursorOffset: number) {
  const clampedOffset = Math.max(0, Math.min(cursorOffset, content.length));
  const previousOffset = clampedOffset - 1;

  if (previousOffset >= 0) {
    const previous = getBracketDirection(content[previousOffset]);
    if (previous) {
      return { offset: previousOffset, ...previous };
    }
  }

  if (clampedOffset < content.length) {
    const current = getBracketDirection(content[clampedOffset]);
    if (current) {
      return { offset: clampedOffset, ...current };
    }
  }

  return null;
}

function findForwardMatch(
  content: string,
  activeOffset: number,
  openBracket: string,
  closeBracket: string,
  maxScanChars: number,
): number | null {
  let depth = 0;
  const scanEnd = Math.min(content.length, activeOffset + maxScanChars + 1);

  for (let offset = activeOffset + 1; offset < scanEnd; offset++) {
    const char = content[offset];
    if (char === openBracket) {
      depth++;
    } else if (char === closeBracket) {
      if (depth === 0) return offset;
      depth--;
    }
  }

  return null;
}

function findBackwardMatch(
  content: string,
  activeOffset: number,
  closeBracket: string,
  openBracket: string,
  maxScanChars: number,
): number | null {
  let depth = 0;
  const scanStart = Math.max(0, activeOffset - maxScanChars);

  for (let offset = activeOffset - 1; offset >= scanStart; offset--) {
    const char = content[offset];
    if (char === closeBracket) {
      depth++;
    } else if (char === openBracket) {
      if (depth === 0) return offset;
      depth--;
    }
  }

  return null;
}

function findEnclosingBracketTarget(
  content: string,
  cursorOffset: number,
  maxScanChars: number,
): BracketPairRange | null {
  const stack: Array<{ bracket: string; offset: number }> = [];
  const clampedOffset = Math.max(0, Math.min(cursorOffset, content.length));
  const scanStart = Math.max(0, clampedOffset - maxScanChars);

  for (let offset = scanStart; offset < clampedOffset; offset++) {
    const char = content[offset];
    const closingBracket = OPEN_TO_CLOSE.get(char);
    if (closingBracket) {
      stack.push({ bracket: char, offset });
      continue;
    }

    const openingBracket = CLOSE_TO_OPEN.get(char);
    if (!openingBracket) continue;

    const lastOpen = stack[stack.length - 1];
    if (lastOpen?.bracket === openingBracket) {
      stack.pop();
    }
  }

  for (let index = stack.length - 1; index >= 0; index--) {
    const open = stack[index];
    if (!open) continue;

    const closeBracket = OPEN_TO_CLOSE.get(open.bracket);
    if (!closeBracket) continue;

    const matchOffset = findForwardMatch(
      content,
      open.offset,
      open.bracket,
      closeBracket,
      maxScanChars,
    );
    if (matchOffset != null && matchOffset >= clampedOffset) {
      return { openOffset: open.offset, closeOffset: matchOffset };
    }
  }

  return null;
}

function findNextBracketTarget(
  content: string,
  cursorOffset: number,
  maxScanChars: number,
): number | null {
  const clampedOffset = Math.max(0, Math.min(cursorOffset, content.length));
  const scanEnd = Math.min(content.length, clampedOffset + maxScanChars + 1);

  for (let offset = clampedOffset; offset < scanEnd; offset++) {
    if (getBracketDirection(content[offset])) {
      return offset;
    }
  }

  return null;
}

function getPairFromMatch(match: BracketMatchResult): BracketPairRange | null {
  if (match.matchingOffset == null) return null;

  if (match.direction === "forward") {
    return { openOffset: match.activeOffset, closeOffset: match.matchingOffset };
  }

  return { openOffset: match.matchingOffset, closeOffset: match.activeOffset };
}

function findNextBracketPair(
  content: string,
  cursorOffset: number,
  maxScanChars: number,
): BracketPairRange | null {
  const nextOffset = findNextBracketTarget(content, cursorOffset, maxScanChars);
  if (nextOffset == null) return null;

  const match = findMatchingBracketAtCursor(content, nextOffset, { maxScanChars });
  if (!match) return null;

  return getPairFromMatch(match);
}

function findBracketPairAtCursorOrEnclosing(
  content: string,
  cursorOffset: number,
  maxScanChars: number,
): BracketPairRange | null {
  const directMatch = findMatchingBracketAtCursor(content, cursorOffset, {
    maxScanChars,
  });

  return (
    (directMatch ? getPairFromMatch(directMatch) : null) ??
    findEnclosingBracketTarget(content, cursorOffset, maxScanChars)
  );
}

export function findMatchingBracketAtCursor(
  content: string,
  cursorOffset: number,
  { maxScanChars = DEFAULT_MAX_SCAN_CHARS }: BracketMatchOptions = {},
): BracketMatchResult | null {
  const active = findBracketNearCursor(content, cursorOffset);
  if (!active) return null;

  const safeMaxScanChars = Math.max(0, Math.floor(maxScanChars));
  const matchingOffset =
    active.direction === "forward"
      ? findForwardMatch(
          content,
          active.offset,
          active.bracket,
          active.matchingBracket,
          safeMaxScanChars,
        )
      : findBackwardMatch(
          content,
          active.offset,
          active.bracket,
          active.matchingBracket,
          safeMaxScanChars,
        );

  return {
    activeOffset: active.offset,
    matchingOffset,
    activeBracket: active.bracket,
    matchingBracket: active.matchingBracket,
    direction: active.direction,
  };
}

export function findBracketJumpTarget(
  content: string,
  cursorOffset: number,
  { maxScanChars = DEFAULT_MAX_SCAN_CHARS }: BracketMatchOptions = {},
): BracketJumpTarget | null {
  const safeMaxScanChars = Math.max(0, Math.floor(maxScanChars));
  const directMatch = findMatchingBracketAtCursor(content, cursorOffset, {
    maxScanChars: safeMaxScanChars,
  });
  if (directMatch?.matchingOffset != null) {
    return { offset: directMatch.matchingOffset, reason: "matching" };
  }

  const enclosingOffset = findEnclosingBracketTarget(content, cursorOffset, safeMaxScanChars);
  if (enclosingOffset != null) {
    return { offset: enclosingOffset.closeOffset, reason: "enclosing" };
  }

  const nextOffset = findNextBracketTarget(content, cursorOffset, safeMaxScanChars);
  if (nextOffset != null) {
    return { offset: nextOffset, reason: "next" };
  }

  return null;
}

export function findBracketSelectionRange(
  content: string,
  cursorOffset: number,
  { maxScanChars = DEFAULT_MAX_SCAN_CHARS, selectBrackets = true }: BracketSelectionOptions = {},
): BracketSelectionRange | null {
  const safeMaxScanChars = Math.max(0, Math.floor(maxScanChars));
  const pair =
    findBracketPairAtCursorOrEnclosing(content, cursorOffset, safeMaxScanChars) ??
    findNextBracketPair(content, cursorOffset, safeMaxScanChars);

  if (!pair) return null;

  const startOffset = selectBrackets ? pair.openOffset : pair.openOffset + 1;
  const endOffset = selectBrackets ? pair.closeOffset + 1 : pair.closeOffset;

  return {
    startOffset: Math.min(startOffset, endOffset),
    endOffset: Math.max(startOffset, endOffset),
  };
}

export function removeBracketPairAtCursor(
  content: string,
  cursorOffset: number,
  { maxScanChars = DEFAULT_MAX_SCAN_CHARS }: BracketMatchOptions = {},
): BracketRemovalResult | null {
  const safeMaxScanChars = Math.max(0, Math.floor(maxScanChars));
  const pair = findBracketPairAtCursorOrEnclosing(content, cursorOffset, safeMaxScanChars);
  if (!pair) return null;

  const withoutClose = content.slice(0, pair.closeOffset) + content.slice(pair.closeOffset + 1);
  const nextContent =
    withoutClose.slice(0, pair.openOffset) + withoutClose.slice(pair.openOffset + 1);

  let nextCursorOffset = cursorOffset;
  if (cursorOffset > pair.closeOffset) {
    nextCursorOffset -= 2;
  } else if (cursorOffset > pair.openOffset) {
    nextCursorOffset -= 1;
  }

  return {
    content: nextContent,
    cursorOffset: Math.max(0, Math.min(nextCursorOffset, nextContent.length)),
  };
}
