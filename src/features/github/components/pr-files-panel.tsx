import { memo, useMemo, useState } from "react";
import {
  type MultibufferSection,
  MultibufferWorkspace,
} from "@/features/editor/components/multibuffer/multibuffer-workspace";
import type { FileNavigatorViewMode } from "@/features/file-explorer/components/file-navigator-sidebar";
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
  selectedFilePath: string | null;
  isActive: boolean;
  patchErrors?: Record<string, string | undefined>;
  onRetry: () => void;
  onSelectFile: (path: string) => void;
  onOpenChangedFile: (relativePath: string) => void;
}

function estimatePatchHeight(file: DiffFileItem) {
  return Math.min(760, 40 + (file.lines?.length ?? 8) * 20);
}

export const PRFilesPanel = memo(
  ({
    selectedPRDiff,
    isLoadingContent,
    contentError,
    diffFiles,
    selectedFilePath,
    isActive,
    patchErrors,
    onRetry,
    onSelectFile,
    onOpenChangedFile,
  }: PRFilesPanelProps) => {
    const [isNavigatorOpen, setIsNavigatorOpen] = useState(false);
    const [navigatorViewMode, setNavigatorViewMode] = useState<FileNavigatorViewMode>("flat");
    const sections = useMemo<MultibufferSection[]>(
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
          trailing: (
            <>
              {file.oldPath ? <span className="truncate">from {file.oldPath}</span> : null}
              {file.additions > 0 ? (
                <span className="text-git-added">+{file.additions}</span>
              ) : null}
              {file.deletions > 0 ? (
                <span className="text-git-deleted">-{file.deletions}</span>
              ) : null}
            </>
          ),
          onOpen: file.status === "deleted" ? undefined : () => onOpenChangedFile(file.path),
          estimatedHeight: estimatePatchHeight(file),
          render: () => (
            <FileDiffView
              file={file}
              isExpanded
              isStatic
              showHeader={false}
              onToggle={() => {}}
              onOpenFile={onOpenChangedFile}
              isLoadingPatch={file.lines === undefined}
              patchError={patchErrors?.[file.path]}
            />
          ),
        })),
      [diffFiles, onOpenChangedFile, patchErrors],
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
      <MultibufferWorkspace
        sections={sections}
        selectedKey={selectedFilePath}
        onSelect={onSelectFile}
        navigatorLabel="Changed files"
        navigatorOpen={isNavigatorOpen}
        onNavigatorOpenChange={setIsNavigatorOpen}
        navigatorViewMode={navigatorViewMode}
        onNavigatorViewModeChange={setNavigatorViewMode}
        isActive={isActive}
        header={{
          title: "Changed files",
          detail: `${diffFiles.length} ${diffFiles.length === 1 ? "file" : "files"}`,
        }}
      />
    );
  },
);

PRFilesPanel.displayName = "PRFilesPanel";
