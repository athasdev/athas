import { useEffect, useId, useMemo, useState } from "react";
import { highlightMarkdownCodeBlocks } from "./code-highlight";
import { parseMarkdown, type ParseMarkdownOptions } from "./parser";

interface HighlightedMarkdownOptions extends ParseMarkdownOptions {
  /** Wait for edits to pause this long before parsing again. */
  debounceMs?: number;
  /** A change of source (another file) is parsed at once rather than after the pause. */
  sourceKey?: string;
}

const CODE_BLOCK_MARKER = '<pre><code class="language-';

export function useHighlightedMarkdown(
  content: string | null | undefined,
  options?: HighlightedMarkdownOptions,
) {
  const frontMatter = options?.frontMatter;
  const debounceMs = options?.debounceMs ?? 0;
  const sourceKey = options?.sourceKey;
  const requestKey = `markdown-preview:${useId()}`;
  const [settled, setSettled] = useState({ content, sourceKey });
  const parseNow = debounceMs <= 0 || !settled.content || settled.sourceKey !== sourceKey;
  if (parseNow && (settled.content !== content || settled.sourceKey !== sourceKey)) {
    setSettled({ content, sourceKey });
  }
  const parseInput = parseNow ? content : settled.content;

  useEffect(() => {
    if (parseNow || settled.content === content) return;
    const timer = setTimeout(() => setSettled({ content, sourceKey }), debounceMs);
    return () => clearTimeout(timer);
  }, [content, debounceMs, parseNow, settled.content, sourceKey]);

  const parsedHtml = useMemo(() => {
    if (!parseInput) return "";
    return parseMarkdown(parseInput, { frontMatter });
  }, [parseInput, frontMatter]);
  const [rendered, setRendered] = useState({ html: parsedHtml, sourceKey });

  useEffect(() => {
    const show = (html: string) =>
      setRendered((current) =>
        current.html === html && current.sourceKey === sourceKey ? current : { html, sourceKey },
      );
    if (!parsedHtml.includes(CODE_BLOCK_MARKER)) {
      show(parsedHtml);
      return undefined;
    }

    // A debounced edit to the same source keeps its last highlighted HTML up until the new one is
    // ready, so code does not flash unhighlighted. Anything else shows the new content at once.
    setRendered((current) =>
      debounceMs > 0 && current.html && current.sourceKey === sourceKey
        ? current
        : { html: parsedHtml, sourceKey },
    );
    let cancelled = false;
    void highlightMarkdownCodeBlocks(parsedHtml, requestKey)
      .catch(() => parsedHtml)
      .then((highlightedHtml) => {
        if (!cancelled) show(highlightedHtml);
      });

    return () => {
      cancelled = true;
    };
  }, [debounceMs, parsedHtml, requestKey, sourceKey]);

  return rendered.html;
}
