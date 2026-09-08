import { Button } from "@/ui/button";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ColumnsIcon,
  RowsIcon,
  TrashIcon,
  XIcon,
} from "@/ui/icons";
import { memo } from "react";
import Breadcrumb from "@/features/editor/components/toolbar/breadcrumb";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { cn } from "@/utils/cn";
import type { DiffHeaderProps } from "../../types/git-diff.types";
import { getFileStatus } from "../../utils/git-diff-helpers";

const DiffHeader = memo(
  ({
    fileName,
    title,
    diff,
    viewMode,
    onViewModeChange,
    totalFiles,
    onExpandAll,
    onCollapseAll,
    showWhitespace,
    onShowWhitespaceChange,
    onClose,
    showDisplayControls = true,
  }: DiffHeaderProps) => {
    const { closeBuffer } = useBufferStore.use.actions();
    const activeBufferId = useBufferStore.use.activeBufferId();

    const handleClose = () => {
      if (onClose) {
        onClose();
      } else if (activeBufferId) {
        closeBuffer(activeBufferId);
      }
    };

    const renderStats = () => {
      if (!diff) return null;

      let additions = 0;
      let deletions = 0;
      for (const l of diff.lines) {
        if (l.line_type === "added") additions++;
        else if (l.line_type === "removed") deletions++;
      }

      return (
        <>
          {additions > 0 && <span className="text-git-added">+{additions}</span>}
          {deletions > 0 && <span className="text-git-deleted">-{deletions}</span>}
        </>
      );
    };

    const renderFileStatus = () => {
      if (!diff) return null;

      const status = getFileStatus(diff);
      const statusColors: Record<string, string> = {
        added: "bg-git-added/20 text-git-added",
        deleted: "bg-git-deleted/20 text-git-deleted",
        modified: "bg-git-modified/20 text-git-modified",
        renamed: "bg-git-renamed/20 text-git-renamed",
      };

      return (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 font-medium ui-text-sm capitalize leading-none",
            statusColors[status],
          )}
        >
          {status}
        </span>
      );
    };

    const isMultiFileView = !!totalFiles;
    const fullPath = diff?.file_path || fileName || "";

    return (
      <div className="sticky top-0 z-10 border-border border-b">
        <Breadcrumb
          filePathOverride={isMultiFileView ? title || "Uncommitted Changes" : fullPath}
          interactive={!isMultiFileView}
          showPath={!isMultiFileView}
          showDefaultActions={false}
          extraLeftContent={
            isMultiFileView ? (
              <span className="text-subtle-foreground">
                {totalFiles} file{totalFiles !== 1 ? "s" : ""}
              </span>
            ) : (
              <>
                {renderFileStatus()}
                <div className="flex items-center gap-2 ui-text-sm">{renderStats()}</div>
              </>
            )
          }
          rightContent={
            <div className="flex items-center gap-1.5 leading-none">
              {isMultiFileView && (
                <>
                  <Button
                    variant="ghost"
                    iconOnly
                    onClick={onExpandAll}
                    tooltip="Expand all"
                    aria-label="Expand all files"
                  >
                    <ChevronDownIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    onClick={onCollapseAll}
                    tooltip="Collapse all"
                    aria-label="Collapse all files"
                  >
                    <ChevronUpIcon />
                  </Button>
                  <div className="mx-1 h-4 w-px bg-border" />
                </>
              )}
              {showDisplayControls && (
                <>
                  <Button
                    variant="ghost"
                    iconOnly
                    onClick={() => onShowWhitespaceChange?.(!showWhitespace)}
                    active={showWhitespace}
                    tooltip={showWhitespace ? "Hide whitespace" : "Show whitespace"}
                    aria-label={showWhitespace ? "Hide whitespace" : "Show whitespace"}
                  >
                    <TrashIcon />
                    {showWhitespace && <CheckIcon />}
                  </Button>
                  {onViewModeChange && (
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        iconOnly
                        onClick={() => onViewModeChange("unified")}
                        active={viewMode === "unified"}
                        tooltip="Unified view"
                        aria-label="Unified diff view"
                      >
                        <RowsIcon />
                      </Button>
                      <Button
                        variant="ghost"
                        iconOnly
                        onClick={() => onViewModeChange("split")}
                        active={viewMode === "split"}
                        tooltip="Split view"
                        aria-label="Split diff view"
                      >
                        <ColumnsIcon />
                      </Button>
                    </div>
                  )}
                  <div className="mx-1 h-4 w-px bg-border" />
                </>
              )}
              <Button
                variant="ghost"
                iconOnly
                onClick={handleClose}
                tooltip="Close"
                shortcut="escape"
                aria-label="Close diff view"
              >
                <XIcon />
              </Button>
            </div>
          }
        />
      </div>
    );
  },
);

DiffHeader.displayName = "DiffHeader";

export default DiffHeader;
