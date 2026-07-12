import { useCallback, useEffect, useRef, useState } from "react";
import { WORKBENCH_GAP_PX } from "@/features/layout/constants/workbench-layout";
import { MIN_PANE_SIZE } from "../constants/pane";

interface PaneResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (sizes: [number, number]) => void;
  onReset?: () => void;
  initialSizes: [number, number];
  totalSize: number;
  handleDeductionPx: number;
  resizeHandleCount: number;
}

export function PaneResizeHandle({
  direction,
  onResize,
  onReset,
  initialSizes,
  totalSize,
  handleDeductionPx,
  resizeHandleCount,
}: PaneResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startPositionRef = useRef(0);
  const startSizesRef = useRef(initialSizes);
  const availableSizeRef = useRef(0);
  const pendingSizesRef = useRef<[number, number] | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const previousPaneRef = useRef<HTMLElement | null>(null);
  const nextPaneRef = useRef<HTMLElement | null>(null);

  const isHorizontal = direction === "horizontal";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPositionRef.current = isHorizontal ? e.clientX : e.clientY;
      startSizesRef.current = initialSizes;

      const handle = containerRef.current;
      previousPaneRef.current = handle?.previousElementSibling as HTMLElement | null;
      nextPaneRef.current = handle?.nextElementSibling as HTMLElement | null;
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

    const applyPanePreview = (sizes: [number, number]) => {
      const sizeProperty = isHorizontal ? "width" : "height";
      const firstPct = (sizes[0] / totalSize) * 100;
      const secondPct = (sizes[1] / totalSize) * 100;
      const firstPane = previousPaneRef.current;
      const secondPane = nextPaneRef.current;

      if (firstPane) {
        firstPane.style[sizeProperty] = `calc(${firstPct}% - ${handleDeductionPx}px)`;
      }
      if (secondPane) {
        secondPane.style[sizeProperty] = `calc(${secondPct}% - ${handleDeductionPx}px)`;
      }
    };

    const flushPreview = () => {
      resizeFrameRef.current = null;
      const sizes = pendingSizesRef.current;
      if (!sizes) return;
      applyPanePreview(sizes);
    };

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

      pendingSizesRef.current = [newFirstSize, newSecondSize];
      if (resizeFrameRef.current === null) {
        resizeFrameRef.current = requestAnimationFrame(flushPreview);
      }
    };

    const handleMouseUp = () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (pendingSizesRef.current) {
        const sizes = pendingSizesRef.current;
        pendingSizesRef.current = null;
        applyPanePreview(sizes);
        onResize(sizes);
      }
      setIsDragging(false);
      availableSizeRef.current = 0;
      previousPaneRef.current = null;
      nextPaneRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      pendingSizesRef.current = null;
      previousPaneRef.current = null;
      nextPaneRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handleDeductionPx, isDragging, isHorizontal, onResize, totalSize]);

  return (
    <div
      ref={containerRef}
      style={isHorizontal ? { width: WORKBENCH_GAP_PX } : { height: WORKBENCH_GAP_PX }}
      className={`group relative flex shrink-0 items-center justify-center ${
        isHorizontal ? "h-full cursor-col-resize" : "w-full cursor-row-resize"
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
        className={`bg-transparent transition-colors ${
          isDragging ? "bg-accent" : "group-hover:bg-accent"
        } ${isHorizontal ? "h-full w-px" : "h-px w-full"}`}
      />
      {isDragging && (
        <div
          className={`fixed inset-0 z-50 ${
            isHorizontal ? "cursor-col-resize" : "cursor-row-resize"
          }`}
        />
      )}
    </div>
  );
}
