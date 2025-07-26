import { ChevronDown, ChevronRight, FileIcon, FilePlus, FileText, FileX } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { GitDiff } from "../../utils/git";
import { DiffHeader } from "./diff-header";
import { useDiffViewState } from "./hooks/useDiffViewState";
import { ImageDiffViewer } from "./image-diff-viewer";
import { TextDiffViewer } from "./text-diff-viewer";
import type { FileDiffSummary, MultiFileDiffViewerProps } from "./utils/types";

// Memoized file component to prevent unnecessary re-renders
interface FileRowProps {
  diff: GitDiff;
  summary: FileDiffSummary;
  showWhitespace: boolean;
  commitHash: string;
  initiallyCollapsed: boolean;
}

const FileRow = memo(function FileRow({
  diff,
  summary,
  showWhitespace,
  commitHash,
  initiallyCollapsed,
}: FileRowProps) {
  const [isCollapsed, setIsCollapsed] = useState(initiallyCollapsed);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  const getStatusIcon = (status: FileDiffSummary["status"]) => {
    switch (status) {
      case "added":
        return <FilePlus size={12} className="text-green-400" />;
      case "deleted":
        return <FileX size={12} className="text-red-400" />;
      case "renamed":
        return <FileIcon size={12} className="text-blue-400" />;
      default:
        return <FileText size={12} className="text-yellow-400" />;
    }
  };

  const getStatusColor = (status: FileDiffSummary["status"]) => {
    switch (status) {
      case "added":
        return "text-green-400";
      case "deleted":
        return "text-red-400";
      case "renamed":
        return "text-blue-400";
      default:
        return "text-yellow-400";
    }
  };

  return (
    <div className="border-border border-b last:border-b-0">
      {/* File Header */}
      <div
        className="flex cursor-pointer items-center justify-between bg-secondary-bg px-4 py-2 hover:bg-hover"
        onClick={toggleCollapse}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isCollapsed ? (
            <ChevronRight size={12} className="flex-shrink-0 text-text-lighter" />
          ) : (
            <ChevronDown size={12} className="flex-shrink-0 text-text-lighter" />
          )}
          {getStatusIcon(summary.status)}
          <span className="truncate font-mono text-text text-xs">{diff.file_path}</span>
          {diff.is_renamed && diff.old_path && (
            <span className="text-text-lighter text-xs">← {diff.old_path}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {summary.shouldAutoCollapse && (
            <span className="text-[10px] text-text-lighter italic">auto-collapsed</span>
          )}
          <span className={getStatusColor(summary.status)}>{summary.status.toUpperCase()}</span>
          {summary.additions > 0 && <span className="text-green-400">+{summary.additions}</span>}
          {summary.deletions > 0 && <span className="text-red-400">-{summary.deletions}</span>}
        </div>
      </div>

      {/* File Content */}
      {!isCollapsed && (
        <div className="bg-primary-bg">
          {diff.is_image ? (
            <ImageDiffViewer
              diff={diff}
              fileName={summary.fileName}
              onClose={() => {}} // Not used in multi-file context
              commitHash={commitHash}
            />
          ) : (
            <TextDiffViewer
              diff={diff}
              isStaged={false} // Commit diffs are not staged
              viewMode="unified"
              showWhitespace={showWhitespace}
              // No staging actions for commit diffs
            />
          )}
        </div>
      )}
    </div>
  );
});

export function MultiFileDiffViewer({ multiDiff, onClose }: MultiFileDiffViewerProps) {
  const [globalCollapsed, setGlobalCollapsed] = useState<"expanded" | "collapsed" | null>(null);
  const { showWhitespace, setShowWhitespace } = useDiffViewState();

  // Calculate file summaries and auto-collapse logic
  const fileSummaries: FileDiffSummary[] = useMemo(() => {
    const summaries: FileDiffSummary[] = [];

    for (const diff of multiDiff.files) {
      const additions = diff.lines.filter((line) => line.line_type === "added").length;
      const deletions = diff.lines.filter((line) => line.line_type === "removed").length;
      const totalLines = diff.lines.length;

      // Auto-collapse criteria:
      // 1. More than 100 lines of changes in a single file
      // 2. More than 5 files total (collapse all but first 3)
      // 3. Binary files (images) when there are multiple files
      const shouldAutoCollapse = Boolean(
        totalLines > 100 ||
          (multiDiff.totalFiles > 5 && summaries.length >= 3) ||
          (diff.is_binary && multiDiff.totalFiles > 1),
      );

      let status: "added" | "deleted" | "modified" | "renamed";
      if (diff.is_new) status = "added";
      else if (diff.is_deleted) status = "deleted";
      else if (diff.is_renamed) status = "renamed";
      else status = "modified";

      summaries.push({
        fileName: diff.file_path.split("/").pop() || diff.file_path,
        filePath: diff.file_path,
        status,
        additions,
        deletions,
        isCollapsed: shouldAutoCollapse,
        shouldAutoCollapse,
      });
    }

    return summaries;
  }, [multiDiff]);

  const expandAll = () => {
    setGlobalCollapsed("expanded");
    // Reset after a frame to trigger re-render with new initial state
    setTimeout(() => setGlobalCollapsed(null), 0);
  };

  const collapseAll = () => {
    setGlobalCollapsed("collapsed");
    // Reset after a frame to trigger re-render with new initial state
    setTimeout(() => setGlobalCollapsed(null), 0);
  };

  return (
    <div className="flex h-full flex-col bg-primary-bg">
      {/* Header */}
      <DiffHeader
        commitHash={multiDiff.commitHash}
        totalFiles={multiDiff.totalFiles}
        showWhitespace={showWhitespace}
        onShowWhitespaceChange={setShowWhitespace}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onClose={onClose}
      />

      {/* Summary Stats */}
      <div className="border-border border-b bg-secondary-bg px-4 py-2">
        <div className="flex items-center gap-4 text-xs">
          <span className="text-text">
            <span className="text-green-400">+{multiDiff.totalAdditions}</span>{" "}
            <span className="text-red-400">-{multiDiff.totalDeletions}</span>
          </span>
          {fileSummaries.some((f) => f.shouldAutoCollapse) && (
            <span className="text-text-lighter italic">Large files collapsed for performance</span>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        {multiDiff.files.map((diff, index) => {
          const summary = fileSummaries[index];

          // Determine initial collapse state based on global state or auto-collapse
          let initiallyCollapsed = summary.shouldAutoCollapse;
          if (globalCollapsed === "expanded") {
            initiallyCollapsed = false;
          } else if (globalCollapsed === "collapsed") {
            initiallyCollapsed = true;
          }

          return (
            <FileRow
              key={`${diff.file_path}-${globalCollapsed}`} // Key includes globalCollapsed to force re-mount when expand/collapse all is used
              diff={diff}
              summary={summary}
              showWhitespace={showWhitespace}
              commitHash={multiDiff.commitHash}
              initiallyCollapsed={initiallyCollapsed}
            />
          );
        })}

        {multiDiff.files.length === 0 && (
          <div className="flex h-32 items-center justify-center">
            <div className="text-center">
              <FileIcon size={32} className="mx-auto mb-2 text-text-lighter opacity-50" />
              <p className="text-sm text-text-lighter">No files changed in this commit</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
