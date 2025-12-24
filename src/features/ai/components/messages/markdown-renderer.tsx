import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { MarkdownRendererProps } from "@/features/ai/types/ai-chat";
import { normalizeLanguage } from "@/features/editor/markdown/language-map";
import { highlightCode } from "@/features/editor/markdown/prism-languages";

// Error Block Component
function ErrorBlock({ errorData }: { errorData: string }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Parse error data
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

// Simple markdown renderer for AI responses
export default function MarkdownRenderer({ content, onApplyCode }: MarkdownRendererProps) {
  // First, check for error blocks
  if (content.includes("[ERROR_BLOCK]")) {
    const errorMatch = content.match(/\[ERROR_BLOCK\]([\s\S]*?)\[\/ERROR_BLOCK\]/);
    if (errorMatch) {
      return <ErrorBlock errorData={errorMatch[1]} />;
    }
  }

  const renderContent = (text: string) => {
    // First, handle code blocks (triple backticks)
    const codeBlockParts = text.split(/(```[\s\S]*?```)/g);

    return codeBlockParts.map((part, index) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        // Code block
        const lines = part.split("\n");
        const language = lines[0].replace("```", "").trim();
        const code = lines.slice(1, -1).join("\n");

        // Get the mapped language for Prism
        const prismLanguage = normalizeLanguage(language);

        // Highlight the code if the language is supported
        const highlightedCode = language ? highlightCode(code, prismLanguage) : code;

        return (
          <div key={index} className="group relative my-2">
            <pre className="max-w-full overflow-x-auto rounded border border-border bg-secondary-bg p-2">
              <div className="mb-1 flex items-center justify-between">
                {language && <div className="ui-font text-text-lighter text-xs">{language}</div>}
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
          </div>
        );
      }

      // Process the rest for inline elements and lists
      return <div key={index}>{renderInlineAndLists(part)}</div>;
    });
  };

  const renderInlineAndLists = (text: string) => {
    // Split text into lines for list processing
    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];
    let currentList: { type: "ol" | "ul" | null; items: string[] } = {
      type: null,
      items: [],
    };
    let currentParagraph: string[] = [];

    const flushCurrentList = () => {
      if (currentList.type && currentList.items.length > 0) {
        const ListComponent = currentList.type === "ol" ? "ol" : "ul";
        elements.push(
          <ListComponent key={`list-${elements.length}`} className="my-2 ml-4">
            {currentList.items.map((item, index) => (
              <li key={index} className="my-1">
                {renderInlineFormatting(item)}
              </li>
            ))}
          </ListComponent>,
        );
        currentList = { type: null, items: [] };
      }
    };

    const flushCurrentParagraph = () => {
      if (currentParagraph.length > 0) {
        const paragraphText = currentParagraph.join("\n");
        if (paragraphText.trim()) {
          elements.push(
            <div key={`para-${elements.length}`} className="my-1">
              {renderInlineFormatting(paragraphText)}
            </div>,
          );
        }
        currentParagraph = [];
      }
    };

    lines.forEach((line) => {
      const trimmedLine = line.trim();

      // Check for numbered lists (e.g., "1. ", "2. ", etc.)
      const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.*)$/);
      if (numberedMatch) {
        flushCurrentParagraph();
        if (currentList.type !== "ol") {
          flushCurrentList();
          currentList.type = "ol";
        }
        currentList.items.push(numberedMatch[2]);
        return;
      }

      // Check for bullet lists (e.g., "- ", "* ", "• ")
      const bulletMatch = trimmedLine.match(/^[-*•]\s+(.*)$/);
      if (bulletMatch) {
        flushCurrentParagraph();
        if (currentList.type !== "ul") {
          flushCurrentList();
          currentList.type = "ul";
        }
        currentList.items.push(bulletMatch[1]);
        return;
      }

      // If we reach here, it's not a list item
      flushCurrentList();

      // Add to current paragraph (handle empty lines as paragraph breaks)
      if (trimmedLine === "") {
        flushCurrentParagraph();
      } else {
        currentParagraph.push(line);
      }
    });

    // Flush any remaining content
    flushCurrentList();
    flushCurrentParagraph();

    return elements.length > 0 ? elements : [renderInlineFormatting(text)];
  };

  const renderInlineFormatting = (text: string) => {
    // Handle inline code first (single backticks)
    const inlineCodeParts = text.split(/(`[^`]+`)/g);

    return inlineCodeParts.map((part, index) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        // Inline code
        const code = part.slice(1, -1);
        return (
          <code
            key={index}
            className="ui-font rounded border border-border bg-secondary-bg px-1 text-xs"
          >
            {code}
          </code>
        );
      }

      // Handle bold text (**text**)
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return boldParts.map((boldPart, boldIndex) => {
        if (boldPart.startsWith("**") && boldPart.endsWith("**") && boldPart.length > 4) {
          return (
            <strong key={`${index}-${boldIndex}`} className="font-semibold">
              {boldPart.slice(2, -2)}
            </strong>
          );
        }

        // Handle italic text (*text*)
        const italicParts = boldPart.split(/(\*[^*]+\*)/g);
        return italicParts.map((italicPart, italicIndex) => {
          if (
            italicPart.startsWith("*") &&
            italicPart.endsWith("*") &&
            italicPart.length > 2 &&
            !italicPart.startsWith("**")
          ) {
            return (
              <em key={`${index}-${boldIndex}-${italicIndex}`} className="italic">
                {italicPart.slice(1, -1)}
              </em>
            );
          }

          return <span key={`${index}-${boldIndex}-${italicIndex}`}>{italicPart}</span>;
        });
      });
    });
  };

  return <div className="whitespace-pre-wrap">{renderContent(content)}</div>;
}
