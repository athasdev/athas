import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  GitCommit as GitCommitIcon,
  Hash,
  User,
} from "lucide-react";
import { useState } from "react";
import { type GitCommit, getCommitDiff } from "../../utils/git";

interface GitCommitHistoryProps {
  commits: GitCommit[];
  onViewCommitDiff?: (commitHash: string, filePath?: string) => void;
  repoPath?: string;
}

const GitCommitHistory = ({ commits, onViewCommitDiff, repoPath }: GitCommitHistoryProps) => {
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitFiles, setCommitFiles] = useState<Record<string, any[]>>({});
  const [loadingCommits, setLoadingCommits] = useState<Set<string>>(new Set());

  const toggleCommitExpansion = async (commitHash: string) => {
    const newExpanded = new Set(expandedCommits);

    if (expandedCommits.has(commitHash)) {
      // Collapse
      newExpanded.delete(commitHash);
    } else {
      // Expand - load commit files if not already loaded
      newExpanded.add(commitHash);

      if (!commitFiles[commitHash] && repoPath) {
        setLoadingCommits(prev => new Set(prev).add(commitHash));
        try {
          const diffs = await getCommitDiff(repoPath, commitHash);
          setCommitFiles(prev => ({
            ...prev,
            [commitHash]: diffs || [],
          }));
        } catch (error) {
          console.error("Failed to load commit files:", error);
        } finally {
          setLoadingCommits(prev => {
            const newSet = new Set(prev);
            newSet.delete(commitHash);
            return newSet;
          });
        }
      }
    }

    setExpandedCommits(newExpanded);
  };

  const copyCommitHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
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

  const getFileStatusColor = (status: string) => {
    switch (status) {
      case "added":
        return "text-green-400";
      case "deleted":
        return "text-red-400";
      case "modified":
        return "text-yellow-400";
      case "renamed":
        return "text-blue-400";
      default:
        return "text-text-lighter";
    }
  };

  if (commits.length === 0) {
    return (
      <div className="border-border border-b">
        <div className="flex items-center gap-2 bg-secondary-bg px-3 py-1 text-text-lighter">
          <Clock size={10} />
          <span>commits (0)</span>
        </div>
        <div className="bg-primary-bg px-3 py-2 text-[10px] text-text-lighter italic">
          No commits found
        </div>
      </div>
    );
  }

  return (
    <div className="border-border border-b">
      <div className="flex items-center gap-2 bg-secondary-bg px-3 py-1 text-text-lighter">
        <Clock size={10} />
        <span>commits ({commits.length})</span>
      </div>

      <div className="max-h-96 overflow-y-auto bg-primary-bg">
        {commits.map(commit => {
          const isExpanded = expandedCommits.has(commit.hash);
          const files = commitFiles[commit.hash] || [];
          const isLoading = loadingCommits.has(commit.hash);

          return (
            <div key={commit.hash} className="border-border border-b last:border-b-0">
              {/* Commit Header */}
              <div className="cursor-pointer px-3 py-2 hover:bg-hover">
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => toggleCommitExpansion(commit.hash)}
                    className="mt-0.5 text-text-lighter transition-colors hover:text-text"
                  >
                    {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  </button>

                  <GitCommitIcon size={10} className="mt-0.5 flex-shrink-0 text-text-lighter" />

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 font-medium text-[10px] text-text leading-tight">
                      {commit.message}
                    </div>

                    <div className="flex items-center gap-3 text-[9px] text-text-lighter">
                      <span className="flex items-center gap-1">
                        <User size={8} />
                        {commit.author}
                      </span>

                      <span className="flex items-center gap-1">
                        <Clock size={8} />
                        {formatDate(commit.date)}
                      </span>

                      <div className="flex items-center gap-1">
                        <Hash size={8} />
                        <span className="font-mono">{commit.hash.substring(0, 7)}</span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            copyCommitHash(commit.hash);
                          }}
                          className="text-text-lighter transition-colors hover:text-text"
                          title="Copy full hash"
                        >
                          <Copy size={8} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onViewCommitDiff?.(commit.hash);
                    }}
                    className="text-text-lighter transition-colors hover:text-text"
                    title="View commit diff"
                  >
                    <Eye size={10} />
                  </button>
                </div>
              </div>

              {/* Expanded Commit Details */}
              {isExpanded && (
                <div className="bg-secondary-bg px-8 pb-2">
                  {isLoading ? (
                    <div className="text-[9px] text-text-lighter italic">Loading files...</div>
                  ) : files.length > 0 ? (
                    <div className="space-y-1">
                      <div className="mb-1 text-[9px] text-text-lighter">
                        {files.length} file{files.length !== 1 ? "s" : ""} changed
                      </div>
                      {files.map((file, fileIndex) => (
                        <div
                          key={fileIndex}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[9px] hover:bg-hover"
                          onClick={() => onViewCommitDiff?.(commit.hash, file.file_path)}
                        >
                          <span
                            className={`font-mono ${getFileStatusColor(file.is_new ? "added" : file.is_deleted ? "deleted" : "modified")}`}
                          >
                            {file.is_new ? "A" : file.is_deleted ? "D" : "M"}
                          </span>
                          <span className="truncate text-text">{file.file_path}</span>
                          {file.is_renamed && file.old_path && (
                            <span className="text-text-lighter">← {file.old_path}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[9px] text-text-lighter italic">No files changed</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GitCommitHistory;
