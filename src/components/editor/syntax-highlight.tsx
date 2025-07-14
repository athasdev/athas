import { useCodeHighlighting } from "../../hooks/use-code-highlighting";
import { useEditorConfigStore } from "../../stores/editor-config";
import { useEditorInstanceStore } from "../../stores/editor-instance";

export function SyntaxHighlight() {
  const { fontSize, tabSize, wordWrap } = useEditorConfigStore();
  const { highlightRef } = useEditorInstanceStore();

  // Initialize PrismJS highlighting
  useCodeHighlighting(highlightRef || { current: null });
  const getEditorStyles = {
    fontSize: `${fontSize}px`,
    tabSize: tabSize,
    lineHeight: `${fontSize * 1.4}px`,
  };

  return (
    <pre
      ref={highlightRef}
      className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 z-[1] m-0 overflow-auto rounded-none border-none bg-transparent font-mono shadow-none outline-none transition-none"
      style={{
        ...getEditorStyles,
        padding: "16px",
        minHeight: "100%",
        whiteSpace: wordWrap ? "pre-wrap" : "pre",
        wordBreak: wordWrap ? "break-word" : "normal",
        overflowWrap: wordWrap ? "break-word" : "normal",
        userSelect: "none",
        WebkitUserSelect: "none",
        MozUserSelect: "none",
        msUserSelect: "none",
        maxWidth: "fit-content",
        minWidth: "100%",
        color: "var(--tw-text)",
      }}
      aria-hidden="true"
    />
  );
}
