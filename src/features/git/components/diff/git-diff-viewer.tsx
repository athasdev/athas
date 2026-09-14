import { memo, useMemo } from "react";
import { useDiffData } from "../../hooks/use-git-diff-data";
import {
  ViewerErrorState,
  ViewerLoadingState,
  ViewerState,
} from "@/features/viewer/components/viewer-state";
import type { DiffViewerProps, MultiFileDiff } from "../../types/git-diff.types";
import GitDiffEditorStack from "./git-diff-editor-stack";
import GitDiffEditorSurface from "./git-diff-editor-surface";
import { BinaryDiffViewer } from "./git-diff-binary";
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
    return <ViewerLoadingState label="Loading diff" />;
  }

  if (error) {
    return <ViewerErrorState message={error} />;
  }

  if (!diff || !filePath) {
    return <ViewerState description="No diff data available" />;
  }

  const fileName = filePath.split("/").pop() || filePath;

  if (diff.is_image) {
    return <ImageDiffViewer diff={diff} fileName={fileName} onClose={() => {}} />;
  }

  if (diff.is_binary) {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <BinaryDiffViewer fileName={fileName} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
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
