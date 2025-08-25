import { Clock, Copy, GitBranch, Hash } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyToClipboard } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import { formatDate, formatRelativeTime } from "@/utils/date";
import type { GitBlameLine } from "../models/git-types";

interface InlineGitBlameProps {
  blameLine: GitBlameLine;
  className?: string;
}

export const InlineGitBlame = ({ blameLine, className }: InlineGitBlameProps) => {
  const [showCard, setShowCard] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const POPOVER_MARGIN = 8;
  const HIDE_DELAY = 100; // Small delay to prevent flickering

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      setShowCard(false);
    }, HIDE_DELAY);
  }, [clearHideTimeout]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Estimate popover dimensions (will be adjusted after render)
    const popoverWidth = 384; // w-96 = 384px
    const popoverHeight = 200; // estimated height

    let x = rect.left;
    let y = rect.bottom + POPOVER_MARGIN;

    // Adjust horizontal position to keep popover in viewport
    if (x + popoverWidth > viewportWidth - POPOVER_MARGIN) {
      x = viewportWidth - popoverWidth - POPOVER_MARGIN;
    }
    if (x < POPOVER_MARGIN) {
      x = POPOVER_MARGIN;
    }

    // Adjust vertical position if popover would go below viewport
    if (y + popoverHeight > viewportHeight - POPOVER_MARGIN) {
      y = rect.top - popoverHeight - POPOVER_MARGIN;
    }

    setPosition({ x, y });
  }, []);

  const showPopover = useCallback(() => {
    clearHideTimeout();
    if (!showCard) {
      updatePosition();
      setShowCard(true);
    }
  }, [clearHideTimeout, showCard, updatePosition]);

  const hidePopover = useCallback(() => {
    scheduleHide();
  }, [scheduleHide]);

  // Adjust position after popover is rendered with actual dimensions
  useEffect(() => {
    if (showCard && triggerRef.current && popoverRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const popoverRect = popoverRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let x = triggerRect.left;
      let y = triggerRect.bottom + POPOVER_MARGIN;

      // Adjust horizontal position to keep popover in viewport
      if (x + popoverRect.width > viewportWidth - POPOVER_MARGIN) {
        x = viewportWidth - popoverRect.width - POPOVER_MARGIN;
      }
      if (x < POPOVER_MARGIN) {
        x = POPOVER_MARGIN;
      }

      // Adjust vertical position if popover would go below viewport
      if (y + popoverRect.height > viewportHeight - POPOVER_MARGIN) {
        y = triggerRect.top - popoverRect.height - POPOVER_MARGIN;
      }

      setPosition({ x, y });
    }
  }, [showCard]);

  // Handle window events
  useEffect(() => {
    if (!showCard) return;

    const handleResize = () => {
      setShowCard(false);
    };

    const handleScroll = () => {
      setShowCard(false);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [showCard]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      clearHideTimeout();
    };
  }, [clearHideTimeout]);

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        className={cn(
          "ml-2 inline-flex items-center gap-1 text-xs",
          "cursor-pointer text-text-lighter transition-colors hover:text-text",
          className,
        )}
        onMouseEnter={showPopover}
        onMouseLeave={hidePopover}
        onFocus={showPopover}
        onBlur={hidePopover}
      >
        <GitBranch size={9} />
        <span className="text-xs">{blameLine.author},</span>
        <span className="text-xs">{formatRelativeTime(blameLine.time)}</span>
      </button>

      {showCard &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[99999] w-92 rounded-lg border border-border bg-primary-bg p-2 shadow-xl"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
            }}
            onMouseEnter={showPopover}
            onMouseLeave={hidePopover}
          >
            {/* Author info with avatar */}
            <div className="mb-2 flex items-start gap-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 font-medium text-sm text-white">
                {blameLine.author.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="font-medium text-sm text-text">{blameLine.author}</div>
                <div className="break-all text-text-lighter text-xs">&lt;{blameLine.email}&gt;</div>
              </div>
            </div>

            {/* Commit message */}
            <div className="mb-3">
              <div className="mb-1 font-medium text-sm text-text">
                {blameLine.commit || "No commit message"}
              </div>
            </div>

            {/* Footer with date and commit hash */}
            <div className="flex items-center justify-between border-border border-t pt-3 text-text-lighter text-xs">
              <div className="flex items-center gap-1">
                <Clock size={12} />
                <span>{formatDate(blameLine.time)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Hash size={12} />
                <span className="font-mono">{blameLine.commit_hash.substring(0, 7)}</span>
                <button
                  className="transition-colors hover:text-text"
                  onClick={() => copyToClipboard(blameLine.commit_hash)}
                  title="Copy full commit hash"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default InlineGitBlame;
