import { Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { applyStash, dropStash, popStash } from "../../api/git-stash-api";
import { useGitStore } from "../../stores/git-store";
import GitSidebarSectionHeader from "../git-sidebar-section-header";

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
        <div className="shrink-0 px-1 py-1">
          {showHeader ? (
            <GitSidebarSectionHeader
              title="Stashes"
              collapsible
              isCollapsed={isCollapsed}
              onToggle={onToggle}
            />
          ) : (
            <GitSidebarSectionHeader title="Stashes" />
          )}
        </div>

        {!isCollapsed && (
          <div
            className={cn(
              "scrollbar-none min-h-0 flex-1 overflow-y-scroll px-1 pb-1",
              showHeader ? "bg-primary-bg/70" : "bg-transparent",
            )}
          >
            {stashes.length === 0 ? (
              <div className="ui-text-sm px-2.5 py-2 text-text-lighter italic">No stashes</div>
            ) : (
              stashes.map((stash) => (
                <div
                  key={stash.index}
                  onClick={() => handleStashClick(stash.index)}
                  className="group relative mb-1 cursor-pointer rounded-xl px-2.5 py-2.5 transition-colors hover:bg-hover/80"
                >
                  <div className="min-w-0 pr-2 sm:pr-24">
                    <div
                      className="ui-text-sm truncate leading-tight text-text"
                      title={stash.message}
                    >
                      {stash.message || "Stashed changes"}
                    </div>
                    <div className="ui-text-sm mt-1 text-text-lighter">
                      {formatRelativeDate(stash.date)}
                    </div>
                  </div>
                  <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border/60 bg-primary-bg/92 p-0.5 opacity-100 shadow-sm backdrop-blur-sm transition-all sm:pointer-events-none sm:translate-x-1 sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:translate-x-0 sm:group-hover:opacity-100">
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
