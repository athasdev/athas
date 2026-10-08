import { useEffect, useId, useState } from "react";
import { highlightMarkdownCodeBlocks } from "./code-highlight";
import { MarkdownRenderSupersededError, markdownRenderClient } from "./markdown-render-client";
import { parseMarkdown, sanitizeMarkdown, type ParseMarkdownOptions } from "./parser";

interface HighlightedMarkdownOptions extends ParseMarkdownOptions {
  /** Wait for edits to pause this long before parsing again. */
  debounceMs?: number;
  /** A change of source (another file) is parsed at once rather than after the pause. */
  sourceKey?: string;
}

interface ParsedMarkdown {
  input: string | null | undefined;
  frontMatter: ParseMarkdownOptions["frontMatter"];
  sourceKey: string | undefined;
  html: string;
}

const CODE_BLOCK_MARKER = '<pre><code class="language-';

function parseHere(
  input: string | null | undefined,
  frontMatter: ParseMarkdownOptions["frontMatter"],
  sourceKey: string | undefined,
): ParsedMarkdown {
  return {
    input,
    frontMatter,
    sourceKey,
    html: input ? parseMarkdown(input, { frontMatter }) : "",
  };
}

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

  // The first parse of a source runs here so the preview is never blank. A debounced re-parse of
  // the same source renders in a worker and keeps the last HTML until it is ready; only
  // sanitizing, which needs the DOM, stays on this thread.
  const [parsed, setParsed] = useState<ParsedMarkdown>(() =>
    parseHere(parseInput, frontMatter, sourceKey),
  );
  const parsedIsCurrent =
    parsed.input === parseInput &&
    parsed.frontMatter === frontMatter &&
    parsed.sourceKey === sourceKey;
  const parseOffThread =
    !parsedIsCurrent &&
    Boolean(parseInput) &&
    debounceMs > 0 &&
    Boolean(parsed.input) &&
    parsed.sourceKey === sourceKey &&
    markdownRenderClient.canRenderOffThread();
  if (!parsedIsCurrent && !parseOffThread) {
    setParsed(parseHere(parseInput, frontMatter, sourceKey));
  }

  useEffect(() => {
    if (!parseOffThread || !parseInput) return;
    let cancelled = false;
    markdownRenderClient.render(requestKey, parseInput, { frontMatter }).then(
      (markdown) => {
        if (!cancelled) {
          setParsed({
            input: parseInput,
            frontMatter,
            sourceKey,
            html: sanitizeMarkdown(markdown),
          });
        }
      },
      (error: unknown) => {
        if (!cancelled && !(error instanceof MarkdownRenderSupersededError)) {
          setParsed(parseHere(parseInput, frontMatter, sourceKey));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [frontMatter, parseInput, parseOffThread, requestKey, sourceKey]);

  useEffect(() => () => markdownRenderClient.cancel(requestKey), [requestKey]);

  const parsedHtml = parsed.html;
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
