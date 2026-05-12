export type TokenLike = { start: number; end: number; class_name: string };
export type Span = { text: string; className: string };
export type Line = Span[];

const DEFAULT_CLASS = "token-text";

/**
 * Convert a `text` + a sorted, non-overlapping `tokens` array into an array of
 * lines, each line an array of styled spans. Gaps in token coverage are filled
 * with `token-default`. Token boundaries that straddle newlines are split.
 * CRLF sequences (`\r\n`) are normalized to `\n` before processing so that
 * rendered spans never contain a trailing `\r`.
 */
export function buildTokenSpans(text: string, tokens: TokenLike[]): Line[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (normalized.length === 0) return [[]];

  // Normalize: produce a list of spans that covers [0, normalized.length) end-to-end,
  // filling gaps with the default class.
  const covered: TokenLike[] = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start > cursor) {
      covered.push({ start: cursor, end: t.start, class_name: DEFAULT_CLASS });
    }
    covered.push(t);
    cursor = t.end;
  }
  if (cursor < normalized.length) {
    covered.push({ start: cursor, end: normalized.length, class_name: DEFAULT_CLASS });
  }

  // Split spans across newlines and group into lines.
  const lines: Line[] = [[]];
  for (const span of covered) {
    let i = span.start;
    while (i < span.end) {
      const newlineIdx = normalized.indexOf("\n", i);
      const stop = newlineIdx === -1 || newlineIdx >= span.end ? span.end : newlineIdx;
      if (stop > i) {
        lines[lines.length - 1].push({
          text: normalized.slice(i, stop),
          className: span.class_name,
        });
      }
      if (stop === newlineIdx && newlineIdx < span.end) {
        lines.push([]);
        i = newlineIdx + 1;
      } else {
        i = stop;
      }
    }
  }
  return lines;
}
