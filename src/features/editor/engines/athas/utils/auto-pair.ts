export const AUTO_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  '"': '"',
  "'": "'",
  "`": "`",
};

const AUTO_PAIR_CLOSERS = new Set(Object.values(AUTO_PAIRS));

export interface AutoPairEdit {
  start: number;
  end: number;
  insertText: string;
  cursorOffset: number;
  selectionStartOffset?: number;
  selectionEndOffset?: number;
}

export interface AutoPairDeleteRange {
  start: number;
  end: number;
}

export function getAutoPairSkipOffset(
  key: string,
  content: string,
  selectionStart: number,
  selectionEnd: number,
): number | null {
  if (key.length !== 1 || selectionStart !== selectionEnd || !AUTO_PAIR_CLOSERS.has(key)) {
    return null;
  }

  return content[selectionStart] === key ? selectionStart + 1 : null;
}

export function getAutoPairEdit(
  key: string,
  content: string,
  selectionStart: number,
  selectionEnd: number,
): AutoPairEdit | null {
  const closingPair = AUTO_PAIRS[key];
  if (key.length !== 1 || !closingPair) return null;

  const start = Math.max(0, Math.min(selectionStart, selectionEnd, content.length));
  const end = Math.max(start, Math.min(Math.max(selectionStart, selectionEnd), content.length));
  const previousCharacter = start > 0 ? content[start - 1] : "";

  if (key === "'" && /\w/.test(previousCharacter)) {
    return null;
  }

  const selectedText = content.slice(start, end);
  const selectionStartOffset = selectedText.length > 0 ? start + 1 : undefined;
  const selectionEndOffset = selectedText.length > 0 ? start + 1 + selectedText.length : undefined;

  return {
    start,
    end,
    insertText: key + selectedText + closingPair,
    cursorOffset: 1,
    selectionStartOffset,
    selectionEndOffset,
  };
}

export function getAutoPairDeleteRange(
  content: string,
  offset: number,
): AutoPairDeleteRange | null {
  const safeOffset = Math.max(0, Math.min(offset, content.length));
  if (safeOffset <= 0) return null;

  const leftCharacter = content[safeOffset - 1];
  const rightCharacter = content[safeOffset] || "";
  const expectedRightCharacter = AUTO_PAIRS[leftCharacter];

  if (!expectedRightCharacter || rightCharacter !== expectedRightCharacter) {
    return null;
  }

  return {
    start: safeOffset - 1,
    end: safeOffset + 1,
  };
}

export function applyAutoPairEdit(content: string, edit: AutoPairEdit): string {
  return content.slice(0, edit.start) + edit.insertText + content.slice(edit.end);
}
