import Prism from "prismjs";
import type React from "react";
import type { MarkdownRendererProps } from "./types";
import { mapLanguage } from "./utils";

// Import common language components
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-php";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-shell-session";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

// Simple markdown renderer for AI responses
export default function MarkdownRenderer({ content, onApplyCode }: MarkdownRendererProps) {
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
        const prismLanguage = mapLanguage(language);

        // Highlight the code if the language is supported
        let highlightedCode = code;
        if (language && Prism.languages[prismLanguage]) {
          try {
            highlightedCode = Prism.highlight(code, Prism.languages[prismLanguage], prismLanguage);
          } catch (_e) {
            // Fallback to plain text if highlighting fails
            highlightedCode = code;
          }
        }

        return (
          <div key={index} className="group relative my-2">
            <pre className="max-w-full overflow-x-auto rounded border border-border bg-secondary-bg p-2">
              <div className="mb-1 flex items-center justify-between">
                {language && <div className="font-mono text-text-lighter text-xs">{language}</div>}
                {onApplyCode && code.trim() && (
                  <button
                    onClick={() => onApplyCode(code)}
                    className="whitespace-nowrap rounded border border-border bg-primary-bg px-2 py-1 font-mono text-text text-xs opacity-0 transition-colors hover:bg-hover group-hover:opacity-100"
                    title="Apply this code to current buffer"
                  >
                    Apply
                  </button>
                )}
              </div>
              <code
                className="block whitespace-pre-wrap break-all font-mono text-text text-xs"
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

    lines.forEach(line => {
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
            className="rounded border border-border bg-secondary-bg px-1 font-mono text-xs"
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
