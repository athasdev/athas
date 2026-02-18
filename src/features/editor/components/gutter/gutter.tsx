import { memo, useEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
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
  virtualize?: boolean;
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
  virtualize = true,
  filePath,
  onLineClick,
  onGitIndicatorClick,
  foldMapping,
}: GutterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(0);
  const [viewportRange, setViewportRange] = useState({
    startLine: 0,
    endLine: virtualize
      ? Math.min(50, totalLines)
      : Math.min(totalLines, EDITOR_CONSTANTS.RENDER_VIRTUALIZATION_THRESHOLD),
  });
  const [containerHeight, setContainerHeight] = useState(0);
  const containerHeightRef = useRef(0);
  const viewportRangeRef = useRef(viewportRange);

  const totalWidth = calculateTotalGutterWidth(totalLines);
  const totalContentHeight = totalLines * lineHeight + GUTTER_PADDING * 2;

  useEffect(() => {
    if (!virtualize) {
      const fullRange = { startLine: 0, endLine: totalLines };
      viewportRangeRef.current = fullRange;
      setViewportRange(fullRange);
    }
  }, [virtualize, totalLines]);

  useEffect(() => {
    viewportRangeRef.current = viewportRange;
  }, [viewportRange]);

  useEffect(() => {
    const textarea = textareaRef.current;
    const container = containerRef.current;
    const content = contentRef.current;
    if (!textarea || !container || !content) return;

    let rafId: number | null = null;

    const updateViewport = (scrollTop: number) => {
      if (!virtualize) {
        return;
      }

      const startLine = Math.max(0, Math.floor(scrollTop / lineHeight) - BUFFER_LINES);
      const visibleLines = Math.ceil(containerHeightRef.current / lineHeight);
      const endLine = Math.min(
        totalLines,
        Math.floor(scrollTop / lineHeight) + visibleLines + BUFFER_LINES,
      );

      const prevRange = viewportRangeRef.current;
      const startDiff = Math.abs(startLine - prevRange.startLine);
      const endDiff = Math.abs(endLine - prevRange.endLine);

      if (startDiff > VIEWPORT_UPDATE_THRESHOLD || endDiff > VIEWPORT_UPDATE_THRESHOLD) {
        const nextRange = { startLine, endLine };
        viewportRangeRef.current = nextRange;
        setViewportRange(nextRange);
      }
    };

    const syncScroll = () => {
      const scrollTop = textarea.scrollTop;
      const textareaScrollHeight = textarea.scrollHeight;

      // Scale gutter scroll to match textarea's actual content height
      // This compensates for browser rendering lines at slightly different heights
      // than our calculated lineHeight
      const scrollRatio = textareaScrollHeight > 0 ? totalContentHeight / textareaScrollHeight : 1;
      const adjustedScrollTop = scrollTop * scrollRatio;

      scrollTopRef.current = adjustedScrollTop;

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
      const nextHeight = container.clientHeight;
      containerHeightRef.current = nextHeight;
      setContainerHeight(nextHeight);
    };

    syncScroll();
    updateHeight();

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
  }, [textareaRef, totalLines, lineHeight, virtualize, totalContentHeight]);

  const computedViewport = useMemo(() => {
    if (!virtualize) {
      return {
        startLine: 0,
        endLine: totalLines,
      };
    }

    const visibleLines = Math.ceil(containerHeight / lineHeight);
    const endLine = Math.min(
      totalLines,
      Math.floor(scrollTopRef.current / lineHeight) + visibleLines + BUFFER_LINES,
    );
    const clampedStart = Math.min(viewportRange.startLine, Math.max(0, totalLines - 1));
    const clampedEnd = Math.min(totalLines, Math.max(viewportRange.endLine, endLine));

    return {
      startLine: clampedStart,
      endLine: clampedEnd,
    };
  }, [viewportRange, containerHeight, lineHeight, totalLines, virtualize]);

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
    prev.lineHeight === next.lineHeight &&
    prev.virtualize === next.virtualize &&
    prev.filePath === next.filePath &&
    prev.foldMapping === next.foldMapping
  );
});
