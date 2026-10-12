import { memo, Suspense, useMemo } from "react";
import { getDiffBanner } from "../../services/diff-banner-registry";
import { useDiffData } from "../../hooks/use-git-diff-data";
import { ViewerErrorState, ViewerLoadingState, ViewerState } from "@/ui/viewer-state";
import type { DiffViewerProps, MultiFileDiff } from "../../types/git-diff.types";
import GitDiffEditorStack from "./git-diff-editor-stack";
import GitDiffEditorSurface from "./git-diff-editor-surface";
import { BinaryDiffViewer } from "./git-diff-binary";
import ImageDiffViewer from "./git-diff-image";

function isMultiFileDiff(data: unknown): data is MultiFileDiff {
  return typeof data === "object" && data !== null && "files" in data && Array.isArray(data.files);
}

const DiffViewer = memo(({ bufferId }: DiffViewerProps) => {
  const { diff, rawDiffData, filePath, isLoading, error } = useDiffData(bufferId);

  const multiFileDiff = useMemo(() => {
    if (rawDiffData && isMultiFileDiff(rawDiffData)) {
      return rawDiffData;
    }
    return null;
  }, [rawDiffData]);

  if (multiFileDiff) {
    const Banner = getDiffBanner(multiFileDiff.commitHash);
    if (Banner) {
      return (
        <div className="flex h-full flex-col overflow-hidden bg-background">
          <Suspense fallback={null}>
            <Banner bufferId={bufferId} />
          </Suspense>
          <div className="min-h-0 flex-1">
            <GitDiffEditorStack bufferId={bufferId} multiDiff={multiFileDiff} />
          </div>
        </div>
      );
    }
    return <GitDiffEditorStack bufferId={bufferId} multiDiff={multiFileDiff} />;
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
        cacheKey={bufferId}
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
