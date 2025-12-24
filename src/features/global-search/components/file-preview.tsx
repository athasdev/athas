import { useMemo } from "react";
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
  const lineData: LineData[] = [];

  let currentPos = 0;
  const lineStarts: number[] = [0];

  for (let i = 0; i < lines.length; i++) {
    currentPos += lines[i].length + 1;
    lineStarts.push(currentPos);
  }

  lines.forEach((line, lineIndex) => {
    const lineStart = lineStarts[lineIndex];
    const lineEnd = lineStart + line.length;

    const lineTokens: LineToken[] = tokens
      .filter((token) => {
        return token.start < lineEnd && token.end > lineStart;
      })
      .map((token) => {
        const startColumn = Math.max(0, token.start - lineStart);
        const endColumn = Math.min(line.length, token.end - lineStart);

        return {
          startColumn,
          endColumn,
          className: token.class_name,
        };
      })
      .filter((token) => token.startColumn < token.endColumn);

    lineData.push({
      lineNumber: lineIndex + 1,
      content: line,
      tokens: lineTokens,
    });
  });

  return lineData;
};

const PreviewLine = ({ lineNumber, content, tokens }: LineData) => {
  const renderContent = () => {
    if (!tokens || tokens.length === 0) {
      return <span>{content || "\u00A0"}</span>;
    }

    const elements: React.ReactNode[] = [];
    let lastEnd = 0;

    const sortedTokens = [...tokens].sort((a, b) => a.startColumn - b.startColumn);

    sortedTokens.forEach((token, index) => {
      if (token.startColumn > lastEnd) {
        elements.push(
          <span key={`text-${index}`}>{content.slice(lastEnd, token.startColumn)}</span>,
        );
      }

      const tokenContent = content.slice(token.startColumn, token.endColumn);
      elements.push(
        <span key={`token-${index}`} className={token.className}>
          {tokenContent}
        </span>,
      );

      lastEnd = token.endColumn;
    });

    if (lastEnd < content.length) {
      elements.push(<span key="text-end">{content.slice(lastEnd)}</span>);
    }

    if (elements.length === 0 && content.length === 0) {
      elements.push(<span key="empty">{"\u00A0"}</span>);
    }

    return <>{elements}</>;
  };

  return (
    <div className="flex font-mono text-[11px] leading-[18px]">
      <span className="mr-3 w-8 select-none text-right text-text-lighter opacity-50">
        {lineNumber}
      </span>
      <span className="flex-1 whitespace-pre text-text">{renderContent()}</span>
    </div>
  );
};

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
    <div className="custom-scrollbar-thin h-full overflow-y-auto bg-primary-bg p-3">
      <div className="space-y-0">
        {lineData.map((line) => (
          <PreviewLine key={line.lineNumber} {...line} />
        ))}
      </div>
    </div>
  );
};
