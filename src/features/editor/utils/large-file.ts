export const LARGE_FILE_CHAR_THRESHOLD = 300_000;
export const LARGE_FILE_LINE_THRESHOLD = 4_000;

const NEWLINE_CHAR_CODE = 10; // "\n"

export function countLinesUpTo(content: string, limit: number): number {
  if (!content) return 0;

  let lines = 1;
  const cappedLimit = Math.max(limit, 1);

  for (let i = 0; i < content.length && lines <= cappedLimit; i++) {
    if (content.charCodeAt(i) === NEWLINE_CHAR_CODE) {
      lines++;
      if (lines > cappedLimit) {
        return lines;
      }
    }
  }

  return lines;
}

export function isLargeFile(
  content: string,
  charThreshold: number = LARGE_FILE_CHAR_THRESHOLD,
  lineThreshold: number = LARGE_FILE_LINE_THRESHOLD,
): boolean {
  if (!content) return false;
  if (content.length >= charThreshold) return true;
  return countLinesUpTo(content, lineThreshold) > lineThreshold;
}

export function getLargeFileMeta(content: string): {
  isLarge: boolean;
  approxLineCount: number;
} {
  if (!content) {
    return { isLarge: false, approxLineCount: 0 };
  }

  const approxLineCount = countLinesUpTo(content, LARGE_FILE_LINE_THRESHOLD + 1);
  const isLarge =
    content.length >= LARGE_FILE_CHAR_THRESHOLD || approxLineCount > LARGE_FILE_LINE_THRESHOLD;

  return { isLarge, approxLineCount };
}

export async function waitForIdle(timeoutMs = 200): Promise<void> {
  if (typeof requestIdleCallback === "function") {
    return new Promise((resolve) => {
      requestIdleCallback(() => resolve(), { timeout: timeoutMs });
    });
  }

  return new Promise((resolve) => setTimeout(resolve, 0));
}
