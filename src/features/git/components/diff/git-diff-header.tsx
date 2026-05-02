import {
  Check,
  CaretDown as ChevronDown,
  CaretUp as ChevronUp,
  Columns as Columns2,
  Rows as Rows3,
  Trash as Trash2,
  X,
} from "@phosphor-icons/react";
import { memo } from "react";
import Breadcrumb from "@/features/editor/components/toolbar/breadcrumb";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import type { DiffHeaderProps } from "../../types/git-diff-types";
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
    const iconButtonClass =
      "flex size-5 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text";
    const segmentedButtonClass =
      "flex size-5 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text";

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
            "rounded px-1.5 py-0.5 font-medium text-[10px] capitalize leading-none",
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
                <div className="flex items-center gap-2 text-[10px]">{renderStats()}</div>
              </>
            )
          }
          rightContent={
            <div className="flex items-center gap-1.5 leading-none">
              {isMultiFileView && (
                <>
                  <Button
                    onClick={onExpandAll}
                    variant="ghost"
                    size="icon-xs"
                    className={iconButtonClass}
                    tooltip="Expand all"
                    aria-label="Expand all files"
                  >
                    <ChevronDown />
                  </Button>
                  <Button
                    onClick={onCollapseAll}
                    variant="ghost"
                    size="icon-xs"
                    className={iconButtonClass}
                    tooltip="Collapse all"
                    aria-label="Collapse all files"
                  >
                    <ChevronUp />
                  </Button>
                  <div className="mx-1 h-4 w-px bg-border" />
                </>
              )}

              {showDisplayControls && (
                <>
                  <Button
                    onClick={() => onShowWhitespaceChange?.(!showWhitespace)}
                    variant="ghost"
                    size="xs"
                    className={cn(
                      "flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-hover hover:text-text",
                      showWhitespace ? "bg-hover text-text" : "text-text-lighter",
                    )}
                    tooltip={showWhitespace ? "Hide whitespace" : "Show whitespace"}
                    aria-label={showWhitespace ? "Hide whitespace" : "Show whitespace"}
                  >
                    <Trash2 />
                    {showWhitespace && <Check />}
                  </Button>

                  {onViewModeChange && (
                    <div className="flex items-center gap-0.5">
                      <Button
                        onClick={() => onViewModeChange("unified")}
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          segmentedButtonClass,
                          viewMode === "unified" && "bg-hover text-text",
                        )}
                        tooltip="Unified view"
                        aria-label="Unified diff view"
                      >
                        <Rows3 />
                      </Button>
                      <Button
                        onClick={() => onViewModeChange("split")}
                        variant="ghost"
                        size="icon-xs"
                        className={cn(
                          segmentedButtonClass,
                          viewMode === "split" && "bg-hover text-text",
                        )}
                        tooltip="Split view"
                        aria-label="Split diff view"
                      >
                        <Columns2 />
                      </Button>
                    </div>
                  )}

                  <div className="mx-1 h-4 w-px bg-border" />
                </>
              )}

              <Button
                onClick={handleClose}
                variant="ghost"
                size="icon-xs"
                className={iconButtonClass}
                tooltip="Close"
                shortcut="escape"
                aria-label="Close diff view"
              >
                <X />
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
