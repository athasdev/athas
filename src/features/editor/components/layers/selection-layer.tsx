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
  viewportRange?: { startLine: number; endLine: number };
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

const VIEWPORT_BUFFER_LINES = 20;

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
  ({ textareaRef, content, fontSize, fontFamily, lineHeight, tabSize, viewportRange }, ref) => {
    const textarea = textareaRef.current;
    const lines = useMemo(() => content.split("\n"), [content]);
    const lineOffsets = useMemo(() => buildLineOffsetMap(content), [content]);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [selectionOffsets, setSelectionOffsets] = useState<SelectionOffsets | null>(null);
    const [selectionBoxes, setSelectionBoxes] = useState<SelectionBox[]>([]);

    useEffect(() => {
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
    }, [textarea]);

    useEffect(() => {
      if (!measureRef.current || !selectionOffsets) {
        setSelectionBoxes([]);
        return;
      }

      const measure = measureRef.current;
      const boxes: SelectionBox[] = [];

      const viewportStartLine = Math.max(
        0,
        (viewportRange?.startLine ?? 0) - VIEWPORT_BUFFER_LINES,
      );
      const viewportEndLine = Math.min(
        lines.length,
        (viewportRange?.endLine ?? lines.length) + VIEWPORT_BUFFER_LINES,
      );

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
      const overlapEndLine = findLineForOffset(
        Math.max(selectionOffsets.start, selectionOffsets.end - 1),
        lineOffsets,
      );

      if (
        startPos.line >= viewportEndLine ||
        overlapEndLine < viewportStartLine ||
        viewportEndLine <= viewportStartLine
      ) {
        setSelectionBoxes([]);
        return;
      }

      const firstVisibleLine = Math.max(startPos.line, viewportStartLine);
      const lastVisibleLine = Math.min(endPos.line, viewportEndLine - 1);

      for (let line = firstVisibleLine; line <= lastVisibleLine; line++) {
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
    }, [selectionOffsets, lines, lineOffsets, content.length, lineHeight, viewportRange]);

    return (
      <div
        ref={ref}
        className="selection-layer pointer-events-none absolute inset-0 z-[3]"
        style={{ willChange: "transform" }}
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
            className="absolute bg-selection-bg"
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
    prev.viewportRange?.startLine === next.viewportRange?.startLine &&
    prev.viewportRange?.endLine === next.viewportRange?.endLine
  );
});
