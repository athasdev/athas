import { memo, useCallback, useMemo } from "react";
import { useDiffData } from "../../hooks/use-diff-data";
import { useDiffViewState } from "../../hooks/use-diff-view";
import type { DiffViewerProps, MultiFileDiff } from "../../types/diff";
import DiffHeader from "./header";
import ImageDiffViewer from "./image";
import MultiFileDiffViewer from "./multi-file";
import TextDiffViewer from "./text";

function isMultiFileDiff(data: any): data is MultiFileDiff {
  return data && "files" in data && Array.isArray(data.files);
}

const DiffViewer = memo(({ onStageHunk, onUnstageHunk }: DiffViewerProps) => {
  const { diff, rawDiffData, filePath, isStaged, isLoading, error } = useDiffData();
  const { viewMode, showWhitespace, setViewMode, setShowWhitespace } = useDiffViewState();

  const handleShowWhitespaceChange = useCallback(
    (show: boolean) => {
      setShowWhitespace(show);
    },
    [setShowWhitespace],
  );

  const multiFileDiff = useMemo(() => {
    if (rawDiffData && isMultiFileDiff(rawDiffData)) {
      return rawDiffData;
    }
    return null;
  }, [rawDiffData]);

  if (multiFileDiff) {
    return <MultiFileDiffViewer multiDiff={multiFileDiff} onClose={() => {}} />;
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-primary-bg">
        <div className="text-sm text-text-lighter">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-primary-bg">
        <div className="text-error text-sm">{error}</div>
      </div>
    );
  }

  if (!diff || !filePath) {
    return (
      <div className="flex h-full items-center justify-center bg-primary-bg">
        <div className="text-sm text-text-lighter">No diff data available</div>
      </div>
    );
  }

  const fileName = filePath.split("/").pop() || filePath;

  if (diff.is_image) {
    return <ImageDiffViewer diff={diff} fileName={fileName} onClose={() => {}} />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-primary-bg">
      <DiffHeader
        fileName={fileName}
        diff={diff}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showWhitespace={showWhitespace}
        onShowWhitespaceChange={handleShowWhitespaceChange}
      />

      <div className="flex-1 overflow-auto">
        <TextDiffViewer
          diff={diff}
          isStaged={isStaged}
          viewMode={viewMode}
          showWhitespace={showWhitespace}
          onStageHunk={onStageHunk}
          onUnstageHunk={onUnstageHunk}
        />
      </div>
    </div>
  );
});

DiffViewer.displayName = "DiffViewer";

export default DiffViewer;
