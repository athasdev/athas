import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_PANE_SIZE } from "../constants/pane";

interface PaneResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (sizes: [number, number]) => void;
  onResizeEnd?: (sizes: [number, number]) => void;
  initialSizes: [number, number];
}

export function PaneResizeHandle({
  direction,
  onResize,
  onResizeEnd,
  initialSizes,
}: PaneResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPositionRef = useRef(0);
  const startSizesRef = useRef(initialSizes);
  const currentSizesRef = useRef(initialSizes);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPositionRef.current = isHorizontal ? e.clientX : e.clientY;
      startSizesRef.current = initialSizes;
      currentSizesRef.current = initialSizes;
    },
    [isHorizontal, initialSizes],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current?.parentElement;
      const handle = containerRef.current;
      if (!container || !handle) return;

      const containerRect = container.getBoundingClientRect();
      const handleSize = isHorizontal ? handle.offsetWidth : handle.offsetHeight;
      const containerSize =
        (isHorizontal ? containerRect.width : containerRect.height) - handleSize;
      if (containerSize <= 0) return;

      const currentPosition = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPosition - startPositionRef.current;

      const pairTotal = startSizesRef.current[0] + startSizesRef.current[1];
      // Scale delta to pair's proportion of the container
      const scaledDelta = (delta / containerSize) * pairTotal;

      let newFirstSize = startSizesRef.current[0] + scaledDelta;
      newFirstSize = Math.max(0, Math.min(pairTotal, newFirstSize));
      const nextSizes: [number, number] = [newFirstSize, pairTotal - newFirstSize];

      currentSizesRef.current = nextSizes;
      onResize(nextSizes);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onResizeEnd?.(currentSizesRef.current);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isHorizontal, onResize, onResizeEnd]);

  return (
    <div
      ref={containerRef}
      className={`group relative flex shrink-0 items-center justify-center ${
        isHorizontal ? "h-full w-px cursor-col-resize z-10" : "h-px w-full cursor-row-resize z-10"
      }`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label="Resize panes"
      aria-valuenow={Math.round(initialSizes[0])}
      aria-valuemin={MIN_PANE_SIZE}
      aria-valuemax={100 - MIN_PANE_SIZE}
      tabIndex={0}
    >
      {/* Invisible expanded hit area for easier grabbing */}
      <div
        className={`absolute ${isHorizontal ? "inset-y-0 -inset-x-2" : "inset-x-0 -inset-y-2"}`}
      />

      {/* Visible line */}
      <div
        className={`transition-colors ${
          isDragging ? "bg-accent/80" : "bg-border/30 group-hover:bg-border/80"
        } ${isHorizontal ? "h-full w-px" : "h-px w-full"}`}
      />
      {isDragging && (
        <div
          className={`pointer-events-none fixed inset-0 z-50 ${
            isHorizontal ? "cursor-col-resize" : "cursor-row-resize"
          }`}
        />
      )}
    </div>
  );
}
