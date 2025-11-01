import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";
import { calculateTooltipPosition } from "@/utils/fit-viewport";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export default function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();

    const { x, y } = calculateTooltipPosition(triggerRect, tooltipRect, side);

    setPosition({ x, y });
  };

  const showTooltip = () => {
    setIsVisible(true);
  };

  const hideTooltip = () => {
    setIsVisible(false);
  };

  useEffect(() => {
    if (isVisible) {
      updatePosition();

      const handleMouseMove = (e: MouseEvent) => {
        if (!triggerRef.current) return;

        const rect = triggerRef.current.getBoundingClientRect();
        const isOverTrigger =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;

        if (!isOverTrigger) {
          hideTooltip();
        }
      };

      const handleResize = () => {
        hideTooltip();
      };

      const handleScroll = () => {
        hideTooltip();
      };

      document.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("resize", handleResize);
      window.addEventListener("scroll", handleScroll, true);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("resize", handleResize);
        window.removeEventListener("scroll", handleScroll, true);
      };
    }
  }, [isVisible]);

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-block"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        {children}
      </div>
      {isVisible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={tooltipRef}
            className={cn(
              "pointer-events-none fixed z-[99999] whitespace-nowrap rounded border border-border bg-secondary-bg px-2 py-1 text-text text-xs shadow-lg",
              className,
            )}
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
