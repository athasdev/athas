import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { formatRelativeDate } from "@/utils/date";
import type { FileDiffSummary, MultiFileDiffViewerProps } from "../../types/git-diff-types";
import type { GitDiff } from "../../types/git-types";
import { getFileStatus } from "../../utils/git-diff-helpers";
import DiffHeader from "./git-diff-header";
import ImageDiffViewer from "./git-diff-image";
import TextDiffViewer from "./git-diff-text";

const LARGE_DIFF_THRESHOLD = 500;

const FileDiffSection = memo(
  ({
    diff,
    summary,
    isExpanded,
    onToggle,
    commitHash,
    viewMode,
    showWhitespace,
  }: {
    diff: GitDiff;
    summary: FileDiffSummary;
    isExpanded: boolean;
    onToggle: () => void;
    commitHash: string;
    viewMode: "unified" | "split";
    showWhitespace: boolean;
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
            "group flex cursor-pointer items-center gap-2 px-3 py-1",
            "bg-primary-bg ui-text-sm leading-5 hover:bg-hover",
          )}
          onClick={onToggle}
        >
          {isExpanded ? (
            <ChevronDown className="text-text-lighter" />
          ) : (
            <ChevronRight className="text-text-lighter" />
          )}

          <FileText className={cn("shrink-0", statusColors[summary.status])} />

          <span className="truncate font-medium text-text">{summary.fileName}</span>

          {diff.is_renamed && diff.old_path && (
            <span className="text-text-lighter">← {diff.old_path.split("/").pop()}</span>
          )}

          <div className="ui-text-sm ml-auto flex items-center gap-2 leading-none">
            {summary.additions > 0 && <span className="text-git-added">+{summary.additions}</span>}
            {summary.deletions > 0 && (
              <span className="text-git-deleted">-{summary.deletions}</span>
            )}
            <span
              className={cn(
                "rounded px-1 py-0.5 capitalize opacity-80",
                statusColors[summary.status],
              )}
            >
              {summary.status}
            </span>
          </div>
        </div>

        {isExpanded && (
          <div
            className="border-border border-t"
            style={{
              contentVisibility: "auto",
              containIntrinsicHeight: `${diff.lines.length * 22}px`,
            }}
          >
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

const CommitMetaHeader = memo(
  ({ multiDiff }: { multiDiff: MultiFileDiffViewerProps["multiDiff"] }) => {
    if (!multiDiff.commitMessage && !multiDiff.commitAuthor && !multiDiff.commitDate) {
      return null;
    }

    return (
      <div className="border-border border-b bg-primary-bg px-3 py-2">
        {multiDiff.commitMessage && (
          <div className="ui-text-sm font-medium text-text">{multiDiff.commitMessage}</div>
        )}
        {multiDiff.commitDescription && (
          <div className="ui-text-sm mt-1 whitespace-pre-wrap text-text-lighter">
            {multiDiff.commitDescription}
          </div>
        )}
        <div className="ui-text-sm mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-lighter">
          {multiDiff.commitAuthor && <span>{multiDiff.commitAuthor}</span>}
          {multiDiff.commitDate && <span>{formatRelativeDate(multiDiff.commitDate)}</span>}
          <span className="font-mono">{multiDiff.commitHash.slice(0, 7)}</span>
        </div>
      </div>
    );
  },
);

CommitMetaHeader.displayName = "CommitMetaHeader";

const MultiFileDiffViewer = memo(({ multiDiff, onClose }: MultiFileDiffViewerProps) => {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(false);
  const fileSummaries: FileDiffSummary[] = useMemo(() => {
    return multiDiff.files.map((diff, index) => {
      let additions = 0;
      let deletions = 0;
      for (const line of diff.lines) {
        if (line.line_type === "added") additions++;
        else if (line.line_type === "removed") deletions++;
      }

      return {
        key: multiDiff.fileKeys?.[index] ?? `${diff.file_path}:${index}`,
        fileName: diff.file_path.split("/").pop() || diff.file_path,
        filePath: diff.file_path,
        status: getFileStatus(diff) as "added" | "deleted" | "modified" | "renamed",
        additions,
        deletions,
        shouldAutoCollapse: additions + deletions > LARGE_DIFF_THRESHOLD,
      };
    });
  }, [multiDiff.fileKeys, multiDiff.files]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => {
    if (multiDiff.files.length > 50) return new Set<string>();
    const initialExpanded = new Set<string>();
    fileSummaries.forEach((summary) => {
      if (!summary.shouldAutoCollapse) {
        initialExpanded.add(summary.key);
      }
    });
    if (multiDiff.initiallyExpandedFileKey) {
      initialExpanded.add(multiDiff.initiallyExpandedFileKey);
    }
    return initialExpanded;
  });

  useEffect(() => {
    const nextExpanded = new Set<string>();

    if (multiDiff.files.length <= 50) {
      fileSummaries.forEach((summary) => {
        if (!summary.shouldAutoCollapse) {
          nextExpanded.add(summary.key);
        }
      });
    }

    if (multiDiff.initiallyExpandedFileKey) {
      nextExpanded.add(multiDiff.initiallyExpandedFileKey);
    }

    setExpandedFiles(nextExpanded);
    virtualizer.measure();
  }, [fileSummaries, multiDiff.files.length, multiDiff.initiallyExpandedFileKey]);

  const toggleFile = useCallback((fileKey: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileKey)) {
        newSet.delete(fileKey);
      } else {
        newSet.add(fileKey);
      }
      return newSet;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandedFiles(new Set(fileSummaries.map((s) => s.key)));
  }, [fileSummaries]);

  const handleCollapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: multiDiff.files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const isExpanded = expandedFiles.has(fileSummaries[index].key);
      if (!isExpanded) return 36;
      const lineCount = multiDiff.files[index].lines.length;
      return 36 + lineCount * 22;
    },
    overscan: 3,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <DiffHeader
        title={multiDiff.title}
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

      <CommitMetaHeader multiDiff={multiDiff} />

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
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
                key={summary.key}
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
                  isExpanded={expandedFiles.has(summary.key)}
                  onToggle={() => toggleFile(summary.key)}
                  commitHash={multiDiff.commitHash}
                  viewMode={viewMode}
                  showWhitespace={showWhitespace}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-border border-t bg-primary-bg px-3 py-1 text-[10px] text-text-lighter">
        <span className="flex items-center gap-1.5">
          {multiDiff.isLoading && <Loader2 className="size-3 animate-spin" />}
          {multiDiff.isLoading
            ? "Loading remaining files..."
            : `${multiDiff.totalFiles} file${multiDiff.totalFiles !== 1 ? "s" : ""} changed`}
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
