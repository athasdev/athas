import { useEffect, useId, useState } from "react";
import {
  getCodeHighlightSegments,
  renderHighlightedCodeHtml,
} from "@/features/editor/markdown/code-highlight";

interface HighlightedCodeProps {
  code: string;
  language: string;
  className?: string;
}

export function HighlightedCode({ code, language, className }: HighlightedCodeProps) {
  const requestKey = `notebook-highlight:${useId()}`;
  const [html, setHtml] = useState(() => renderHighlightedCodeHtml(code, []));

  useEffect(() => {
    let cancelled = false;
    setHtml(renderHighlightedCodeHtml(code, []));

    void getCodeHighlightSegments(code, language, requestKey).then((segments) => {
      if (!cancelled) {
        setHtml(renderHighlightedCodeHtml(code, segments));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, language, requestKey]);

  return (
    <pre className={className}>
      <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
