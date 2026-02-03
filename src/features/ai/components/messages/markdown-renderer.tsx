import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { MarkdownRendererProps } from "@/features/ai/types/ai-chat";
import { normalizeLanguage } from "@/features/editor/markdown/language-map";
import { highlightCode } from "@/features/editor/markdown/prism-languages";

// Error Block Component
function ErrorBlock({ errorData }: { errorData: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const lines = errorData.split("\n");
  const title =
    lines
      .find((l) => l.startsWith("title:"))
      ?.replace("title:", "")
      .trim() || "Error";
  const code =
    lines
      .find((l) => l.startsWith("code:"))
      ?.replace("code:", "")
      .trim() || "";
  const message =
    lines
      .find((l) => l.startsWith("message:"))
      ?.replace("message:", "")
      .trim() || "";
  const details =
    lines
      .find((l) => l.startsWith("details:"))
      ?.replace("details:", "")
      .trim() || "";

  return (
    <div className="error-block">
      <div className="error-header">
        <span className="error-title">
          {title}
          {code ? ` (${code})` : ""}
        </span>
      </div>
      <div className="error-message">{message}</div>
      {details && (
        <div className="mt-1.5">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-red-400 text-xs transition-colors hover:text-red-300"
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {isExpanded ? "Hide" : "Show"} details
          </button>
          {isExpanded && (
            <pre className="mt-1.5 overflow-x-auto rounded bg-red-950/20 p-2 text-red-300 text-xs">
              {(() => {
                try {
                  const parsed = JSON.parse(details);
                  return JSON.stringify(parsed, null, 2);
                } catch {
                  return details;
                }
              })()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// Header classes scaled for sidebar context
const headerClasses: Record<number, string> = {
  1: "mt-3 mb-1.5 font-semibold text-sm text-text",
  2: "mt-2.5 mb-1 font-semibold text-[13px] text-text",
  3: "mt-2 mb-1 font-semibold text-text text-xs",
  4: "mt-2 mb-0.5 font-medium text-text text-xs",
  5: "mt-1.5 mb-0.5 font-medium text-text-light text-xs",
  6: "mt-1.5 mb-0.5 font-medium text-text-lighter text-xs",
};

function renderHeader(level: number, text: string, key: number): React.ReactNode {
  const className = headerClasses[level] || headerClasses[6];
  const content = renderInlineFormatting(text);

  switch (level) {
    case 1:
      return (
        <h1 key={key} className={className}>
          {content}
        </h1>
      );
    case 2:
      return (
        <h2 key={key} className={className}>
          {content}
        </h2>
      );
    case 3:
      return (
        <h3 key={key} className={className}>
          {content}
        </h3>
      );
    case 4:
      return (
        <h4 key={key} className={className}>
          {content}
        </h4>
      );
    case 5:
      return (
        <h5 key={key} className={className}>
          {content}
        </h5>
      );
    default:
      return (
        <h6 key={key} className={className}>
          {content}
        </h6>
      );
  }
}

// Cursor-based inline formatting parser
function renderInlineFormatting(text: string): React.ReactNode {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(
        <code
          key={key++}
          className="ui-font rounded border border-border bg-secondary-bg px-1 text-xs"
        >
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Strikethrough
    const strikeMatch = remaining.match(/^~~([^~]+)~~/);
    if (strikeMatch) {
      elements.push(
        <del key={key++} className="text-text-lighter line-through">
          {strikeMatch[1]}
        </del>,
      );
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      elements.push(
        <strong key={key++} className="font-semibold">
          {boldMatch[1]}
        </strong>,
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      elements.push(
        <em key={key++} className="italic">
          {italicMatch[1]}
        </em>,
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Links [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const url = linkMatch[2];
      elements.push(
        <a
          key={key++}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
          }}
          className="cursor-pointer text-accent hover:underline"
        >
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain URL
    const urlMatch = remaining.match(/^(https?:\/\/[^\s<)]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      elements.push(
        <a
          key={key++}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url));
          }}
          className="cursor-pointer text-accent hover:underline"
        >
          {url.length > 60 ? `${url.slice(0, 60)}...` : url}
        </a>,
      );
      remaining = remaining.slice(urlMatch[0].length);
      continue;
    }

    // Find next special character or consume all remaining text
    const nextSpecial = remaining.search(/[`~*[\]]|https?:\/\//);
    if (nextSpecial === -1) {
      elements.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (nextSpecial === 0) {
      // Special char at start didn't match any pattern — treat as plain text
      elements.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      elements.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

// Line-by-line state machine markdown renderer
function renderContent(
  text: string,
  onApplyCode?: (code: string, language?: string) => void,
): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = "";
  let codeBlockContent: string[] = [];
  let currentList: { type: "ol" | "ul"; items: string[] } | null = null;
  let currentParagraph: string[] = [];
  let key = 0;

  const flushCodeBlock = () => {
    if (codeBlockContent.length > 0) {
      const code = codeBlockContent.join("\n");
      const prismLanguage = normalizeLanguage(codeBlockLanguage);
      const highlightedCode = codeBlockLanguage ? highlightCode(code, prismLanguage) : code;

      elements.push(
        <div key={key++} className="group relative my-2">
          <pre className="max-w-full overflow-x-auto rounded border border-border bg-secondary-bg p-2">
            <div className="mb-1 flex items-center justify-between">
              {codeBlockLanguage && (
                <div className="ui-font text-text-lighter text-xs">{codeBlockLanguage}</div>
              )}
              {onApplyCode && code.trim() && (
                <button
                  onClick={() => onApplyCode(code)}
                  className="ui-font whitespace-nowrap rounded border border-border bg-primary-bg px-2 py-1 text-text text-xs opacity-0 transition-colors hover:bg-hover group-hover:opacity-100"
                  title="Apply this code to current buffer"
                >
                  Apply
                </button>
              )}
            </div>
            <code
              className="ui-font block whitespace-pre-wrap break-all text-text text-xs"
              dangerouslySetInnerHTML={{ __html: highlightedCode }}
            />
          </pre>
        </div>,
      );
      codeBlockContent = [];
      codeBlockLanguage = "";
    }
  };

  const flushList = () => {
    if (currentList && currentList.items.length > 0) {
      if (currentList.type === "ol") {
        elements.push(
          <ol key={key++} className="my-2 ml-5 list-decimal space-y-0.5">
            {currentList.items.map((item, idx) => (
              <li key={idx} className="pl-1 text-text">
                {renderInlineFormatting(item)}
              </li>
            ))}
          </ol>,
        );
      } else {
        elements.push(
          <ul key={key++} className="my-2 ml-5 list-disc space-y-0.5">
            {currentList.items.map((item, idx) => (
              <li key={idx} className="pl-1 text-text">
                {renderInlineFormatting(item)}
              </li>
            ))}
          </ul>,
        );
      }
      currentList = null;
    }
  };

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const paragraphText = currentParagraph.join(" ").trim();
      if (paragraphText) {
        elements.push(
          <p key={key++} className="my-1.5 leading-relaxed">
            {renderInlineFormatting(paragraphText)}
          </p>,
        );
      }
      currentParagraph = [];
    }
  };

  for (const line of lines) {
    // Code block fence
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        flushList();
        flushParagraph();
        inCodeBlock = true;
        codeBlockLanguage = line.trimStart().slice(3).trim();
      }
      continue;
    }

    // Inside code block — accumulate
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    const trimmedLine = line.trim();

    // Header
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushList();
      flushParagraph();
      const level = headerMatch[1].length;
      elements.push(renderHeader(level, headerMatch[2], key++));
      continue;
    }

    // Horizontal rule
    if (trimmedLine.match(/^[-*_]{3,}$/) && trimmedLine.length >= 3) {
      flushList();
      flushParagraph();
      elements.push(<hr key={key++} className="my-3 border-border" />);
      continue;
    }

    // Blockquote
    if (trimmedLine.startsWith("> ") || trimmedLine === ">") {
      flushList();
      flushParagraph();
      const quoteContent = trimmedLine.startsWith("> ") ? trimmedLine.slice(2) : "";
      elements.push(
        <blockquote
          key={key++}
          className="my-2 border-border border-l-2 pl-3 text-text-light italic"
        >
          {renderInlineFormatting(quoteContent)}
        </blockquote>,
      );
      continue;
    }

    // Ordered list
    const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      flushParagraph();
      if (currentList?.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(numberedMatch[2]);
      continue;
    }

    // Unordered list
    const bulletMatch = trimmedLine.match(/^[-*+]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      if (currentList?.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(bulletMatch[1]);
      continue;
    }

    // Empty line
    if (trimmedLine === "") {
      flushList();
      flushParagraph();
      continue;
    }

    // Regular text — accumulate into paragraph
    flushList();
    currentParagraph.push(trimmedLine);
  }

  // Flush remaining content
  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushList();
  flushParagraph();

  return elements;
}

// Simple markdown renderer for AI responses
export default function MarkdownRenderer({ content, onApplyCode }: MarkdownRendererProps) {
  // Check for error blocks first
  if (content.includes("[ERROR_BLOCK]")) {
    const errorMatch = content.match(/\[ERROR_BLOCK\]([\s\S]*?)\[\/ERROR_BLOCK\]/);
    if (errorMatch) {
      return <ErrorBlock errorData={errorMatch[1]} />;
    }
  }

  return <div>{renderContent(content, onApplyCode)}</div>;
}
