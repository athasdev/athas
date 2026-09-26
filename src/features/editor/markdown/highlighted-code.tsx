import { type ReactNode, useEffect, useState } from "react";
import { type CodeHighlightSegment, getCodeHighlightSegments } from "./code-highlight";

/** Highlight segments for `code`, loaded in the background; empty until they arrive. */
export function useCodeHighlightSegments(
  code: string,
  language: string | undefined,
): CodeHighlightSegment[] {
  const [segments, setSegments] = useState<CodeHighlightSegment[]>([]);

  useEffect(() => {
    let cancelled = false;
    setSegments([]);
    if (!language || !code) return;

    void getCodeHighlightSegments(code, language).then((nextSegments) => {
      if (!cancelled) setSegments(nextSegments);
    });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return segments;
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
