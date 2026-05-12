export function isWordCharCode(charCode: number): boolean {
  return (
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122) ||
    charCode === 95
  );
}

export interface WordOffsetRange {
  start: number;
  end: number;
}

export function getPreviousWordOffset(content: string, offset: number): number {
  let index = Math.max(0, Math.min(offset, content.length)) - 1;

  while (index > 0 && !isWordCharCode(content.charCodeAt(index))) {
    index--;
  }
  while (index > 0 && isWordCharCode(content.charCodeAt(index - 1))) {
    index--;
  }

  return Math.max(0, index);
}

export function getNextWordOffset(content: string, offset: number): number {
  let index = Math.max(0, Math.min(offset, content.length));

  while (index < content.length && isWordCharCode(content.charCodeAt(index))) {
    index++;
  }
  while (index < content.length && !isWordCharCode(content.charCodeAt(index))) {
    index++;
  }

  return index;
}

export function getWordRangeAtOffset(content: string, offset: number): WordOffsetRange | null {
  const clampedOffset = Math.max(0, Math.min(offset, content.length));
  let index = clampedOffset;

  if (
    !isWordCharCode(content.charCodeAt(index)) &&
    index > 0 &&
    isWordCharCode(content.charCodeAt(index - 1))
  ) {
    index--;
  }

  if (!isWordCharCode(content.charCodeAt(index))) {
    return null;
  }

  let start = index;
  let end = index + 1;

  while (start > 0 && isWordCharCode(content.charCodeAt(start - 1))) {
    start--;
  }

  while (end < content.length && isWordCharCode(content.charCodeAt(end))) {
    end++;
  }

  return { start, end };
}
