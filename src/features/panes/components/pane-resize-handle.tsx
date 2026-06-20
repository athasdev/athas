import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_PANE_SIZE } from "../constants/pane";

interface PaneResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (sizes: [number, number]) => void;
  onReset?: () => void;
  initialSizes: [number, number];
  resizeHandleCount: number;
}

export function PaneResizeHandle({
  direction,
  onResize,
  onReset,
  initialSizes,
  resizeHandleCount,
}: PaneResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPositionRef = useRef(0);
  const startSizesRef = useRef(initialSizes);
  const availableSizeRef = useRef(0);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPositionRef.current = isHorizontal ? e.clientX : e.clientY;
      startSizesRef.current = initialSizes;

      const handle = containerRef.current;
      const splitContainer = handle?.closest<HTMLElement>("[data-pane-split-container='true']");
      const containerRect = splitContainer?.getBoundingClientRect();
      const containerSize = isHorizontal ? containerRect?.width : containerRect?.height;
      const handleSize = isHorizontal ? (handle?.offsetWidth ?? 0) : (handle?.offsetHeight ?? 0);
      availableSizeRef.current =
        typeof containerSize === "number" ? containerSize - handleSize * resizeHandleCount : 0;

      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isHorizontal, initialSizes, resizeHandleCount],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPosition = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPosition - startPositionRef.current;
      const availableSize = availableSizeRef.current;
      if (availableSize <= 0) return;

      const pairTotal = startSizesRef.current[0] + startSizesRef.current[1];
      const scaledDelta = (delta / availableSize) * pairTotal;

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
      availableSizeRef.current = 0;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, isHorizontal, onResize]);

  return (
    <div
      ref={containerRef}
      className={`group relative flex shrink-0 items-center justify-center ${
        isHorizontal ? "h-full w-1 cursor-col-resize" : "h-1 w-full cursor-row-resize"
      }`}
      onDoubleClick={onReset}
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
