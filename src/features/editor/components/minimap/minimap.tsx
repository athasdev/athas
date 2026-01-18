import { memo, useCallback, useRef, useState } from "react";
import type { Token } from "../../utils/html";
import { MinimapCanvas } from "./minimap-canvas";

interface MinimapProps {
  content: string;
  tokens: Token[];
  scrollTop: number;
  viewportHeight: number;
  totalHeight: number;
  lineHeight: number;
  scale: number;
  width: number;
  onScrollTo: (scrollTop: number) => void;
}

function MinimapComponent({
  content,
  tokens,
  scrollTop,
  viewportHeight,
  totalHeight,
  lineHeight,
  scale,
  width,
  onScrollTo,
}: MinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Calculate scaled dimensions
  const scaledTotalHeight = totalHeight * scale;
  const scaledViewportHeight = viewportHeight * scale;
  const scaledScrollTop = scrollTop * scale;

  // Clamp viewport indicator position
  const maxIndicatorTop = Math.max(0, scaledTotalHeight - scaledViewportHeight);
  const indicatorTop = Math.min(scaledScrollTop, maxIndicatorTop);

  const calculateScrollFromY = useCallback(
    (clientY: number) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const y = clientY - rect.top;

      // Calculate the target scroll position
      // Center the viewport on the clicked position
      const targetY = y / scale - viewportHeight / 2;
      const maxScroll = totalHeight - viewportHeight;
      const newScrollTop = Math.max(0, Math.min(targetY, maxScroll));

      onScrollTo(newScrollTop);
    },
    [scale, viewportHeight, totalHeight, onScrollTo],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      calculateScrollFromY(e.clientY);
    },
    [calculateScrollFromY],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      calculateScrollFromY(e.clientY);
    },
    [isDragging, calculateScrollFromY],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

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
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <MinimapCanvas
        content={content}
        tokens={tokens}
        width={width}
        height={scaledTotalHeight}
        scale={scale}
        lineHeight={lineHeight}
      />

      {/* Viewport indicator */}
      <div
        className="minimap-viewport"
        style={{
          position: "absolute",
          top: `${indicatorTop}px`,
          left: 0,
          right: 0,
          height: `${Math.max(scaledViewportHeight, 20)}px`,
          backgroundColor: "rgba(255, 255, 255, 0.1)",
          border: "1px solid rgba(255, 255, 255, 0.2)",
          pointerEvents: "none",
          transition: isDragging ? "none" : "top 0.05s ease-out",
        }}
      />
    </div>
  );
}

export const Minimap = memo(MinimapComponent);
