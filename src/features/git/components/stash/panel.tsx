import { ChevronDown, ChevronRight, Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import { applyStash, dropStash, popStash } from "../../api/stash";
import { useGitStore } from "../../stores/git-store";

interface GitStashPanelProps {
  repoPath?: string;
  onRefresh?: () => void;
  onViewStashDiff?: (stashIndex: number) => void;
}

const GitStashPanel = ({ repoPath, onRefresh, onViewStashDiff }: GitStashPanelProps) => {
  const { stashes } = useGitStore();
  const [isCollapsed, setIsCollapsed] = useState(true);
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
    <div className={cn("flex flex-col border-border border-b", !isCollapsed && "min-h-0 flex-1")}>
      <button
        type="button"
        className="flex shrink-0 cursor-pointer items-center gap-1 bg-secondary-bg px-3 py-1 text-text-lighter hover:bg-hover"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        <span className="font-bold text-[10px] uppercase tracking-wide">Stashes</span>
        <div className="flex-1" />
        {stashes.length > 0 && (
          <span className="rounded-full bg-primary-bg px-1.5 text-[9px]">{stashes.length}</span>
        )}
      </button>

      {!isCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {stashes.length === 0 ? (
            <div className="px-3 py-1.5 text-[10px] text-text-lighter italic">No stashes</div>
          ) : (
            stashes.map((stash) => (
              <div
                key={stash.index}
                onClick={() => handleStashClick(stash.index)}
                className="group flex cursor-pointer items-center justify-between gap-2 px-3 py-1 hover:bg-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] text-text" title={stash.message}>
                    {stash.message || "Stashed changes"}
                  </div>
                  <div className="text-[9px] text-text-lighter">
                    {formatRelativeDate(stash.date)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => handleApplyStash(stash.index, e)}
                    disabled={actionLoading.has(stash.index)}
                    className="rounded p-0.5 text-text-lighter hover:bg-secondary-bg hover:text-text disabled:opacity-50"
                    title="Apply stash"
                    aria-label="Apply stash"
                  >
                    <Download size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handlePopStash(stash.index, e)}
                    disabled={actionLoading.has(stash.index)}
                    className="rounded p-0.5 text-text-lighter hover:bg-secondary-bg hover:text-text disabled:opacity-50"
                    title="Pop stash"
                    aria-label="Pop stash"
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDropStash(stash.index, e)}
                    disabled={actionLoading.has(stash.index)}
                    className="rounded p-0.5 text-red-400 hover:bg-red-900/20 hover:text-red-300 disabled:opacity-50"
                    title="Drop stash"
                    aria-label="Drop stash"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default GitStashPanel;
