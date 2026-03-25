import { ChevronDown, ChevronRight, Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { applyStash, dropStash, popStash } from "../../api/git-stash-api";
import { useGitStore } from "../../stores/git-store";

interface GitStashPanelProps {
  isCollapsed: boolean;
  onToggle: () => void;
  repoPath?: string;
  onRefresh?: () => void;
  onViewStashDiff?: (stashIndex: number) => void;
  showHeader?: boolean;
}

const GitStashPanel = ({
  isCollapsed,
  onToggle,
  repoPath,
  onRefresh,
  onViewStashDiff,
  showHeader = true,
}: GitStashPanelProps) => {
  const { stashes } = useGitStore();
  const [actionLoading, setActionLoading] = useState<Set<number>>(new Set());

  const handleStashAction = async (
    action: () => Promise<boolean>,
    stashIndex: number,
    actionName: string,
  ) => {
    if (!repoPath) return;

    setActionLoading((prev) => new Set(prev).add(stashIndex));
    try {
      const success = await action();
      if (success) {
        onRefresh?.();
      } else {
        console.error(`${actionName} failed`);
      }
    } catch (error) {
      console.error(`${actionName} error:`, error);
    } finally {
      setActionLoading((prev) => {
        const newSet = new Set(prev);
        newSet.delete(stashIndex);
        return newSet;
      });
    }
  };

  const handleApplyStash = (stashIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    handleStashAction(() => applyStash(repoPath!, stashIndex), stashIndex, "Apply stash");
  };

  const handlePopStash = (stashIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    handleStashAction(() => popStash(repoPath!, stashIndex), stashIndex, "Pop stash");
  };

  const handleDropStash = (stashIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    handleStashAction(() => dropStash(repoPath!, stashIndex), stashIndex, "Drop stash");
  };

  const handleStashClick = (stashIndex: number) => {
    onViewStashDiff?.(stashIndex);
  };

  return (
    <div
      className={cn(
        "select-none",
        isCollapsed ? "shrink-0" : "flex h-full min-h-0 flex-1 flex-col",
      )}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden",
          showHeader && "rounded-lg border border-border/60 bg-primary-bg/55",
        )}
      >
        {showHeader && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="sticky top-0 z-20 flex h-auto w-full shrink-0 justify-start gap-1 border-border/50 border-b bg-secondary-bg/90 px-2.5 py-1.5 text-text-lighter backdrop-blur-sm hover:bg-hover"
            onClick={onToggle}
          >
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}
            <span className="ui-text-sm font-medium text-text">Stashes</span>
            <div className="flex-1" />
            {stashes.length > 0 && (
              <span className="ui-text-sm rounded-full bg-primary-bg px-1.5">
                {stashes.length}
              </span>
            )}
          </Button>
        )}

        {!isCollapsed && (
          <div
            className={cn(
              "scrollbar-none min-h-0 flex-1 overflow-y-scroll p-1",
              showHeader ? "bg-primary-bg/70" : "bg-transparent",
            )}
          >
            {stashes.length === 0 ? (
              <div className="ui-text-sm px-2.5 py-1.5 text-text-lighter italic">No stashes</div>
            ) : (
              stashes.map((stash) => (
                <div
                  key={stash.index}
                  onClick={() => handleStashClick(stash.index)}
                  className="group mb-1 flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-inherit text-text" title={stash.message}>
                      {stash.message || "Stashed changes"}
                    </div>
                    <div className="ui-text-sm text-text-lighter">
                      {formatRelativeDate(stash.date)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <Button
                      type="button"
                      onClick={(e) => handleApplyStash(stash.index, e)}
                      disabled={actionLoading.has(stash.index)}
                      variant="ghost"
                      size="icon-xs"
                      className="text-text-lighter disabled:opacity-50"
                      title="Apply stash"
                      aria-label="Apply stash"
                    >
                      <Download />
                    </Button>
                    <Button
                      type="button"
                      onClick={(e) => handlePopStash(stash.index, e)}
                      disabled={actionLoading.has(stash.index)}
                      variant="ghost"
                      size="icon-xs"
                      className="text-text-lighter disabled:opacity-50"
                      title="Pop stash"
                      aria-label="Pop stash"
                    >
                      <Upload />
                    </Button>
                    <Button
                      type="button"
                      onClick={(e) => handleDropStash(stash.index, e)}
                      disabled={actionLoading.has(stash.index)}
                      variant="ghost"
                      size="icon-xs"
                      className="text-red-400 hover:bg-red-900/20 hover:text-red-300 disabled:opacity-50"
                      title="Drop stash"
                      aria-label="Drop stash"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GitStashPanel;
