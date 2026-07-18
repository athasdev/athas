import {
  CheckIcon as Check,
  CaretDownIcon as ChevronDown,
  CaretUpIcon as ChevronUp,
  ColumnsIcon as Columns2,
  RowsIcon as Rows3,
  TrashIcon as Trash2,
  XIcon as X,
} from "@/ui/icons";
import { memo } from "react";
import Breadcrumb, {
  BreadcrumbActionButton,
} from "@/features/editor/components/toolbar/breadcrumb";
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
              <span className="text-text-lighter">
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
                  <BreadcrumbActionButton
                    onClick={onExpandAll}
                    tooltip="Expand all"
                    aria-label="Expand all files"
                  >
                    <ChevronDown weight="duotone" />
                  </BreadcrumbActionButton>
                  <BreadcrumbActionButton
                    onClick={onCollapseAll}
                    tooltip="Collapse all"
                    aria-label="Collapse all files"
                  >
                    <ChevronUp weight="duotone" />
                  </BreadcrumbActionButton>
                  <div className="mx-1 h-4 w-px bg-border" />
                </>
              )}

              {showDisplayControls && (
                <>
                  <BreadcrumbActionButton
                    onClick={() => onShowWhitespaceChange?.(!showWhitespace)}
                    active={showWhitespace}
                    className="gap-1"
                    tooltip={showWhitespace ? "Hide whitespace" : "Show whitespace"}
                    aria-label={showWhitespace ? "Hide whitespace" : "Show whitespace"}
                  >
                    <Trash2 weight="duotone" />
                    {showWhitespace && <Check weight="duotone" />}
                  </BreadcrumbActionButton>

                  {onViewModeChange && (
                    <div className="flex items-center gap-0.5">
                      <BreadcrumbActionButton
                        onClick={() => onViewModeChange("unified")}
                        active={viewMode === "unified"}
                        tooltip="Unified view"
                        aria-label="Unified diff view"
                      >
                        <Rows3 weight="duotone" />
                      </BreadcrumbActionButton>
                      <BreadcrumbActionButton
                        onClick={() => onViewModeChange("split")}
                        active={viewMode === "split"}
                        tooltip="Split view"
                        aria-label="Split diff view"
                      >
                        <Columns2 weight="duotone" />
                      </BreadcrumbActionButton>
                    </div>
                  )}

                  <div className="mx-1 h-4 w-px bg-border" />
                </>
              )}

              <BreadcrumbActionButton
                onClick={handleClose}
                tooltip="Close"
                shortcut="escape"
                aria-label="Close diff view"
              >
                <X weight="duotone" />
              </BreadcrumbActionButton>
            </div>
          }
        />
      </div>
    );
  },
);

DiffHeader.displayName = "DiffHeader";

export default DiffHeader;
