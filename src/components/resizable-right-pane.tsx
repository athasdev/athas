import type React from "react";
import { useCallback, useRef, useState } from "react";
import { cn } from "../utils/cn";

interface ResizableRightPaneProps {
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  isVisible?: boolean;
  position?: "left" | "right";
}

const ResizableRightPane = ({
  children,
  defaultWidth = 300,
  minWidth = 200,
  maxWidth = 600,
  className,
  isVisible = true,
  position = "right",
}: ResizableRightPaneProps) => {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = width;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaX =
          position === "right"
            ? startX - e.clientX // Reverse direction for right pane
            : e.clientX - startX; // Normal direction for left pane
        const newWidth = Math.min(Math.max(startWidth + deltaX, minWidth), maxWidth);
        setWidth(newWidth);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width, minWidth, maxWidth, position],
  );

  if (!isVisible) {
    return null;
  }

  return (
    <div className="flex">
      <div
        ref={paneRef}
        style={{ width: `${width}px` }}
        className={cn(
          "bg-[var(--secondary-bg)] flex flex-col flex-1 relative",
          position === "right"
            ? "border-l border-[var(--border-color)]"
            : "border-r border-[var(--border-color)]",
          className,
        )}
      >
        {/* Resize Handle */}
        <div
          ref={resizerRef}
          onMouseDown={handleMouseDown}
          className={cn(
            "absolute top-0 w-1 h-full cursor-col-resize hover:bg-blue-500/30 transition-colors duration-150 group",
            position === "right" ? "left-0" : "right-0",
            isResizing && "bg-blue-500/50",
          )}
        >
          <div
            className={cn(
              "absolute top-0 w-[3px] h-full opacity-0 group-hover:opacity-100 bg-blue-500 transition-opacity duration-150",
              position === "right" ? "left-0 translate-x-[1px]" : "right-0 -translate-x-[1px]",
            )}
          />
        </div>

        {children}
      </div>
    </div>
  );
};

export default ResizableRightPane;
