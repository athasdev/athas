import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { useDiffViewState } from "../../hooks/use-diff-view";
import type { FileDiffSummary, MultiFileDiffViewerProps } from "../../types/diff";
import type { GitDiff } from "../../types/git";
import { getFileStatus } from "../../utils/diff-helpers";
import DiffHeader from "./header";
import ImageDiffViewer from "./image";
import TextDiffViewer from "./text";

const LARGE_DIFF_THRESHOLD = 500;

const FileDiffSection = memo(
  ({
    diff,
    summary,
    isExpanded,
    onToggle,
    viewMode,
    showWhitespace,
    commitHash,
  }: {
    diff: GitDiff;
    summary: FileDiffSummary;
    isExpanded: boolean;
    onToggle: () => void;
    viewMode: "unified" | "split";
    showWhitespace: boolean;
    commitHash: string;
  }) => {
    const statusColors: Record<string, string> = {
      added: "text-git-added",
      deleted: "text-git-deleted",
      modified: "text-git-modified",
      renamed: "text-git-renamed",
    };

    return (
      <div className="border-border border-b last:border-b-0">
        <div
          className={cn(
            "group flex cursor-pointer items-center gap-2 px-3 py-1.5",
            "bg-secondary-bg text-xs hover:bg-hover",
          )}
          onClick={onToggle}
        >
          {isExpanded ? (
            <ChevronDown size={12} className="text-text-lighter" />
          ) : (
            <ChevronRight size={12} className="text-text-lighter" />
          )}

          <FileText size={12} className={cn("shrink-0", statusColors[summary.status])} />

          <span className="truncate text-text">{summary.fileName}</span>

          {diff.is_renamed && diff.old_path && (
            <span className="text-text-lighter">← {diff.old_path.split("/").pop()}</span>
          )}

          <div className="ml-auto flex items-center gap-2 text-[10px]">
            {summary.additions > 0 && <span className="text-git-added">+{summary.additions}</span>}
            {summary.deletions > 0 && (
              <span className="text-git-deleted">-{summary.deletions}</span>
            )}
            <span className={cn("rounded px-1 py-0.5 capitalize", statusColors[summary.status])}>
              {summary.status}
            </span>
          </div>
        </div>

        {isExpanded && (
          <div className="border-border border-t">
            {diff.is_image ? (
              <ImageDiffViewer
                diff={diff}
                fileName={summary.fileName}
                onClose={() => {}}
                commitHash={commitHash}
              />
            ) : (
              <TextDiffViewer
                diff={diff}
                isStaged={false}
                viewMode={viewMode}
                showWhitespace={showWhitespace}
                isInMultiFileView={true}
              />
            )}
          </div>
        )}
      </div>
    );
  },
);

FileDiffSection.displayName = "FileDiffSection";

const MultiFileDiffViewer = memo(({ multiDiff, onClose }: MultiFileDiffViewerProps) => {
  const { viewMode, showWhitespace, setViewMode, setShowWhitespace } = useDiffViewState();

  const fileSummaries: FileDiffSummary[] = useMemo(() => {
    return multiDiff.files.map((diff) => {
      let additions = 0;
      let deletions = 0;
      for (const line of diff.lines) {
        if (line.line_type === "added") additions++;
        else if (line.line_type === "removed") deletions++;
      }

      return {
        fileName: diff.file_path.split("/").pop() || diff.file_path,
        filePath: diff.file_path,
        status: getFileStatus(diff) as "added" | "deleted" | "modified" | "renamed",
        additions,
        deletions,
        shouldAutoCollapse: additions + deletions > LARGE_DIFF_THRESHOLD,
      };
    });
  }, [multiDiff.files]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => {
    if (multiDiff.files.length > 50) return new Set<string>();
    const initialExpanded = new Set<string>();
    fileSummaries.forEach((summary) => {
      if (!summary.shouldAutoCollapse) {
        initialExpanded.add(summary.filePath);
      }
    });
    return initialExpanded;
  });

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandedFiles(new Set(fileSummaries.map((s) => s.filePath)));
  }, [fileSummaries]);

  const handleCollapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: multiDiff.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const isExpanded = expandedFiles.has(multiDiff.files[index].file_path);
      if (!isExpanded) return 30;
      const lineCount = multiDiff.files[index].lines.length;
      return 30 + Math.min(lineCount * 20, 2000);
    },
    overscan: 5,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <DiffHeader
        commitHash={multiDiff.commitHash}
        totalFiles={multiDiff.totalFiles}
        onExpandAll={handleExpandAll}
        onCollapseAll={handleCollapseAll}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showWhitespace={showWhitespace}
        onShowWhitespaceChange={setShowWhitespace}
        onClose={onClose}
      />

      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const diff = multiDiff.files[virtualItem.index];
            const summary = fileSummaries[virtualItem.index];
            return (
              <div
                key={diff.file_path}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <FileDiffSection
                  diff={diff}
                  summary={summary}
                  isExpanded={expandedFiles.has(diff.file_path)}
                  onToggle={() => toggleFile(diff.file_path)}
                  viewMode={viewMode}
                  showWhitespace={showWhitespace}
                  commitHash={multiDiff.commitHash}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-border border-t bg-secondary-bg px-3 py-1 text-[10px] text-text-lighter">
        <span>
          {multiDiff.totalFiles} file{multiDiff.totalFiles !== 1 ? "s" : ""} changed
        </span>
        <div className="flex items-center gap-2">
          <span className="text-git-added">+{multiDiff.totalAdditions}</span>
          <span className="text-git-deleted">-{multiDiff.totalDeletions}</span>
        </div>
      </div>
    </div>
  );
});

MultiFileDiffViewer.displayName = "MultiFileDiffViewer";

export default MultiFileDiffViewer;
