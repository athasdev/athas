import { useCallback, useEffect, useRef, useState } from "react";
import { getPaneResizeLimits, resizePanePair, resizePanePairByPixels } from "../utils/pane-resize";

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
  const pendingSizesRef = useRef<[number, number] | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const previousPaneRef = useRef<HTMLElement | null>(null);
  const nextPaneRef = useRef<HTMLElement | null>(null);

  const isHorizontal = direction === "horizontal";
  const limits = getPaneResizeLimits(initialSizes);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (e.button !== 0) return;
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
      const firstPane = previousPaneRef.current;
      const secondPane = nextPaneRef.current;

      if (firstPane) {
        firstPane.style.flexGrow = String(sizes[0]);
      }
      if (secondPane) {
        secondPane.style.flexGrow = String(sizes[1]);
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

      pendingSizesRef.current = resizePanePairByPixels(startSizesRef.current, delta, availableSize);
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
    window.addEventListener("blur", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleMouseUp);
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
  }, [isDragging, isHorizontal, onResize]);

  return (
    <div
      ref={containerRef}
      className={`group relative flex shrink-0 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
        isHorizontal
          ? "h-full w-workbench cursor-col-resize"
          : "h-workbench w-full cursor-row-resize"
      }`}
      onDoubleClick={onReset}
      onMouseDown={handleMouseDown}
      onKeyDown={(event) => {
        if (isDragging) return;
        const backward = isHorizontal ? "ArrowLeft" : "ArrowUp";
        const forward = isHorizontal ? "ArrowRight" : "ArrowDown";
        if (event.key === "Enter" && onReset) {
          event.preventDefault();
          onReset();
        } else if ([backward, forward, "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 2;
          const delta =
            event.key === "Home"
              ? -limits.total
              : event.key === "End"
                ? limits.total
                : event.key === backward
                  ? -step
                  : step;
          onResize(resizePanePair(initialSizes, delta));
        }
      }}
      role="separator"
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label="Resize panes"
      aria-valuenow={Math.round(initialSizes[0])}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      tabIndex={0}
    >
      <div
        className={`bg-border transition-colors ${
          isDragging ? "bg-primary" : "group-hover:bg-border-strong"
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
