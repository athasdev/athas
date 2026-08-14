import { memo, useMemo } from "react";
import type { FileNavigatorItem } from "@/features/file-explorer/components/file-navigator-sidebar";
import { ReviewWorkspace } from "@/features/review/components/review-workspace";
import {
  ViewerErrorState,
  ViewerLoadingState,
  ViewerState,
} from "@/features/viewer/components/viewer-state";
import { FileDiffView } from "./file-diff-view";

interface DiffFileItem {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified" | "renamed";
  lines?: string[];
}

interface PRFilesPanelProps {
  selectedPRDiff: string | null;
  isLoadingContent: boolean;
  contentError: string | null;
  diffFiles: DiffFileItem[];
  selectedDiffFile: DiffFileItem | null;
  selectedFilePath: string | null;
  isActive: boolean;
  patchError?: string;
  onRetry: () => void;
  onSelectFile: (path: string) => void;
  onOpenChangedFile: (relativePath: string) => void;
}

export const PRFilesPanel = memo(
  ({
    selectedPRDiff,
    isLoadingContent,
    contentError,
    diffFiles,
    selectedDiffFile,
    selectedFilePath,
    isActive,
    patchError,
    onRetry,
    onSelectFile,
    onOpenChangedFile,
  }: PRFilesPanelProps) => {
    const diffNavigationItems = useMemo<FileNavigatorItem[]>(
      () =>
        diffFiles.map((file) => ({
          key: file.path,
          path: file.path,
          iconTone: file.status,
          metadata: [
            ...(file.additions > 0
              ? [{ label: `+${file.additions}`, tone: "added" as const }]
              : []),
            ...(file.deletions > 0
              ? [{ label: `-${file.deletions}`, tone: "deleted" as const }]
              : []),
          ],
        })),
      [diffFiles],
    );

    if (isLoadingContent && !selectedPRDiff) {
      return <ViewerLoadingState label="Loading diff" layout="section" className="min-h-0" />;
    }

    if (contentError) {
      return (
        <ViewerErrorState
          message={contentError}
          actionLabel="Retry"
          onAction={onRetry}
          layout="section"
          className="min-h-0"
        />
      );
    }

    if (diffFiles.length === 0) {
      return <ViewerState description="No file changes" layout="section" className="min-h-0" />;
    }

    return (
      <ReviewWorkspace
        items={diffNavigationItems}
        selectedKey={selectedFilePath}
        onSelect={onSelectFile}
        isActive={isActive}
      >
        {selectedDiffFile ? (
          <FileDiffView
            file={selectedDiffFile}
            isExpanded
            isStatic
            showHeader={false}
            onToggle={() => {}}
            onOpenFile={onOpenChangedFile}
            isLoadingPatch={false}
            patchError={patchError}
          />
        ) : (
          <ViewerState description="Select a file" className="h-full" />
        )}
      </ReviewWorkspace>
    );
  },
);

PRFilesPanel.displayName = "PRFilesPanel";
