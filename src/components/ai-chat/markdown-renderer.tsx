import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { useEffect, useState } from "react";
import { chatHighlighter } from "../../lib/syntax-highlighting/chat-highlighter";
import { usePersistentSettingsStore } from "../../settings/stores/persistent-settings-store";
import type { MarkdownRendererProps } from "./types";

// Modern markdown renderer using marked + shiki
export default function MarkdownRenderer({ content, onApplyCode }: MarkdownRendererProps) {
  const [renderedHtml, setRenderedHtml] = useState<string>("");
  const [isInitialized, setIsInitialized] = useState(false);
  const { aiSyntaxHighlighting } = usePersistentSettingsStore();

  // Initialize marked with chat highlighter
  useEffect(() => {
    const initializeRenderer = async () => {
      try {
        // Only initialize highlighter if syntax highlighting is enabled
        if (aiSyntaxHighlighting) {
          await chatHighlighter.initialize();
        }

        // Configure marked with conditional highlighting
        marked.use(
          markedHighlight({
            async: true,
            highlight: async (code: string, lang: string) => {
              try {
                // Only highlight if setting is enabled
                if (aiSyntaxHighlighting) {
                  return await chatHighlighter.highlightCodeBlock(code, lang || "text");
                } else {
                  // Return plain escaped HTML if highlighting is disabled
                  return escapeHtml(code);
                }
              } catch (error) {
                console.error("Highlighting error:", error);
                return escapeHtml(code);
              }
            },
          }),
          {
            renderer: createCustomRenderer(),
          },
        );

        // Configure marked options
        marked.setOptions({
          breaks: true,
          gfm: true,
        });

        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to initialize markdown renderer:", error);
        setIsInitialized(true); // Still allow fallback rendering
      }
    };

    initializeRenderer();
  }, [onApplyCode, aiSyntaxHighlighting]); // Re-initialize when setting changes

  // Render markdown when content changes
  useEffect(() => {
    if (!isInitialized) return;

    const renderMarkdown = async () => {
      try {
        const html = await marked.parse(content);
        setRenderedHtml(html);

        // Post-process to add syntax highlighting to code blocks
        setTimeout(() => {
          const codeBlocks = document.querySelectorAll(".highlighted-code");
          codeBlocks.forEach(async (codeElement) => {
            const preElement = codeElement.closest("pre");
            const codeBlockDiv = preElement?.closest(".code-block");
            const language = codeBlockDiv?.getAttribute("data-language") || "text";
            const button = preElement?.querySelector(".apply-code-btn");
            const code = button?.getAttribute("data-code");

            if (code && codeElement.innerHTML.trim() === "") {
              try {
                const decodedCode = decodeURIComponent(code);
                const highlightedHtml = await chatHighlighter.highlightCodeBlock(
                  decodedCode,
                  language,
                );
                codeElement.innerHTML = highlightedHtml;
              } catch (error) {
                console.error("Error highlighting code block:", error);
                codeElement.textContent = decodeURIComponent(code);
              }
            }
          });
        }, 0);
      } catch (error) {
        console.error("Markdown parsing error:", error);
        setRenderedHtml(escapeHtml(content));
      }
    };

    renderMarkdown();
  }, [content, isInitialized]);

  const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  // Custom renderer for code blocks with apply button
  const createCustomRenderer = () => {
    const renderer = new marked.Renderer();

    renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
      const language = lang || "text";

      return `
        <div class="group relative my-2 code-block" data-language="${language}">
          <pre class="max-w-full overflow-x-auto rounded border border-border bg-secondary-bg p-2">
            <div class="mb-1 flex items-center justify-between">
              ${language !== "text" ? `<div class="font-mono text-text-lighter text-xs">${language}</div>` : ""}
              ${
                onApplyCode
                  ? `
                <button
                  class="apply-code-btn whitespace-nowrap rounded border border-border bg-primary-bg px-2 py-1 font-mono text-text text-xs opacity-0 transition-colors hover:bg-hover group-hover:opacity-100"
                  data-code="${encodeURIComponent(text)}"
                  title="Apply this code to current buffer"
                >
                  Apply
                </button>
              `
                  : ""
              }
            </div>
            <code class="block whitespace-pre-wrap break-all font-mono text-text text-xs highlighted-code"></code>
          </pre>
        </div>
      `;
    };

    return renderer;
  };

  // Handle apply code button clicks
  useEffect(() => {
    if (!onApplyCode) return;

    const handleApplyClick = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains("apply-code-btn")) {
        const encodedCode = target.getAttribute("data-code");
        if (encodedCode) {
          const code = decodeURIComponent(encodedCode);
          onApplyCode(code);
        }
      }
    };

    document.addEventListener("click", handleApplyClick);
    return () => document.removeEventListener("click", handleApplyClick);
  }, [onApplyCode]);

  if (!isInitialized) {
    return <div className="text-text-lighter">Loading...</div>;
  }

  return (
    <div
      className="markdown-content whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: renderedHtml }}
    />
  );
}
