import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_PANE_SIZE } from "../constants/pane";

interface PaneResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (sizes: [number, number]) => void;
  initialSizes: [number, number];
}

export function PaneResizeHandle({ direction, onResize, initialSizes }: PaneResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPositionRef = useRef(0);
  const startSizesRef = useRef(initialSizes);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPositionRef.current = isHorizontal ? e.clientX : e.clientY;
      startSizesRef.current = initialSizes;
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

      const currentPosition = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPosition - startPositionRef.current;

      const pairTotal = startSizesRef.current[0] + startSizesRef.current[1];
      // Scale delta to pair's proportion of the container
      const scaledDelta = (delta / containerSize) * pairTotal;

      let newFirstSize = startSizesRef.current[0] + scaledDelta;
      let newSecondSize = startSizesRef.current[1] - scaledDelta;

      const minSize = Math.min(MIN_PANE_SIZE, pairTotal * 0.1);
      if (newFirstSize < minSize) {
        newFirstSize = minSize;
        newSecondSize = pairTotal - minSize;
      } else if (newSecondSize < minSize) {
        newSecondSize = minSize;
        newFirstSize = pairTotal - minSize;
      }

      onResize([newFirstSize, newSecondSize]);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isHorizontal, onResize]);

  return (
    <div
      ref={containerRef}
      className={`group relative flex shrink-0 items-center justify-center ${
        isHorizontal ? "h-full w-1 cursor-col-resize" : "h-1 w-full cursor-row-resize"
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
      <div
        className={`bg-border transition-colors ${
          isDragging ? "bg-accent" : "group-hover:bg-accent"
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
