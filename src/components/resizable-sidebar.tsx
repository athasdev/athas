import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../utils/cn";

interface ResizableSidebarProps {
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
}

const ResizableSidebar = ({
  children,
  defaultWidth = 220,
  minWidth = 180,
  maxWidth = 400,
  className,
}: ResizableSidebarProps) => {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | undefined>(undefined);

  // Throttle resize updates for better performance
  const throttledSetWidth = useCallback((newWidth: number) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      setWidth(newWidth);
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = width;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - startX;
        const newWidth = Math.min(Math.max(startWidth + deltaX, minWidth), maxWidth);
        throttledSetWidth(newWidth);
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
    [width, minWidth, maxWidth, throttledSetWidth],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div className="flex h-full">
      <div
        ref={sidebarRef}
        style={{ width: `${width}px` }}
        className={cn(
          "bg-[var(--secondary-bg)] flex flex-col h-full border-r border-[var(--border-color)] relative",
          className,
        )}
      >
        {children}

        {/* Resize Handle */}
        <div
          ref={resizerRef}
          onMouseDown={handleMouseDown}
          className={cn(
            "absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/30 transition-colors duration-150 group",
            isResizing && "bg-blue-500/50",
          )}
        >
          <div className="absolute top-0 right-0 w-[3px] h-full -translate-x-[1px] opacity-0 group-hover:opacity-100 bg-blue-500 transition-opacity duration-150" />
        </div>
      </div>
    </div>
  );
};

export default ResizableSidebar;
