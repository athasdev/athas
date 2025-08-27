import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Clock, Copy, GitBranch, GitCommit } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEventListener } from "usehooks-ts";
import { editorAPI } from "@/extensions/editor-api";
import { useThrottledCallback } from "@/hooks/use-performance";
import { useSettingsStore } from "@/settings/store";
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
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const documentRef = useRef(document);
  const { settings } = useSettingsStore();
  const [isCopied, setIsCopied] = useState(false);

  const POPOVER_MARGIN = 8;

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
    }, 0);
  }, [clearHideTimeout]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Estimate popover dimensions (will be adjusted after render)
    const popoverRect = popoverRef.current?.getBoundingClientRect();
    const popoverWidth = popoverRect?.width ?? 384;
    const popoverHeight = popoverRect?.height ?? 200;

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
  }, [triggerRef, popoverRef]);

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

  const handleCopyCommitHash = useCallback(async () => {
    await writeText(blameLine.commit_hash.substring(0, 7));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  }, [blameLine.commit_hash]);

  const throttleCallback = useThrottledCallback((e: MouseEvent) => {
    if (!triggerRef.current) return;

    const { clientX, clientY } = e;

    const {
      left: triggerLeft,
      top: triggerTop,
      width: triggerWidth,
      height: triggerHeight,
    } = triggerRef.current.getBoundingClientRect();

    const isOverTrigger =
      clientX >= triggerLeft &&
      clientX <= triggerLeft + triggerWidth &&
      clientY >= triggerTop &&
      clientY <= triggerTop + triggerHeight;

    let isOverPopover = false;
    if (popoverRef.current) {
      const {
        left: popoverLeft,
        top: popoverTop,
        width: popoverWidth,
        height: popoverHeight,
      } = popoverRef.current.getBoundingClientRect();
      isOverPopover =
        clientX >= popoverLeft &&
        clientX <= popoverLeft + popoverWidth &&
        clientY >= popoverTop &&
        clientY <= popoverTop + popoverHeight;
    }

    const textarea = editorAPI.getTextareaRef();
    if (isOverTrigger || isOverPopover) {
      textarea!.classList.add("pointer-events-none");
      showPopover();
    } else {
      textarea!.classList.remove("pointer-events-none");
      hidePopover();
    }
  }, 100);

  useEventListener("mousemove", throttleCallback, documentRef);

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
    <div ref={triggerRef} className="relative inline-flex">
      <div
        className={cn("ml-2 inline-flex items-center gap-1 ", "text-text-lighter", className)}
        style={{ fontSize: `${settings.fontSize}px` }}
      >
        <GitBranch size={settings.fontSize} />
        <span>{blameLine.author},</span>
        <span>{formatRelativeTime(blameLine.time)}</span>
      </div>

      {showCard &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[99999] min-w-92 rounded-lg border border-border bg-primary-bg shadow-xl"
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
            }}
            // TODO: Fix this
            onClick={(e) => e.stopPropagation()}
            onSelect={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 p-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-blue-500 text-white">
                {blameLine.author.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-medium text-sm text-text">{blameLine.author}</span>
                <span className="break-all text-text-lighter text-xs">
                  &lt;{blameLine.email}&gt;
                </span>
              </div>
            </div>

            <div className="p-3 pt-0">
              <pre className="text-sm text-text-light">{blameLine.commit.trim()}</pre>
            </div>

            <div className="flex items-center justify-between border-border border-t p-3 text-text-lighter text-xs">
              <div className="flex items-center gap-1">
                <Clock size={12} />
                <span>{formatDate(blameLine.time)}</span>
              </div>
              <div className="flex items-center gap-1 text-text">
                <GitCommit size={12} />
                <span className="font-mono">{blameLine.commit_hash.substring(0, 7)}</span>
                <button
                  className="ml-1 text-text-lighter transition-colors hover:text-text"
                  onClick={handleCopyCommitHash}
                  title="Copy full commit hash"
                >
                  {isCopied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
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
