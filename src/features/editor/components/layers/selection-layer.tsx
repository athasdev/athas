import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { buildLineOffsetMap } from "../../utils/html";
import {
  calculateSelectionBoxes,
  type SelectionBox,
  type SelectionOffsets,
} from "../../utils/selection-boxes";

interface SelectionLayerProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  wordWrap?: boolean;
}

const SelectionLayerComponent = forwardRef<HTMLDivElement, SelectionLayerProps>(
  ({ textareaRef, content, fontSize, fontFamily, lineHeight, tabSize, wordWrap = false }, ref) => {
    const textarea = textareaRef.current;
    const lines = useMemo(() => content.split("\n"), [content]);
    const lineOffsets = useMemo(() => buildLineOffsetMap(content), [content]);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [selectionOffsets, setSelectionOffsets] = useState<SelectionOffsets | null>(null);
    const [selectionBoxes, setSelectionBoxes] = useState<SelectionBox[]>([]);

    useEffect(() => {
      if (wordWrap) {
        setSelectionOffsets(null);
        return;
      }

      if (!textarea) {
        setSelectionOffsets(null);
        return;
      }

      const updateSelection = () => {
        const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
        const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
        const vimMode = textarea.getAttribute("data-vim-mode");
        const isVisualMode = vimMode === "visual";
        const isActive = document.activeElement === textarea;
        const hasSelection = start !== end;

        if (hasSelection && (isActive || isVisualMode)) {
          setSelectionOffsets({ start, end });
          return;
        }

        setSelectionOffsets(null);
      };

      updateSelection();

      textarea.addEventListener("select", updateSelection);
      textarea.addEventListener("input", updateSelection);
      textarea.addEventListener("keyup", updateSelection);
      textarea.addEventListener("mouseup", updateSelection);
      textarea.addEventListener("focus", updateSelection);
      textarea.addEventListener("blur", updateSelection);
      document.addEventListener("selectionchange", updateSelection);

      return () => {
        textarea.removeEventListener("select", updateSelection);
        textarea.removeEventListener("input", updateSelection);
        textarea.removeEventListener("keyup", updateSelection);
        textarea.removeEventListener("mouseup", updateSelection);
        textarea.removeEventListener("focus", updateSelection);
        textarea.removeEventListener("blur", updateSelection);
        document.removeEventListener("selectionchange", updateSelection);
      };
    }, [textarea, wordWrap]);

    useEffect(() => {
      if (wordWrap || !measureRef.current || !selectionOffsets) {
        setSelectionBoxes([]);
        return;
      }

      const measure = measureRef.current;

      const getTextWidth = (text: string): number => {
        measure.textContent = text;
        return measure.getBoundingClientRect().width;
      };

      setSelectionBoxes(
        calculateSelectionBoxes({
          selectionOffsets,
          lines,
          lineOffsets,
          contentLength: content.length,
          lineHeight,
          measureText: getTextWidth,
        }),
      );
    }, [selectionOffsets, lines, lineOffsets, content.length, lineHeight, wordWrap]);

    return (
      <div
        ref={ref}
        className="selection-layer pointer-events-none absolute inset-0 z-[3]"
        style={{
          willChange: "transform",
          display: wordWrap ? "none" : undefined,
        }}
      >
        <span
          ref={measureRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            visibility: "hidden",
            whiteSpace: "pre",
            fontSize: `${fontSize}px`,
            fontFamily,
            tabSize,
          }}
        />
        {selectionBoxes.map((box, index) => (
          <div
            key={index}
            className="editor-selection-box absolute"
            style={{
              top: `${box.top}px`,
              left: `${box.left}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
            }}
          />
        ))}
      </div>
    );
  },
);

SelectionLayerComponent.displayName = "SelectionLayer";

export const SelectionLayer = memo(SelectionLayerComponent, (prev, next) => {
  return (
    prev.textareaRef === next.textareaRef &&
    prev.content === next.content &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.wordWrap === next.wordWrap
  );
});
