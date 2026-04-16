import { memo, useMemo } from "react";
import { useDiffData } from "../../hooks/use-git-diff-data";
import type { DiffViewerProps, MultiFileDiff } from "../../types/git-diff-types";
import GitDiffEditorStack from "./git-diff-editor-stack";
import GitDiffEditorSurface from "./git-diff-editor-surface";
import ImageDiffViewer from "./git-diff-image";

function isMultiFileDiff(data: unknown): data is MultiFileDiff {
  return typeof data === "object" && data !== null && "files" in data && Array.isArray(data.files);
}

const DiffViewer = memo((_props: DiffViewerProps) => {
  const { diff, rawDiffData, filePath, isLoading, error } = useDiffData();

  const multiFileDiff = useMemo(() => {
    if (rawDiffData && isMultiFileDiff(rawDiffData)) {
      return rawDiffData;
    }
    return null;
  }, [rawDiffData]);

  if (multiFileDiff) {
    return <GitDiffEditorStack multiDiff={multiFileDiff} />;
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
      <GitDiffEditorSurface
        cacheKey={filePath}
        diff={diff}
        breadcrumbProps={{
          filePathOverride: diff.file_path || filePath,
        }}
      />
    </div>
  );
});

DiffViewer.displayName = "DiffViewer";

export default DiffViewer;
