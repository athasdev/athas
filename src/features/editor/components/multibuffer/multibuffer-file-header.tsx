import { memo, type ReactNode } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { Button } from "@/ui/button";
import { ChevronRightIcon } from "@/ui/icons";
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
    <div className="font-sans ui-text-sm sticky top-0 z-50 flex h-9 min-w-0 max-w-full items-center gap-1 border-border border-b bg-background px-1.5">
      {onToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          iconOnly
          onClick={onToggle}
          aria-label={expanded ? `Collapse ${fileName}` : `Expand ${fileName}`}
          aria-expanded={expanded}
        >
          <ChevronRightIcon
            className={cn(
              "transition-transform duration-fast ease-smooth motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        tone="neutral"
        size="sm"
        width="grow"
        align="start"
        onClick={onOpen}
        aria-label={openAriaLabel}
        title={filePath}
      >
        {showFileIcon ? <ThemedFileIcon fileName={fileName} isDir={false} /> : null}
        <span className="min-w-0 shrink-0 truncate">{fileName}</span>
        {directoryPath ? (
          <span className="min-w-0 flex-1 truncate text-left font-normal text-subtle-foreground">
            {directoryPath}
          </span>
        ) : null}
      </Button>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-1.5 px-1 text-subtle-foreground tabular-nums">
          {trailing}
        </span>
      ) : null}
      {actions ? (
        <div className="flex shrink-0 items-center gap-0.5 text-subtle-foreground">{actions}</div>
      ) : null}
    </div>
  );
});
