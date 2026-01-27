import { AlertCircle } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { cn } from "@/utils/cn";
import { commitChanges } from "../api/commits";

interface GitCommitPanelProps {
  stagedFilesCount: number;
  repoPath?: string;
  onCommitSuccess?: () => void;
}

const GitCommitPanel = ({ stagedFilesCount, repoPath, onCommitSuccess }: GitCommitPanelProps) => {
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    if (!repoPath || !commitMessage.trim() || stagedFilesCount === 0) return;

    setIsCommitting(true);
    setError(null);

    try {
      const success = await commitChanges(repoPath, commitMessage.trim());
      if (success) {
        setCommitMessage("");
        onCommitSuccess?.();
      } else {
        setError("Failed to commit changes");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown error occurred");
    } finally {
      setIsCommitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleCommit();
    }
  };

  const isCommitDisabled = !commitMessage.trim() || stagedFilesCount === 0 || isCommitting;

  return (
    <div className="border-border border-t bg-primary-bg">
      {error && (
        <div
          className={cn(
            "mx-2 mt-1.5 flex items-center gap-2 rounded border border-error/30",
            "bg-error/20 px-2 py-1 text-error text-xs",
          )}
        >
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <textarea
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Commit message..."
        className={cn(
          "w-full resize-none bg-transparent px-2 py-1.5",
          "ui-font text-[10px] text-text placeholder:text-text-lighter",
          "focus:outline-none",
        )}
        rows={2}
        disabled={isCommitting}
      />

      <div className="flex items-center justify-between border-border border-t px-2 py-1">
        <span className="text-[9px] text-text-lighter">
          {stagedFilesCount > 0
            ? `${stagedFilesCount} file${stagedFilesCount !== 1 ? "s" : ""} staged`
            : "No files staged"}
        </span>

        <button
          onClick={handleCommit}
          disabled={isCommitDisabled}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-0.5",
            "ui-font text-[10px] transition-colors duration-150",
            isCommitDisabled
              ? "cursor-not-allowed bg-secondary-bg text-text-lighter"
              : "bg-accent text-white hover:opacity-90",
          )}
        >
          {isCommitting ? (
            <>
              <div className="h-2.5 w-2.5 animate-spin rounded-full border border-white border-t-transparent"></div>
              Committing
            </>
          ) : (
            "Commit"
          )}
        </button>
      </div>
    </div>
  );
};

export default GitCommitPanel;
