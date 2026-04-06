import { memo, useEffect, useMemo, useRef, useState } from "react";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { calculateTotalGutterWidth } from "../../utils/gutter";
import { DiagnosticIndicators } from "./diagnostic-indicators";
import { FoldIndicators } from "./fold-indicators";
import { GitIndicators } from "./git-indicators";
import { LineNumbers } from "./line-numbers";
import { FlowLineNumbers } from "./flow-line-numbers";

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
  wordWrap?: boolean;
  lines?: string[];
  contentWidth?: number;
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
  wordWrap = false,
  lines,
  contentWidth,
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
  const isDiffAccordionBuffer = filePath?.startsWith("diff-editor://") ?? false;

  // When word wrap is on, use flow-based gutter that syncs scrollTop directly
  const useFlowGutter = wordWrap && !!lines && !!contentWidth && contentWidth > 0;

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
      scrollTopRef.current = scrollTop;

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          content.style.transform = `translateY(-${scrollTopRef.current}px)`;
          updateViewport(scrollTopRef.current);
          rafId = null;
        });
      }
    };

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
  }, [textareaRef, totalLines, lineHeight, virtualize, useFlowGutter]);

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

  const textWidth = contentWidth
    ? contentWidth - EDITOR_CONSTANTS.EDITOR_PADDING_LEFT - EDITOR_CONSTANTS.EDITOR_PADDING_RIGHT
    : 0;
  const accordionLineSet = useMemo(() => {
    const result = new Set<number>();
    if (!isDiffAccordionBuffer || !lines) return result;

    lines.forEach((line, index) => {
      if (parseDiffAccordionLine(line)) {
        result.add(index);
      }
    });

    return result;
  }, [isDiffAccordionBuffer, lines]);

  const accordionGutterDecorations = useMemo(() => {
    if (!isDiffAccordionBuffer || !lines || useFlowGutter) return null;

    const items = [];
    for (let i = computedViewport.startLine; i < computedViewport.endLine; i++) {
      const meta = parseDiffAccordionLine(lines[i] || "");
      if (!meta) continue;

      items.push(
        <div
          key={`accordion-gutter-${i}`}
          className="diff-accordion-gutter-line"
          style={{
            position: "absolute",
            top: `${i * lineHeight + EDITOR_CONSTANTS.GUTTER_PADDING}px`,
            left: 0,
            width: `${totalWidth}px`,
            height: `${lineHeight}px`,
          }}
        >
          <div className="diff-accordion-gutter-card" />
        </div>,
      );
    }

    return items;
  }, [isDiffAccordionBuffer, lines, useFlowGutter, computedViewport, lineHeight, totalWidth]);

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
          height: useFlowGutter ? undefined : `${totalContentHeight}px`,
          willChange: "transform",
        }}
      >
        {useFlowGutter ? (
          <FlowLineNumbers
            lines={lines!}
            lineHeight={lineHeight}
            fontSize={fontSize}
            fontFamily={fontFamily}
            textWidth={textWidth}
            onLineClick={onLineClick}
            foldMapping={foldMapping}
            filePath={filePath}
          />
        ) : (
          <>
            {accordionGutterDecorations}
            <GitIndicators
              lineHeight={lineHeight}
              fontSize={fontSize}
              fontFamily={fontFamily}
              onIndicatorClick={onGitIndicatorClick}
              startLine={computedViewport.startLine}
              endLine={computedViewport.endLine}
              hiddenLines={accordionLineSet}
            />

            <DiagnosticIndicators
              filePath={filePath}
              lineHeight={lineHeight}
              fontSize={fontSize}
              fontFamily={fontFamily}
              startLine={computedViewport.startLine}
              endLine={computedViewport.endLine}
              hiddenLines={accordionLineSet}
            />

            <FoldIndicators
              filePath={isDiffAccordionBuffer ? undefined : filePath}
              lineHeight={lineHeight}
              fontSize={fontSize}
              foldMapping={foldMapping}
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
              hiddenLines={accordionLineSet}
            />
          </>
        )}
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
    prev.foldMapping === next.foldMapping &&
    prev.wordWrap === next.wordWrap &&
    prev.lines === next.lines &&
    prev.contentWidth === next.contentWidth
  );
});
