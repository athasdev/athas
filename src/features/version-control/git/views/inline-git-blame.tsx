import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Check, Clock, Copy, GitBranch, GitCommit } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEventListener } from "usehooks-ts";
import { useOverlayManager } from "@/features/editor/components/overlays/overlay-manager";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useThrottledCallback } from "@/features/editor/hooks/use-performance";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useSettingsStore } from "@/features/settings/store";
import { useGitBlameStore } from "@/stores/git-blame-store";
import { cn } from "@/utils/cn";
import { formatRelativeTime } from "@/utils/date";
import type { MultiFileDiff } from "../../diff-viewer/models/diff-types";
import { getCommitDiff } from "../controllers/git";
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
  const { showOverlay, hideOverlay, shouldShowOverlay } = useOverlayManager();

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
      showOverlay("git-blame");
    }
  }, [clearHideTimeout, showCard, updatePosition, showOverlay]);

  const hidePopover = useCallback(() => {
    scheduleHide();
    hideOverlay("git-blame");
  }, [scheduleHide, hideOverlay]);

  const handleCopyCommitHash = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      await writeText(blameLine.commit_hash.substring(0, 7));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    },
    [blameLine.commit_hash],
  );

  const handleViewCommit = useCallback(async () => {
    const { filePath } = useEditorStateStore.getState();
    const { getRepoPath } = useGitBlameStore.getState();
    const repoPath = getRepoPath(filePath);

    if (!repoPath) return;

    try {
      const diffs = await getCommitDiff(repoPath, blameLine.commit_hash);

      if (diffs && diffs.length > 0) {
        const totalAdditions = diffs.reduce(
          (sum, diff) => sum + diff.lines.filter((line) => line.line_type === "added").length,
          0,
        );
        const totalDeletions = diffs.reduce(
          (sum, diff) => sum + diff.lines.filter((line) => line.line_type === "removed").length,
          0,
        );

        const multiDiff: MultiFileDiff = {
          commitHash: blameLine.commit_hash,
          files: diffs,
          totalFiles: diffs.length,
          totalAdditions,
          totalDeletions,
        };

        const virtualPath = `diff://commit/${blameLine.commit_hash}/all-files`;
        const displayName = `Commit ${blameLine.commit_hash.substring(0, 7)} (${diffs.length} files)`;

        useBufferStore
          .getState()
          .actions.openBuffer(
            virtualPath,
            displayName,
            JSON.stringify(multiDiff),
            false,
            false,
            true,
            true,
            multiDiff,
          );
      }
    } catch (error) {
      console.error("Error getting commit diff:", error);
    }
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

    // Always try to show when hovering - overlay manager will handle hiding if needed
    if (isOverTrigger || isOverPopover) {
      showPopover();
    } else {
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
        style={{ fontSize: `${settings.fontSize}px`, whiteSpace: "nowrap" }}
      >
        <GitBranch size={settings.fontSize} />
        <span>{blameLine.author},</span>
        <span>{formatRelativeTime(blameLine.time)}</span>
      </div>

      {showCard &&
        shouldShowOverlay("git-blame") &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed min-w-92 rounded-lg border border-border bg-primary-bg shadow-xl"
            style={{
              zIndex: EDITOR_CONSTANTS.Z_INDEX.GIT_BLAME,
              left: `${position.x}px`,
              top: `${position.y}px`,
            }}
            // TODO: Fix this
            onClick={(e) => e.stopPropagation()}
            onSelect={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex max-w-96 flex-col gap-2 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-sm text-text">{blameLine.author}</span>
                <div className="flex shrink-0 items-center gap-1 text-text-lighter text-xs">
                  <Clock size={11} />
                  <span>{formatRelativeTime(blameLine.time)}</span>
                </div>
              </div>

              <pre className="whitespace-pre-wrap break-words text-text-light text-xs leading-relaxed">
                {blameLine.commit.trim()}
              </pre>

              <div className="flex items-center gap-1.5 text-text-lighter text-xs">
                <button
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-accent/10"
                  onClick={handleViewCommit}
                  title="View commit details"
                >
                  <GitCommit size={11} />
                  <span className="font-mono text-text">
                    {blameLine.commit_hash.substring(0, 7)}
                  </span>
                </button>
                <button
                  className="ml-auto text-text-lighter transition-colors hover:text-text"
                  onClick={handleCopyCommitHash}
                  title="Copy commit hash"
                >
                  {isCopied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
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
