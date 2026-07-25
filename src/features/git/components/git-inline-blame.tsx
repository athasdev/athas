import {
  CheckIcon as Check,
  ClockIcon as Clock,
  CopyIcon as Copy,
  GitBranchIcon as GitBranch,
  GitCommitIcon as GitCommit,
} from "@/ui/icons";
import { useCallback, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useSelectionScope } from "@/features/editor/hooks/use-selection-scope";
import "@/features/editor/styles/overlay-card.css";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import { formatRelativeTime } from "@/utils/date";
import { useGitBlameStore } from "../stores/git-blame.store";
import type { GitBlameLine } from "../types/git.types";
import { openCommitDiffBuffer } from "../utils/open-commit-diff-buffer";

interface InlineGitBlameProps {
  blameLine: GitBlameLine;
  containerClassName?: string;
  className?: string;
  fontSize?: number;
  lineHeight?: number;
}

export const InlineGitBlame = ({
  blameLine,
  containerClassName,
  className,
  fontSize,
  lineHeight,
}: InlineGitBlameProps) => {
  const [showCard, setShowCard] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const settingsFontSize = useSettingsStore((state) => state.settings.fontSize);
  const effectiveFontSize = fontSize ?? settingsFontSize;
  const effectiveLineHeight =
    lineHeight ?? settingsFontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER;

  useSelectionScope(popoverRef, showCard);

  const handleCopyCommitHash = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      await writeClipboardText(blameLine.commit_hash.substring(0, 7));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    },
    [blameLine.commit_hash],
  );

  const handleViewCommit = useCallback(async () => {
    const { filePath } = useEditorStateStore.getState();
    const { getRepoPath } = useGitBlameStore.getState().actions;
    const repoPath = getRepoPath(filePath);

    if (!repoPath) return;

    try {
      await openCommitDiffBuffer({
        repoPath,
        commitHash: blameLine.commit_hash,
      });
    } catch (error) {
      console.error("Error getting commit diff:", error);
    }
  }, [blameLine.commit_hash]);

  return (
    <HoverCard open={showCard} onOpenChange={setShowCard}>
      <HoverCardTrigger
        delay={1000}
        closeDelay={150}
        render={
          <div
            className={cn("relative flex items-center", containerClassName)}
            style={{ height: `${effectiveLineHeight}px` }}
          />
        }
      >
        <div
          className={cn("ml-2 flex items-center gap-1 text-text-lighter", className)}
          style={{
            fontSize: `${effectiveFontSize}px`,
            lineHeight: 1,
            verticalAlign: "top",
            whiteSpace: "nowrap",
          }}
        >
          <span className="flex shrink-0 items-center">
            <GitBranch size={effectiveFontSize} />
          </span>
          <span>{blameLine.author},</span>
          <span>{formatRelativeTime(blameLine.time)}</span>
        </div>
      </HoverCardTrigger>

      <HoverCardContent
        ref={popoverRef}
        side="bottom"
        align="start"
        sideOffset={8}
        className="editor-overlay-card min-w-92 p-0"
        onClick={(event) => event.stopPropagation()}
        onSelect={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex max-w-96 flex-col gap-2 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium ui-text-sm text-text">{blameLine.author}</span>
            <div className="flex shrink-0 items-center gap-1 text-text-lighter ui-text-sm">
              <Clock />
              <span>{formatRelativeTime(blameLine.time)}</span>
            </div>
          </div>

          <pre className="whitespace-pre-wrap break-words text-text-light ui-text-sm leading-relaxed">
            {blameLine.commit.trim()}
          </pre>

          <div className="flex items-center gap-1.5 text-text-lighter ui-text-sm">
            <Button
              type="button"
              variant="ghost"
              className="gap-1.5 px-1.5"
              onClick={handleViewCommit}
              tooltip="View commit details"
              size="xs"
            >
              <GitCommit />
              <span className="font-sans text-text">{blameLine.commit_hash.substring(0, 7)}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="ml-auto text-text-lighter hover:text-text"
              onClick={handleCopyCommitHash}
              tooltip="Copy commit hash"
              size="icon-xs"
            >
              {isCopied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

export default InlineGitBlame;
