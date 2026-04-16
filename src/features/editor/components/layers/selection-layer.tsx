import { forwardRef, memo, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { buildLineOffsetMap } from "../../utils/html";

interface SelectionLayerProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  content: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  wordWrap?: boolean;
}

interface SelectionOffsets {
  start: number;
  end: number;
}

interface SelectionBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findLineForOffset(offset: number, lineOffsets: number[]): number {
  if (lineOffsets.length === 0) return 0;

  let low = 0;
  let high = lineOffsets.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineOffsets[mid] <= offset) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function offsetToLineColumn(
  offset: number,
  lineOffsets: number[],
  contentLength: number,
): { line: number; column: number } {
  const clampedOffset = Math.max(0, Math.min(offset, contentLength));
  const line = findLineForOffset(clampedOffset, lineOffsets);
  const lineStartOffset = lineOffsets[line] ?? 0;

  return {
    line,
    column: Math.max(0, clampedOffset - lineStartOffset),
  };
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
      const boxes: SelectionBox[] = [];

      const getTextWidth = (text: string): number => {
        measure.textContent = text;
        return measure.getBoundingClientRect().width;
      };

      const getLineLeft = (lineIndex: number, column: number): number => {
        const lineText = lines[lineIndex] || "";
        const textBeforeColumn = lineText.substring(0, column);
        return getTextWidth(textBeforeColumn) + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
      };

      const startPos = offsetToLineColumn(selectionOffsets.start, lineOffsets, content.length);
      const endPos = offsetToLineColumn(selectionOffsets.end, lineOffsets, content.length);

      for (let line = startPos.line; line <= endPos.line; line++) {
        const lineText = lines[line] || "";
        let startCol = 0;
        let endCol = lineText.length;

        if (startPos.line === endPos.line) {
          startCol = startPos.column;
          endCol = endPos.column;
        } else if (line === startPos.line) {
          startCol = startPos.column;
          endCol = lineText.length;
        } else if (line === endPos.line) {
          startCol = 0;
          endCol = endPos.column;
        }

        if (endCol <= startCol) {
          continue;
        }

        const left = getLineLeft(line, startCol);
        const width = getTextWidth(lineText.substring(startCol, endCol));

        boxes.push({
          top: line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP,
          left,
          width: Math.max(width, 2),
          height: lineHeight,
        });
      }

      setSelectionBoxes(boxes);
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
