import { useEffect, useState } from "react";
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
  const [html, setHtml] = useState(() => renderHighlightedCodeHtml(code, []));

  useEffect(() => {
    let cancelled = false;
    setHtml(renderHighlightedCodeHtml(code, []));

    void getCodeHighlightSegments(code, language).then((segments) => {
      if (!cancelled) {
        setHtml(renderHighlightedCodeHtml(code, segments));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <pre className={className}>
      <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
