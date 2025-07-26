import { RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { useBufferStore } from "../../stores/buffer-store";
import { cn } from "../../utils/cn";
import { DiffHeader } from "./diff-header";
import { useDiffData } from "./hooks/useDiffData";
import { useDiffViewState } from "./hooks/useDiffViewState";
import { ImageDiffViewer } from "./image-diff-viewer";
import { MultiFileDiffViewer } from "./multi-file-diff-viewer";
import { TextDiffViewer } from "./text-diff-viewer";
import type { DiffViewerProps, MultiFileDiff } from "./utils/types";

function DiffViewer({ onStageHunk, onUnstageHunk }: DiffViewerProps) {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { closeBuffer } = useBufferStore.use.actions();
  const { diff, isStaged, isLoading, error, refresh } = useDiffData();
  const { viewMode, setViewMode, showWhitespace, setShowWhitespace } = useDiffViewState();
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!activeBuffer || !activeBuffer.isDiff) {
    return null;
  }

  const fileName = activeBuffer.name;
  const onClose = () => closeBuffer(activeBuffer.id);

  // Extract commit hash from path if this is a commit diff
  const commitPathMatch = activeBuffer.path?.match(/^diff:\/\/commit\/([a-f0-9]+)\//);
  const commitHash = commitPathMatch?.[1];

  // Check if this is a multi-file diff
  const isMultiFileDiff =
    activeBuffer.path?.startsWith("diff://commit/") &&
    activeBuffer.diffData &&
    typeof activeBuffer.diffData === "object" &&
    "files" in activeBuffer.diffData &&
    Array.isArray((activeBuffer.diffData as any).files);

  // Handle multi-file diff
  if (isMultiFileDiff) {
    const multiDiff = activeBuffer.diffData as MultiFileDiff;
    return <MultiFileDiffViewer multiDiff={multiDiff} onClose={onClose} />;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setIsRefreshing(false);
  };

  // No diff data yet
  if (!diff) {
    return (
      <div className="flex h-full flex-col bg-primary-bg">
        <div
          className={cn(
            "flex items-center justify-between border-border",
            "border-b bg-secondary-bg px-4 py-2",
          )}
        >
          <h3 className="font-medium text-sm text-text">Diff Viewer</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              className={cn("p-1 text-text-lighter hover:text-text", "disabled:opacity-50")}
              title="Refresh diff"
            >
              <RefreshCw size={14} className={isRefreshing || isLoading ? "animate-spin" : ""} />
            </button>
            <button onClick={onClose} className="p-1 text-text-lighter hover:text-text">
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          {error ? (
            <div className="text-center">
              <p className="text-red-400 text-sm">Error: {error}</p>
              <button
                onClick={handleRefresh}
                className="mt-2 rounded bg-hover px-3 py-1 text-text text-xs hover:bg-border"
              >
                Retry
              </button>
            </div>
          ) : (
            <p className="text-sm text-text-lighter">
              {isLoading ? "Loading diff..." : "No diff to display"}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Image diff
  if (diff.is_image) {
    return (
      <ImageDiffViewer diff={diff} fileName={fileName} onClose={onClose} commitHash={commitHash} />
    );
  }

  // Text diff
  return (
    <div className="flex h-full flex-col bg-primary-bg">
      <DiffHeader
        fileName={fileName}
        diff={diff}
        viewMode={viewMode}
        showWhitespace={showWhitespace}
        onViewModeChange={setViewMode}
        onShowWhitespaceChange={setShowWhitespace}
        onClose={onClose}
        commitHash={commitHash}
      />
      <TextDiffViewer
        diff={diff}
        isStaged={isStaged}
        viewMode={viewMode}
        showWhitespace={showWhitespace}
        onStageHunk={onStageHunk}
        onUnstageHunk={onUnstageHunk}
      />
    </div>
  );
}

export default DiffViewer;
