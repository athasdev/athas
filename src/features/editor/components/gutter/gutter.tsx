import { memo, useEffect, useMemo, useRef, useState } from "react";
import { calculateTotalGutterWidth } from "../../utils/gutter";
import { DiagnosticIndicators } from "./diagnostic-indicators";
import { FoldIndicators } from "./fold-indicators";
import { GitIndicators } from "./git-indicators";
import { LineNumbers } from "./line-numbers";

interface LineMapping {
  actualToVirtual: Map<number, number>;
  virtualToActual: Map<number, number>;
  foldedRanges: Array<{ start: number; end: number; virtualLine: number }>;
}

interface GutterProps {
  totalLines: number;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  filePath?: string;
  onLineClick?: (lineNumber: number) => void;
  onGitIndicatorClick?: (lineNumber: number, type: "added" | "modified" | "deleted") => void;
  foldMapping?: LineMapping;
}

const BUFFER_LINES = 20;
const GUTTER_PADDING = 8;

function GutterComponent({
  totalLines,
  fontSize,
  fontFamily,
  lineHeight,
  textareaRef,
  filePath,
  onLineClick,
  onGitIndicatorClick,
  foldMapping,
}: GutterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const totalWidth = calculateTotalGutterWidth(totalLines);
  const totalContentHeight = totalLines * lineHeight + GUTTER_PADDING * 2;

  useEffect(() => {
    const textarea = textareaRef.current;
    const container = containerRef.current;
    if (!textarea || !container) return;

    const syncScroll = () => {
      setScrollTop(textarea.scrollTop);
    };

    const updateHeight = () => {
      setContainerHeight(container.clientHeight);
    };

    syncScroll();
    updateHeight();

    textarea.addEventListener("scroll", syncScroll);
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);

    return () => {
      textarea.removeEventListener("scroll", syncScroll);
      resizeObserver.disconnect();
    };
  }, [textareaRef, totalLines]);

  const viewportRange = useMemo(() => {
    const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - BUFFER_LINES);
    const visibleLines = Math.ceil(containerHeight / lineHeight);
    const endLine = Math.min(
      totalLines,
      Math.floor(scrollTop / lineHeight) + visibleLines + BUFFER_LINES,
    );
    return { startLine, endLine };
  }, [scrollTop, containerHeight, lineHeight, totalLines]);

  return (
    <div
      ref={containerRef}
      className="flex select-none bg-primary-bg"
      style={{
        width: `${totalWidth}px`,
        height: "100%",
        borderRight: "1px solid var(--border, rgba(255, 255, 255, 0.06))",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <div
        className="relative flex"
        style={{
          height: `${totalContentHeight}px`,
          transform: `translateY(-${scrollTop}px)`,
          willChange: "transform",
        }}
      >
        <GitIndicators
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onIndicatorClick={onGitIndicatorClick}
          startLine={viewportRange.startLine}
          endLine={viewportRange.endLine}
        />

        <DiagnosticIndicators
          filePath={filePath}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          startLine={viewportRange.startLine}
          endLine={viewportRange.endLine}
        />

        <LineNumbers
          totalLines={totalLines}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onLineClick={onLineClick}
          foldMapping={foldMapping}
          startLine={viewportRange.startLine}
          endLine={viewportRange.endLine}
        />

        <FoldIndicators
          filePath={filePath}
          lineHeight={lineHeight}
          fontSize={fontSize}
          foldMapping={foldMapping}
          startLine={viewportRange.startLine}
          endLine={viewportRange.endLine}
        />
      </div>
    </div>
  );
}

GutterComponent.displayName = "Gutter";

export const Gutter = memo(GutterComponent, (prev, next) => {
  return (
    prev.totalLines === next.totalLines &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.lineHeight === next.lineHeight
  );
});
