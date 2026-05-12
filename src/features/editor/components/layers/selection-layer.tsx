import { forwardRef, memo, useEffect, useMemo, useState } from "react";
import { calculateSelectionBoxes, type SelectionOffsets } from "../../utils/selection-boxes";
import { measureTextWidth } from "../../utils/position";
import type { EditorViewLayout } from "../../view-model/view-layout";

interface SelectionLayerProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  lines: string[];
  lineOffsets: number[];
  contentLength: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  selectionOffsets?: SelectionOffsets | null;
  lineBreakFillWidth?: number;
  lineTextResolver?: (lineIndex: number) => string;
  viewportRange?: { startLine: number; endLine: number };
  wordWrap?: boolean;
  viewLayout?: EditorViewLayout;
}

const SelectionLayerComponent = forwardRef<HTMLDivElement, SelectionLayerProps>(
  (
    {
      textareaRef,
      lines,
      lineOffsets,
      contentLength,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      selectionOffsets: controlledSelectionOffsets,
      lineBreakFillWidth,
      lineTextResolver,
      viewportRange,
      wordWrap = false,
      viewLayout,
    },
    ref,
  ) => {
    const textarea = textareaRef?.current;
    const [nativeSelectionOffsets, setNativeSelectionOffsets] = useState<SelectionOffsets | null>(
      null,
    );
    const selectionOffsets =
      controlledSelectionOffsets === undefined
        ? nativeSelectionOffsets
        : controlledSelectionOffsets;

    useEffect(() => {
      if (controlledSelectionOffsets !== undefined) {
        setNativeSelectionOffsets(null);
        return;
      }

      if (!textarea) {
        setNativeSelectionOffsets(null);
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
          setNativeSelectionOffsets({ start, end });
          return;
        }

        setNativeSelectionOffsets(null);
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
    }, [controlledSelectionOffsets, textarea]);

    const selectionBoxes = useMemo(() => {
      if (!selectionOffsets) return [];

      const getTextWidth = (text: string): number => {
        return measureTextWidth(text, fontSize, fontFamily, tabSize);
      };

      return calculateSelectionBoxes({
        selectionOffsets,
        lines,
        lineOffsets,
        contentLength,
        lineHeight,
        measureText: getTextWidth,
        lineBreakFillWidth,
        lineTextResolver,
        viewportRange,
        viewLayout: wordWrap ? viewLayout : undefined,
      });
    }, [
      contentLength,
      fontFamily,
      fontSize,
      lineHeight,
      lineBreakFillWidth,
      lineOffsets,
      lineTextResolver,
      lines,
      selectionOffsets,
      tabSize,
      viewportRange,
      wordWrap,
      viewLayout,
    ]);

    return (
      <div
        ref={ref}
        className="selection-layer pointer-events-none absolute inset-0 z-[1]"
        style={{
          willChange: "transform",
        }}
      >
        {selectionBoxes.map((box, index) => (
          <div
            key={index}
            className="editor-selection-box absolute"
            style={{
              top: `${box.top}px`,
              left: `${box.left}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
              borderTopLeftRadius: box.corners.topLeft ? undefined : 0,
              borderTopRightRadius: box.corners.topRight ? undefined : 0,
              borderBottomRightRadius: box.corners.bottomRight ? undefined : 0,
              borderBottomLeftRadius: box.corners.bottomLeft ? undefined : 0,
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
    prev.lines === next.lines &&
    prev.lineOffsets === next.lineOffsets &&
    prev.contentLength === next.contentLength &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight &&
    prev.tabSize === next.tabSize &&
    prev.selectionOffsets?.start === next.selectionOffsets?.start &&
    prev.selectionOffsets?.end === next.selectionOffsets?.end &&
    prev.lineBreakFillWidth === next.lineBreakFillWidth &&
    prev.lineTextResolver === next.lineTextResolver &&
    prev.viewportRange?.startLine === next.viewportRange?.startLine &&
    prev.viewportRange?.endLine === next.viewportRange?.endLine &&
    prev.wordWrap === next.wordWrap &&
    prev.viewLayout === next.viewLayout
  );
});
