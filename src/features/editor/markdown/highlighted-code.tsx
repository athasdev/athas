import { type ReactNode, useEffect, useState } from "react";
import { type CodeHighlightSegment, getCodeHighlightSegments } from "./services/code-highlight";

const NO_SEGMENTS: CodeHighlightSegment[] = [];
/** How long code must stop changing before its unfinished last line is highlighted too. */
const SETTLE_MS = 120;

/**
 * Highlight segments for `code`, loaded in the background. Segments computed for an earlier
 * version stay in use while the code only grows, so a streamed code block keeps its colours
 * instead of flashing plain on every chunk. Whole lines are highlighted right away; a trailing
 * partial line waits until the code settles.
 */
export function useCodeHighlightSegments(
  code: string,
  language: string | undefined,
): CodeHighlightSegment[] {
  const [result, setResult] = useState<{
    code: string;
    language: string | undefined;
    segments: CodeHighlightSegment[];
  }>({ code: "", language, segments: NO_SEGMENTS });

  useEffect(() => {
    if (!language || !code) return;
    let cancelled = false;
    const highlight = (target: string) => {
      void getCodeHighlightSegments(target, language).then((segments) => {
        if (!cancelled) setResult({ code: target, language, segments });
      });
    };

    const lineEnd = code.lastIndexOf("\n") + 1;
    const hasPartialLine = lineEnd > 0 && lineEnd < code.length;
    if (hasPartialLine) highlight(code.slice(0, lineEnd));
    const settle = setTimeout(() => highlight(code), hasPartialLine ? SETTLE_MS : 0);

    return () => {
      cancelled = true;
      clearTimeout(settle);
    };
  }, [code, language]);

  if (!language || !code) return NO_SEGMENTS;
  return result.language === language && code.startsWith(result.code)
    ? result.segments
    : NO_SEGMENTS;
}

/**
 * `code` with its highlight segments wrapped in token spans. `offset` shifts the segments when
 * `code` is a slice of the text they were computed for, such as one line of a diff.
 */
export function HighlightedCode({
  code,
  segments,
  offset = 0,
}: {
  code: string;
  segments: CodeHighlightSegment[];
  offset?: number;
}) {
  if (segments.length === 0) return <>{code}</>;

  const end = offset + code.length;
  const elements: ReactNode[] = [];
  let cursor = 0;

  for (const segment of segments) {
    if (segment.end <= offset) continue;
    if (segment.start >= end) break;

    const start = Math.max(segment.start, offset) - offset;
    const stop = Math.min(segment.end, end) - offset;
    if (start > cursor) elements.push(code.slice(cursor, start));
    elements.push(
      <span key={`${segment.start}-${segment.end}`} className={segment.className}>
        {code.slice(start, stop)}
      </span>,
    );
    cursor = stop;
  }

  if (cursor < code.length) elements.push(code.slice(cursor));
  return <>{elements}</>;
}
