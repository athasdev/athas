import { useEffect, useId, useMemo, useState } from "react";
import { highlightMarkdownCodeBlocks } from "./code-highlight";
import { parseMarkdown, type ParseMarkdownOptions } from "./parser";

export function useHighlightedMarkdown(
  content: string | null | undefined,
  options?: ParseMarkdownOptions,
) {
  const frontMatter = options?.frontMatter;
  const requestKey = `markdown-preview:${useId()}`;
  const parsedHtml = useMemo(() => {
    if (!content) return "";
    return parseMarkdown(content, { frontMatter });
  }, [content, frontMatter]);
  const [html, setHtml] = useState(parsedHtml);

  useEffect(() => {
    let cancelled = false;

    setHtml(parsedHtml);
    if (!parsedHtml) {
      return undefined;
    }

    void highlightMarkdownCodeBlocks(parsedHtml, requestKey).then((highlightedHtml) => {
      if (!cancelled) {
        setHtml(highlightedHtml);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [parsedHtml, requestKey]);

  return html;
}
