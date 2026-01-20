import { Archive, ChevronDown, ChevronRight, Clock, Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { cn } from "@/utils/cn";
import { applyStash, dropStash, popStash } from "../controllers/git";
import { useGitStore } from "../controllers/store";

interface GitStashPanelProps {
  repoPath?: string;
  onRefresh?: () => void;
}

const GitStashPanel = ({ repoPath, onRefresh }: GitStashPanelProps) => {
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

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
          const diffMins = Math.floor(diffMs / (1000 * 60));
          return diffMins <= 1 ? "just now" : `${diffMins}m ago`;
        }
        return `${diffHours}h ago`;
      } else if (diffDays === 1) {
        return "yesterday";
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        return date.toLocaleDateString();
      }
    } catch {
      return dateString;
    }
  };

  return (
    <div
      className={cn(
        "border-border border-b transition-[flex-grow] duration-200",
        !isCollapsed ? "flex min-h-0 flex-1 flex-col" : "flex-none",
      )}
    >
      <div
        className="flex shrink-0 cursor-pointer items-center justify-between bg-secondary-bg px-3 py-1 text-text-lighter hover:bg-hover"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <Archive size={10} />
          <span className="text-[10px]">stashes ({stashes.length})</span>
        </div>
      </div>

      {!isCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-primary-bg">
          {stashes.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-text-lighter italic">No stashes found</div>
          ) : (
            <div className="h-full">
              {stashes.map((stash) => (
                <div
                  key={stash.index}
                  className="group relative border-border border-b px-3 py-2 last:border-b-0 hover:bg-hover"
                >
                  <div className="mb-1 flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className="font-mono text-[9px] text-text-lighter">
                          stash@&#123;{stash.index}&#125;
                        </span>
                        <span className="flex items-center gap-1 text-[9px] text-text-lighter">
                          <Clock size={8} />
                          {formatDate(stash.date)}
                        </span>
                      </div>
                      <div className="truncate text-[10px] text-text" title={stash.message}>
                        {stash.message || "Stashed changes"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => handleApplyStash(stash.index, e)}
                      disabled={actionLoading.has(stash.index)}
                      className="flex items-center gap-1 rounded border border-border bg-secondary-bg px-1.5 py-0.5 text-[9px] text-text hover:bg-hover disabled:opacity-50"
                      title="Apply stash"
                    >
                      <Download size={8} /> Apply
                    </button>
                    <button
                      onClick={(e) => handlePopStash(stash.index, e)}
                      disabled={actionLoading.has(stash.index)}
                      className="flex items-center gap-1 rounded border border-border bg-secondary-bg px-1.5 py-0.5 text-[9px] text-text hover:bg-hover disabled:opacity-50"
                      title="Pop stash"
                    >
                      <Upload size={8} /> Pop
                    </button>
                    <button
                      onClick={(e) => handleDropStash(stash.index, e)}
                      disabled={actionLoading.has(stash.index)}
                      className="flex items-center gap-1 rounded border border-border bg-secondary-bg px-1.5 py-0.5 text-[9px] text-red-400 hover:bg-red-900/20 hover:text-red-300 disabled:opacity-50"
                      title="Drop stash"
                    >
                      <Trash2 size={8} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GitStashPanel;
