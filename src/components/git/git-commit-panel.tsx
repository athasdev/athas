import { AlertCircle, GitCommit as GitCommitIcon, Send } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { commitChanges } from "../../utils/git";

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

  if (stagedFilesCount === 0) {
    return null;
  }

  return (
    <div className="border-t border-[var(--border-color)] bg-[var(--secondary-bg)]">
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <GitCommitIcon size={12} className="text-[var(--text-lighter)]" />
          <span className="text-xs text-[var(--text-color)] font-medium">
            Commit {stagedFilesCount} file{stagedFilesCount !== 1 ? "s" : ""}
          </span>
        </div>

        {error && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-red-900 bg-opacity-20 border border-red-500 border-opacity-30 rounded text-xs text-red-400">
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        <div className="space-y-2">
          <textarea
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter commit message..."
            className="w-full bg-[var(--primary-bg)] text-[var(--text-color)] border border-[var(--border-color)] px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-blue-500 resize-none"
            rows={3}
            disabled={isCommitting}
          />

          <div className="flex items-center justify-between">
            <div className="text-[9px] text-[var(--text-lighter)]">Ctrl+Enter to commit</div>

            <button
              onClick={handleCommit}
              disabled={isCommitDisabled}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-mono border transition-colors duration-150 rounded ${
                isCommitDisabled
                  ? "bg-[var(--secondary-bg)] border-[var(--border-color)] text-[var(--text-lighter)] cursor-not-allowed"
                  : "bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
              }`}
            >
              {isCommitting ? (
                <>
                  <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                  Committing...
                </>
              ) : (
                <>
                  <Send size={12} />
                  Commit
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitCommitPanel;
