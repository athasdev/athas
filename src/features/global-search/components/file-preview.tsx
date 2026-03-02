import { memo, useMemo } from "react";
import type { Token } from "@/features/editor/extensions/types";
import type { LineToken } from "@/features/editor/types/editor";
import { useFilePreview } from "../hooks/use-file-preview";

interface FilePreviewProps {
  filePath: string | null;
}

interface LineData {
  lineNumber: number;
  content: string;
  tokens: LineToken[];
}

const convertTokensToLineTokens = (content: string, tokens: Token[]): LineData[] => {
  const lines = content.split("\n");
  const sortedTokens = [...tokens].sort((a, b) => a.start - b.start || a.end - b.end);
  if (tokens.length === 0) {
    return lines.map((line, i) => ({
      lineNumber: i + 1,
      content: line,
      tokens: [],
    }));
  }

  const lineData: LineData[] = [];
  let currentPos = 0;
  const lineStarts: number[] = [0];

  for (let i = 0; i < lines.length; i++) {
    currentPos += lines[i].length + 1;
    lineStarts.push(currentPos);
  }

  let tokenIdx = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineStart = lineStarts[lineIndex];
    const lineEnd = lineStart + line.length;
    const lineTokens: LineToken[] = [];

    while (tokenIdx < sortedTokens.length && sortedTokens[tokenIdx].end <= lineStart) {
      tokenIdx++;
    }

    let tempIdx = tokenIdx;
    while (tempIdx < sortedTokens.length && sortedTokens[tempIdx].start < lineEnd) {
      const token = sortedTokens[tempIdx];
      if (token.end > lineStart) {
        const startColumn = Math.max(0, token.start - lineStart);
        const endColumn = Math.min(line.length, token.end - lineStart);
        if (startColumn < endColumn) {
          lineTokens.push({
            startColumn,
            endColumn,
            className: token.class_name,
          });
        }
      }
      tempIdx++;
    }

    lineData.push({
      lineNumber: lineIndex + 1,
      content: line,
      tokens: lineTokens,
    });
  }

  return lineData;
};

const normalizeLineTokens = (tokens: LineToken[], lineLength: number): LineToken[] => {
  if (tokens.length === 0) return [];

  const normalized: LineToken[] = [];
  const sorted = [...tokens].sort(
    (a, b) => a.startColumn - b.startColumn || a.endColumn - b.endColumn,
  );
  let cursor = 0;

  for (const token of sorted) {
    const start = Math.max(0, Math.min(lineLength, token.startColumn));
    const end = Math.max(0, Math.min(lineLength, token.endColumn));
    if (end <= start) continue;

    const clippedStart = Math.max(start, cursor);
    if (end <= clippedStart) continue;

    normalized.push({
      ...token,
      startColumn: clippedStart,
      endColumn: end,
    });
    cursor = end;
  }

  return normalized;
};

const PreviewLine = memo(({ lineNumber, content, tokens }: LineData) => {
  const normalizedTokens = useMemo(
    () => normalizeLineTokens(tokens, content.length),
    [tokens, content.length],
  );

  const rendered = useMemo(() => {
    if (normalizedTokens.length === 0) {
      return <span>{content || "\u00A0"}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastEnd = 0;

    for (let i = 0; i < normalizedTokens.length; i++) {
      const token = normalizedTokens[i];
      if (token.startColumn > lastEnd) {
        elements.push(<span key={`t-${i}`}>{content.slice(lastEnd, token.startColumn)}</span>);
      }
      elements.push(
        <span key={`k-${i}`} className={token.className}>
          {content.slice(token.startColumn, token.endColumn)}
        </span>,
      );
      lastEnd = token.endColumn;
    }

    if (lastEnd < content.length) {
      elements.push(<span key="e">{content.slice(lastEnd)}</span>);
    }

    return <>{elements}</>;
  }, [content, normalizedTokens]);

  return (
    <div className="flex items-start font-mono text-[11px] leading-[18px]">
      <span className="mr-3 w-8 shrink-0 select-none text-right text-text-lighter opacity-50 tabular-nums">
        {lineNumber}
      </span>
      <span className="whitespace-pre text-text">{rendered}</span>
    </div>
  );
});

export const FilePreview = ({ filePath }: FilePreviewProps) => {
  const { content, tokens, isLoading, error } = useFilePreview(filePath);

  const lineData = useMemo(() => {
    if (!content) return [];
    return convertTokensToLineTokens(content, tokens);
  }, [content, tokens]);

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        Select a file to preview
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        Loading preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        {error}
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-text-lighter text-xs">
        Empty file
      </div>
    );
  }

  return (
    <div className="custom-scrollbar-thin h-full overflow-auto bg-primary-bg p-3">
      <div className="min-w-max space-y-0">
        {lineData.map((line) => (
          <PreviewLine key={line.lineNumber} {...line} />
        ))}
      </div>
    </div>
  );
};
