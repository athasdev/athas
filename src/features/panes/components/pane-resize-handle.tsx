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
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const containerSize = isHorizontal ? containerRect.width : containerRect.height;

      const currentPosition = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPosition - startPositionRef.current;
      const deltaPercent = (delta / containerSize) * 100;

      let newFirstSize = startSizesRef.current[0] + deltaPercent;
      let newSecondSize = startSizesRef.current[1] - deltaPercent;

      if (newFirstSize < MIN_PANE_SIZE) {
        newFirstSize = MIN_PANE_SIZE;
        newSecondSize = 100 - MIN_PANE_SIZE;
      } else if (newSecondSize < MIN_PANE_SIZE) {
        newSecondSize = MIN_PANE_SIZE;
        newFirstSize = 100 - MIN_PANE_SIZE;
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
