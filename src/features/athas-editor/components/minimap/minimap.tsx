import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Token } from "@/features/athas-editor/utils/html";
import { MinimapCanvas } from "./minimap-canvas";
import {
  buildSearchMarks,
  getMinimapRenderMetrics,
  getScrollTopFromMinimapY,
} from "./minimap-utils";

interface MinimapProps {
  lines: string[];
  lineStarts: number[];
  tokens: Token[];
  scrollTop: number;
  viewportHeight: number;
  totalHeight: number;
  lineHeight: number;
  scale: number;
  width: number;
  cursorLine?: number;
  searchMatches?: Array<{ start: number; end: number }>;
  currentSearchMatchIndex?: number;
  onScrollTo: (scrollTop: number) => void;
}

function MinimapComponent({
  lines,
  lineStarts,
  tokens,
  scrollTop,
  viewportHeight,
  totalHeight,
  lineHeight,
  scale,
  width,
  cursorLine,
  searchMatches = [],
  currentSearchMatchIndex = -1,
  onScrollTo,
}: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateHeight = () => {
      setContainerHeight(container.getBoundingClientRect().height);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const metrics = useMemo(
    () =>
      getMinimapRenderMetrics({
        preferredScale: scale,
        totalHeight,
        viewportHeight,
        scrollTop,
        containerHeight,
      }),
    [containerHeight, scale, scrollTop, totalHeight, viewportHeight],
  );

  const searchMarks = useMemo(
    () =>
      buildSearchMarks({
        matches: searchMatches,
        currentMatchIndex: currentSearchMatchIndex,
        lineStarts,
        lineHeight,
        renderScale: metrics.renderScale,
      }),
    [currentSearchMatchIndex, lineHeight, lineStarts, metrics.renderScale, searchMatches],
  );

  const calculateScrollFromY = useCallback(
    (clientY: number) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const y = clientY - rect.top;
      const newScrollTop = getScrollTopFromMinimapY({
        y,
        renderScale: metrics.renderScale,
        viewportHeight,
        totalHeight,
      });

      onScrollTo(newScrollTop);
    },
    [metrics.renderScale, viewportHeight, totalHeight, onScrollTo],
  );

  const handleMouseDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
      calculateScrollFromY(e.clientY);
    },
    [calculateScrollFromY],
  );

  const handleMouseMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      calculateScrollFromY(e.clientY);
    },
    [isDragging, calculateScrollFromY],
  );

  const handleMouseUp = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
  }, []);

  const handlePointerCancel = useCallback(() => {
    setIsDragging(false);
  }, []);

  const cursorTop =
    typeof cursorLine === "number" ? cursorLine * lineHeight * metrics.renderScale : undefined;

  return (
    <div
      ref={containerRef}
      className="minimap"
      style={{
        width: `${width}px`,
        height: "100%",
        position: "relative",
        backgroundColor: "var(--secondary-bg)",
        borderLeft: "1px solid var(--border)",
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "pointer",
        touchAction: "none",
      }}
      onPointerDown={handleMouseDown}
      onPointerMove={handleMouseMove}
      onPointerUp={handleMouseUp}
      onPointerCancel={handlePointerCancel}
    >
      <MinimapCanvas
        lines={lines}
        lineStarts={lineStarts}
        tokens={tokens}
        width={width}
        height={metrics.renderHeight}
        scale={metrics.renderScale}
        lineHeight={lineHeight}
      />

      {searchMarks.map((mark, index) => (
        <div
          key={`${mark.top}-${index}`}
          style={{
            position: "absolute",
            top: `${Math.max(0, Math.min(mark.top, metrics.renderHeight - 2))}px`,
            right: 2,
            width: mark.active ? 8 : 5,
            height: mark.active ? 3 : 2,
            backgroundColor: mark.active ? "var(--accent)" : "var(--warning)",
            borderRadius: 1,
            pointerEvents: "none",
            opacity: mark.active ? 1 : 0.85,
          }}
        />
      ))}

      {cursorTop !== undefined && (
        <div
          style={{
            position: "absolute",
            top: `${Math.max(0, Math.min(cursorTop, metrics.renderHeight - 2))}px`,
            left: 0,
            right: 0,
            height: 2,
            backgroundColor: "var(--accent)",
            opacity: 0.75,
            pointerEvents: "none",
          }}
        />
      )}

      <div
        className="minimap-viewport"
        style={{
          position: "absolute",
          top: `${metrics.viewportTop}px`,
          left: 0,
          right: 0,
          height: `${metrics.viewportHeight}px`,
          backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent) 32%, transparent)",
          pointerEvents: "none",
          transition: isDragging ? "none" : "top 0.05s ease-out",
        }}
      />
    </div>
  );
}

export const Minimap = memo(MinimapComponent);
