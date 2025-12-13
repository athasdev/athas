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
const VIEWPORT_UPDATE_THRESHOLD = 10;

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
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const [viewportRange, setViewportRange] = useState({ startLine: 0, endLine: 50 });
  const [containerHeight, setContainerHeight] = useState(0);

  const totalWidth = calculateTotalGutterWidth(totalLines);
  const totalContentHeight = totalLines * lineHeight + GUTTER_PADDING * 2;

  useEffect(() => {
    const textarea = textareaRef.current;
    const container = containerRef.current;
    const content = contentRef.current;
    if (!textarea || !container || !content) return;

    let rafId: number | null = null;

    const updateViewport = (scrollTop: number) => {
      const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - BUFFER_LINES);
      const visibleLines = Math.ceil(containerHeight / lineHeight);
      const endLine = Math.min(
        totalLines,
        Math.floor(scrollTop / lineHeight) + visibleLines + BUFFER_LINES,
      );

      const startDiff = Math.abs(startLine - viewportRange.startLine);
      const endDiff = Math.abs(endLine - viewportRange.endLine);

      if (startDiff > VIEWPORT_UPDATE_THRESHOLD || endDiff > VIEWPORT_UPDATE_THRESHOLD) {
        setViewportRange({ startLine, endLine });
      }
    };

    const syncScroll = () => {
      const scrollTop = textarea.scrollTop;
      scrollTopRef.current = scrollTop;

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          // Apply transform in RAF to sync with main editor layers
          content.style.transform = `translateY(-${scrollTopRef.current}px)`;
          updateViewport(scrollTopRef.current);
          rafId = null;
        });
      }
    };

    // Forward wheel events from gutter to textarea for consistent scrolling
    const forwardWheel = (e: WheelEvent) => {
      e.preventDefault();
      textarea.scrollTop += e.deltaY;
      textarea.scrollLeft += e.deltaX;
    };

    const updateHeight = () => {
      setContainerHeight(container.clientHeight);
    };

    syncScroll();
    updateHeight();
    updateViewport(textarea.scrollTop);

    textarea.addEventListener("scroll", syncScroll, { passive: true });
    container.addEventListener("wheel", forwardWheel, { passive: false });
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);

    return () => {
      textarea.removeEventListener("scroll", syncScroll);
      container.removeEventListener("wheel", forwardWheel);
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [
    textareaRef,
    totalLines,
    lineHeight,
    containerHeight,
    viewportRange.startLine,
    viewportRange.endLine,
  ]);

  const computedViewport = useMemo(() => {
    const visibleLines = Math.ceil(containerHeight / lineHeight);
    const endLine = Math.min(
      totalLines,
      Math.floor(scrollTopRef.current / lineHeight) + visibleLines + BUFFER_LINES,
    );
    return {
      startLine: viewportRange.startLine,
      endLine: Math.max(viewportRange.endLine, endLine),
    };
  }, [viewportRange, containerHeight, lineHeight, totalLines]);

  return (
    <div
      ref={containerRef}
      className="flex select-none self-stretch bg-primary-bg"
      style={{
        width: `${totalWidth}px`,
        borderRight: "1px solid var(--border, rgba(255, 255, 255, 0.06))",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <div
        ref={contentRef}
        className="relative flex"
        style={{
          height: `${totalContentHeight}px`,
          willChange: "transform",
        }}
      >
        <GitIndicators
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onIndicatorClick={onGitIndicatorClick}
          startLine={computedViewport.startLine}
          endLine={computedViewport.endLine}
        />

        <DiagnosticIndicators
          filePath={filePath}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          startLine={computedViewport.startLine}
          endLine={computedViewport.endLine}
        />

        <LineNumbers
          totalLines={totalLines}
          lineHeight={lineHeight}
          fontSize={fontSize}
          fontFamily={fontFamily}
          onLineClick={onLineClick}
          foldMapping={foldMapping}
          startLine={computedViewport.startLine}
          endLine={computedViewport.endLine}
        />

        <FoldIndicators
          filePath={filePath}
          lineHeight={lineHeight}
          fontSize={fontSize}
          foldMapping={foldMapping}
          startLine={computedViewport.startLine}
          endLine={computedViewport.endLine}
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
