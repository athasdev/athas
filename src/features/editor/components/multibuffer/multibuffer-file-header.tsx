import { ChevronDownIcon, ChevronRightIcon } from "@/ui/icons";
import { memo, type ReactNode } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { cn } from "@/utils/cn";

interface MultibufferFileHeaderProps {
  filePath: string;
  fileName: string;
  directoryPath?: string;
  expanded?: boolean;
  onToggle?: () => void;
  onOpen: () => void;
  openAriaLabel?: string;
  trailing?: ReactNode;
  actions?: ReactNode;
  showFileIcon?: boolean;
}

export const MultibufferFileHeader = memo(function MultibufferFileHeader({
  filePath,
  fileName,
  directoryPath,
  expanded = true,
  onToggle,
  onOpen,
  openAriaLabel = `Open ${filePath}`,
  trailing,
  actions,
  showFileIcon = true,
}: MultibufferFileHeaderProps) {
  return (
    <div className="sticky top-0 z-50 min-w-0 max-w-full bg-background">
      <div className="min-w-0 max-w-full overflow-hidden border-border border-b bg-surface">
        <div className="font-sans ui-text-sm flex min-w-0 items-center">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className="relative z-50 flex size-7 shrink-0 items-center justify-center text-subtle-foreground hover:bg-accent hover:text-foreground"
              aria-label={expanded ? `Collapse ${fileName}` : `Expand ${fileName}`}
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "relative z-50 flex h-7 min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-0 pr-2 text-left text-foreground hover:bg-accent",
              !onToggle && "pl-2",
            )}
            aria-label={openAriaLabel}
          >
            {showFileIcon ? (
              <ThemedFileIcon
                fileName={fileName}
                isDir={false}
                className="shrink-0 text-subtle-foreground"
              />
            ) : null}
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
              <span className={cn("min-w-0 max-w-[45%] truncate font-medium text-foreground")}>
                {fileName}
              </span>
              {directoryPath ? (
                <span className="min-w-0 flex-1 truncate text-subtle-foreground">
                  {directoryPath}
                </span>
              ) : null}
            </span>
            {trailing ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-subtle-foreground">
                {trailing}
              </span>
            ) : null}
          </button>
          {actions ? (
            <div className="flex h-7 shrink-0 items-center pr-1.5 text-subtle-foreground">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
