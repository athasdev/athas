import { useState } from "react";
import {
  Plus,
  Minus,
  Check,
  Edit3,
  FileIcon,
  FilePlus,
  FileX,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  stageFile,
  unstageFile,
  stageAllFiles,
  unstageAllFiles,
  discardFileChanges,
  GitFile,
} from "../../utils/git";

interface GitStatusPanelProps {
  files: GitFile[];
  onFileSelect?: (path: string, staged: boolean) => void;
  onRefresh?: () => void;
  repoPath?: string;
}

const GitStatusPanel = ({ files, onFileSelect, onRefresh, repoPath }: GitStatusPanelProps) => {
  const [isLoading, setIsLoading] = useState(false);

  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => !f.staged);

  const getFileIcon = (file: GitFile) => {
    switch (file.status) {
      case "added":
        return <FilePlus size={10} className="text-green-400" />;
      case "deleted":
        return <FileX size={10} className="text-red-400" />;
      case "modified":
        return <Edit3 size={10} className="text-yellow-400" />;
      case "untracked":
        return <FileIcon size={10} className="text-[var(--text-lighter)]" />;
      case "renamed":
        return <RotateCcw size={10} className="text-blue-400" />;
      default:
        return <FileIcon size={10} className="text-[var(--text-lighter)]" />;
    }
  };

  const getStatusText = (file: GitFile) => {
    switch (file.status) {
      case "added":
        return "A";
      case "deleted":
        return "D";
      case "modified":
        return "M";
      case "untracked":
        return "U";
      case "renamed":
        return "R";
      default:
        return "?";
    }
  };

  const handleStageFile = async (filePath: string) => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await stageFile(repoPath, filePath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnstageFile = async (filePath: string) => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await unstageFile(repoPath, filePath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleStageAll = async () => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await stageAllFiles(repoPath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnstageAll = async () => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await unstageAllFiles(repoPath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscardFile = async (filePath: string) => {
    if (!repoPath) return;
    const confirmed = confirm(`Are you sure you want to discard changes to ${filePath}? This cannot be undone.`);
    if (!confirmed) return;
    
    setIsLoading(true);
    try {
      await discardFileChanges(repoPath, filePath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-0">
      {/* Staged Changes */}
      <div className="border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2 px-3 py-1 bg-[var(--secondary-bg)] text-[var(--text-lighter)]">
          <span className="flex items-center gap-1">
            <Check size={10} />
            <span>staged ({stagedFiles.length})</span>
          </span>
          <div className="flex-1" />
          {stagedFiles.length > 0 && (
            <button
              onClick={handleUnstageAll}
              disabled={isLoading}
              className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors disabled:opacity-50"
              title="Unstage all"
            >
              <Minus size={10} />
            </button>
          )}
        </div>

        {stagedFiles.length === 0 ? (
          <div className="px-3 py-2 bg-[var(--primary-bg)] text-[var(--text-lighter)] text-[10px] italic">
            No staged changes
          </div>
        ) : (
          <div className="bg-[var(--primary-bg)]">
            {stagedFiles.map((file, index) => (
              <div
                key={`staged-${file.path}-${index}`}
                className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--hover-color)] group cursor-pointer"
                onClick={() => onFileSelect?.(file.path, true)}
              >
                <span className="text-[10px] text-[var(--text-lighter)] w-3 text-center font-medium">
                  {getStatusText(file)}
                </span>
                {getFileIcon(file)}
                <span className="flex-1 text-[10px] text-[var(--text-color)] truncate" title={file.path}>
                  {file.path.split("/").pop()}
                </span>
                <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnstageFile(file.path);
                    }}
                    disabled={isLoading}
                    className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors disabled:opacity-50"
                    title="Unstage"
                  >
                    <Minus size={8} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Unstaged Changes */}
      <div className="border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2 px-3 py-1 bg-[var(--secondary-bg)] text-[var(--text-lighter)]">
          <span className="flex items-center gap-1">
            <Edit3 size={10} />
            <span>changes ({unstagedFiles.length})</span>
          </span>
          <div className="flex-1" />
          {unstagedFiles.length > 0 && (
            <button
              onClick={handleStageAll}
              disabled={isLoading}
              className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors disabled:opacity-50"
              title="Stage all"
            >
              <Plus size={10} />
            </button>
          )}
        </div>

        {unstagedFiles.length === 0 ? (
          <div className="px-3 py-2 bg-[var(--primary-bg)] text-[var(--text-lighter)] text-[10px] italic">
            No unstaged changes
          </div>
        ) : (
          <div className="bg-[var(--primary-bg)]">
            {unstagedFiles.map((file, index) => (
              <div
                key={`unstaged-${file.path}-${index}`}
                className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--hover-color)] group cursor-pointer"
                onClick={() => onFileSelect?.(file.path, false)}
              >
                <span className="text-[10px] text-[var(--text-lighter)] w-3 text-center font-medium">
                  {getStatusText(file)}
                </span>
                {getFileIcon(file)}
                <span className="flex-1 text-[10px] text-[var(--text-color)] truncate" title={file.path}>
                  {file.path.split("/").pop()}
                </span>
                <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStageFile(file.path);
                    }}
                    disabled={isLoading}
                    className="text-[var(--text-lighter)] hover:text-[var(--text-color)] transition-colors disabled:opacity-50"
                    title="Stage"
                  >
                    <Plus size={8} />
                  </button>
                  {file.status !== "untracked" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDiscardFile(file.path);
                      }}
                      disabled={isLoading}
                      className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                      title="Discard changes"
                    >
                      <Trash2 size={8} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clean State */}
      {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
        <div className="border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2 px-3 py-1 bg-[var(--secondary-bg)] text-[var(--text-lighter)]">
            <Check size={10} />
            <span>clean</span>
          </div>
          <div className="px-3 py-2 bg-[var(--primary-bg)] text-[var(--text-lighter)] text-[10px] italic">
            No changes detected
          </div>
        </div>
      )}
    </div>
  );
};

export default GitStatusPanel; 