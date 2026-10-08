import { useEffect, useId, useState } from "react";
import { highlightMarkdownCodeBlocks } from "./code-highlight";
import { MarkdownRenderSupersededError, markdownRenderClient } from "./markdown-render-client";
import {
  MarkdownSanitizeCache,
  parseMarkdownBlocks,
  sanitizeMarkdownBlocks,
  type ParseMarkdownOptions,
} from "./parser";

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
  blocks: string[];
}

const CODE_BLOCK_MARKER = '<pre><code class="language-';
const EMPTY_BLOCKS: string[] = [];
const MIN_HIGHLIGHT_CACHE_ENTRIES = 64;

function parseHere(
  input: string | null | undefined,
  frontMatter: ParseMarkdownOptions["frontMatter"],
  sourceKey: string | undefined,
  cache: MarkdownSanitizeCache,
): ParsedMarkdown {
  return {
    input,
    frontMatter,
    sourceKey,
    blocks: input ? parseMarkdownBlocks(input, { frontMatter }, cache) : EMPTY_BLOCKS,
  };
}

function sameBlocks(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((block, index) => block === right[index]);
}

/** Keeps the highlighted HTML of the blocks in use, plus as many recently used ones. */
function trimHighlightCache(cache: Map<string, string>, inUse: number) {
  const limit = Math.max(MIN_HIGHLIGHT_CACHE_ENTRIES, inUse * 2);
  for (const key of cache.keys()) {
    if (cache.size <= limit) break;
    cache.delete(key);
  }
}

/**
 * The sanitized, code-highlighted HTML of `content`, one string per top-level block. Blocks that
 * did not change keep their sanitized and highlighted HTML from the previous parse.
 */
export function useHighlightedMarkdown(
  content: string | null | undefined,
  options?: HighlightedMarkdownOptions,
): readonly string[] {
  const frontMatter = options?.frontMatter;
  const debounceMs = options?.debounceMs ?? 0;
  const sourceKey = options?.sourceKey;
  const requestKey = `markdown-preview:${useId()}`;
  const [sanitizeCache] = useState(() => new MarkdownSanitizeCache());
  const [highlightCache] = useState(() => new Map<string, string>());
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
  // sanitizing the changed blocks, which needs the DOM, stays on this thread.
  const [parsed, setParsed] = useState<ParsedMarkdown>(() =>
    parseHere(parseInput, frontMatter, sourceKey, sanitizeCache),
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
    setParsed(parseHere(parseInput, frontMatter, sourceKey, sanitizeCache));
  }

  useEffect(() => {
    if (!parseOffThread || !parseInput) return;
    let cancelled = false;
    markdownRenderClient.render(requestKey, parseInput, { frontMatter }).then(
      (markdown) => {
        if (cancelled) return;
        setParsed({
          input: parseInput,
          frontMatter,
          sourceKey,
          blocks: sanitizeMarkdownBlocks(markdown, sanitizeCache),
        });
      },
      (error: unknown) => {
        if (!cancelled && !(error instanceof MarkdownRenderSupersededError)) {
          setParsed(parseHere(parseInput, frontMatter, sourceKey, sanitizeCache));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [frontMatter, parseInput, parseOffThread, requestKey, sanitizeCache, sourceKey]);

  useEffect(() => () => markdownRenderClient.cancel(requestKey), [requestKey]);

  const parsedBlocks = parsed.blocks;
  const [rendered, setRendered] = useState({ blocks: parsedBlocks, sourceKey });

  useEffect(() => {
    const withHighlights = () =>
      parsedBlocks.map((block) => {
        const highlighted = highlightCache.get(block);
        if (highlighted === undefined) return block;
        highlightCache.delete(block);
        highlightCache.set(block, highlighted);
        return highlighted;
      });
    const show = (blocks: string[]) =>
      setRendered((current) =>
        current.sourceKey === sourceKey && sameBlocks(current.blocks, blocks)
          ? current
          : { blocks, sourceKey },
      );
    const pending = [
      ...new Set(
        parsedBlocks.filter(
          (block) => block.includes(CODE_BLOCK_MARKER) && !highlightCache.has(block),
        ),
      ),
    ];
    if (pending.length === 0) {
      show(withHighlights());
      return undefined;
    }

    // A debounced edit to the same source keeps its last highlighted HTML up until the new one is
    // ready, so code does not flash unhighlighted. Anything else shows the new content at once.
    setRendered((current) =>
      debounceMs > 0 && current.blocks.length > 0 && current.sourceKey === sourceKey
        ? current
        : { blocks: withHighlights(), sourceKey },
    );
    let cancelled = false;
    void (async () => {
      for (const [index, block] of pending.entries()) {
        const highlighted = await highlightMarkdownCodeBlocks(
          block,
          `${requestKey}:${index}`,
        ).catch(() => block);
        if (cancelled) return;
        highlightCache.set(block, highlighted);
      }
      trimHighlightCache(highlightCache, parsedBlocks.length);
      show(withHighlights());
    })();

    return () => {
      cancelled = true;
    };
  }, [debounceMs, highlightCache, parsedBlocks, requestKey, sourceKey]);

  return rendered.blocks;
}
