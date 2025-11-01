export type LineEnding = "\n" | "\r\n" | "\r";

const DEFAULT_LINE_ENDING: LineEnding = "\n";

/**
 * Detect the predominant line ending style in a text buffer.
 * Defaults to LF when no explicit carriage returns are present.
 */
export function detectLineEnding(content: string): LineEnding {
  if (content.includes("\r\n")) {
    return "\r\n";
  }
  if (content.includes("\r")) {
    return "\r";
  }
  return DEFAULT_LINE_ENDING;
}

/**
 * Normalize a text buffer to LF while retaining the original line ending style.
 */
export function normalizeLineEndings(content: string): {
  normalized: string;
  lineEnding: LineEnding;
} {
  const lineEnding = detectLineEnding(content);

  if (lineEnding === "\n") {
    return {
      normalized: content,
      lineEnding,
    };
  }

  return {
    normalized: content.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    lineEnding,
  };
}

/**
 * Reapply a desired line ending style to normalized LF content.
 */
export function applyLineEnding(content: string, lineEnding: LineEnding): string {
  if (lineEnding === "\n") {
    return content;
  }

  const replacement = lineEnding === "\r\n" ? "\r\n" : "\r";
  return content.replace(/\r?\n/g, replacement);
}
