import { useMemo } from "react";
import { useEditorConfigStore } from "../../stores/editor-config";
import { useEditorInstanceStore } from "../../stores/editor-instance";

export function LineNumbers() {
  const fontSize = useEditorConfigStore(state => state.fontSize);
  const { value, lineNumbersRef } = useEditorInstanceStore();
  // Calculate line numbers
  const lineNumbersArray = useMemo(() => {
    const lines = value.split("\n");
    // Ensure we always have at least one line number, even for empty content
    const lineCount = Math.max(1, lines.length);
    return Array.from({ length: lineCount }, (_, i) => i + 1);
  }, [value]);

  const containerWidth = useMemo(() => {
    return `${Math.max(3, Math.floor(Math.log10(lineNumbersArray.length)) + 1) * fontSize * 0.6 + 24}px`;
  }, [lineNumbersArray.length, fontSize]);

  return (
    <div
      className="relative flex-shrink-0 overflow-hidden border-border border-r bg-secondary-bg"
      style={{ width: containerWidth }}
    >
      <div
        ref={lineNumbersRef}
        className="line-numbers-container absolute inset-0 overflow-hidden font-mono"
        style={{
          paddingTop: "16px",
          paddingBottom: "16px",
          paddingLeft: "16px",
          paddingRight: "8px",
          fontSize: `${fontSize}px`,
          lineHeight: `${fontSize * 1.4}px`,
          color: "var(--tw-text-lighter)",
          textAlign: "right",
          userSelect: "none",
          pointerEvents: "none",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitFontFeatureSettings: '"tnum"',
          fontFeatureSettings: '"tnum"',
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {lineNumbersArray.map(num => (
          <div
            key={num}
            style={{
              height: `${fontSize * 1.4}px`,
              lineHeight: `${fontSize * 1.4}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              fontSize: "inherit",
            }}
          >
            {num}
          </div>
        ))}
      </div>
    </div>
  );
}
