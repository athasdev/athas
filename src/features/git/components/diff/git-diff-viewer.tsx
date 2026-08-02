import { memo, useMemo } from "react";
import { useDiffData } from "../../hooks/use-git-diff-data";
import { Empty, EmptyDescription } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
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
    return (
      <Empty className="h-full rounded-none bg-background">
        <EmptyDescription>
          <Spinner label="Loading diff" showLabel />
        </EmptyDescription>
      </Empty>
    );
  }

  if (error) {
    return (
      <Empty className="h-full rounded-none bg-background" tone="error" role="alert">
        <EmptyDescription>{error}</EmptyDescription>
      </Empty>
    );
  }

  if (!diff || !filePath) {
    return (
      <Empty className="h-full rounded-none bg-background">
        <EmptyDescription>No diff data available</EmptyDescription>
      </Empty>
    );
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
