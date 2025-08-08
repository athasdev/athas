import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/utils/cn";

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

  const TOOLTIP_MARGIN = 8;

  const updatePosition = () => {
    if (!triggerRef.current || !tooltipRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = rect.left;
    let y = rect.top;

    switch (side) {
      case "top":
        x += rect.width / 2;
        y -= TOOLTIP_MARGIN;
        break;
      case "bottom":
        x += rect.width / 2;
        y += rect.height + TOOLTIP_MARGIN;
        break;
      case "left":
        x -= TOOLTIP_MARGIN;
        y += rect.height / 2;
        break;
      case "right":
        x += rect.width + TOOLTIP_MARGIN;
        y += rect.height / 2;
        break;
    }

    if (side === "top" || side === "bottom") {
      const tooltipWidth = tooltipRect.width;

      if (x - tooltipWidth / 2 < TOOLTIP_MARGIN) {
        x = tooltipWidth / 2 + TOOLTIP_MARGIN;
      } else if (x + tooltipWidth / 2 > viewportWidth - TOOLTIP_MARGIN) {
        x = viewportWidth - tooltipWidth / 2 - TOOLTIP_MARGIN;
      }

      const tooltipHeight = tooltipRect.height;
      if (side === "top" && y - tooltipHeight < TOOLTIP_MARGIN) {
        y = rect.bottom + TOOLTIP_MARGIN;
      } else if (side === "bottom" && y + tooltipHeight > viewportHeight - TOOLTIP_MARGIN) {
        y = rect.top - TOOLTIP_MARGIN;
      }
    } else {
      const tooltipWidth = tooltipRect.width;
      const tooltipHeight = tooltipRect.height;

      if (y - tooltipHeight / 2 < TOOLTIP_MARGIN) {
        y = tooltipHeight / 2 + TOOLTIP_MARGIN;
      } else if (y + tooltipHeight / 2 > viewportHeight - TOOLTIP_MARGIN) {
        y = viewportHeight - tooltipHeight / 2 - TOOLTIP_MARGIN;
      }

      if (side === "left" && x - tooltipWidth < TOOLTIP_MARGIN) {
        x = rect.right + TOOLTIP_MARGIN;
      } else if (side === "right" && x + tooltipWidth > viewportWidth - TOOLTIP_MARGIN) {
        x = rect.left - TOOLTIP_MARGIN;
      }
    }

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

  const tooltipClasses = {
    top: "-translate-x-1/2 -translate-y-full",
    bottom: "-translate-x-1/2",
    left: "-translate-x-full -translate-y-1/2",
    right: "-translate-y-1/2",
  };

  const _arrowClasses = {
    top: "top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-border",
    bottom:
      "bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-border",
    left: "left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-border",
    right:
      "right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-border",
  };

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
              tooltipClasses[side],
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
