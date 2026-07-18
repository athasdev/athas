import { ChevronDownIcon as ChevronDown, ChevronRightIcon as ChevronRight } from "@/ui/icons";
import { memo, type ReactNode } from "react";
import { cva } from "class-variance-authority";
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
  fileNameClassName?: string;
  trailing?: ReactNode;
  actions?: ReactNode;
  surface?: "card" | "section";
  showFileIcon?: boolean;
}

const multibufferFileHeaderSurfaceVariants = cva(
  "min-w-0 max-w-full overflow-hidden bg-primary-bg",
  {
    variants: {
      surface: {
        card: "border border-border/70 shadow-[0_1px_0_rgba(0,0,0,0.04)]",
        section: "border-border/60 border-b bg-secondary-bg/12",
      },
      expanded: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { surface: "card", expanded: true, className: "rounded-t-xl" },
      { surface: "card", expanded: false, className: "rounded-xl" },
    ],
    defaultVariants: {
      surface: "card",
      expanded: true,
    },
  },
);

export const MultibufferFileHeader = memo(function MultibufferFileHeader({
  filePath,
  fileName,
  directoryPath,
  expanded = true,
  onToggle,
  onOpen,
  openAriaLabel = `Open ${filePath}`,
  fileNameClassName,
  trailing,
  actions,
  surface = "card",
  showFileIcon = true,
}: MultibufferFileHeaderProps) {
  return (
    <div className="sticky top-0 z-50 min-w-0 max-w-full bg-primary-bg">
      <div className={multibufferFileHeaderSurfaceVariants({ surface, expanded })}>
        <div className="font-sans ui-text-sm flex min-w-0 items-center">
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              className="relative z-50 flex size-7 shrink-0 items-center justify-center text-text-lighter hover:bg-hover/30 hover:text-text"
              aria-label={expanded ? `Collapse ${fileName}` : `Expand ${fileName}`}
              aria-expanded={expanded}
            >
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "relative z-50 flex h-7 min-w-0 flex-1 items-center gap-1.5 overflow-hidden py-0 pr-2 text-left text-text hover:bg-hover/30",
              !onToggle && "pl-2",
            )}
            aria-label={openAriaLabel}
          >
            {showFileIcon ? (
              <ThemedFileIcon
                fileName={fileName}
                isDir={false}
                className="shrink-0 text-text-lighter"
              />
            ) : null}
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
              <span
                className={cn(
                  "min-w-0 max-w-[45%] truncate font-medium text-text",
                  fileNameClassName,
                )}
              >
                {fileName}
              </span>
              {directoryPath ? (
                <span className="min-w-0 flex-1 truncate text-text-lighter">{directoryPath}</span>
              ) : null}
            </span>
            {trailing ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-text-lighter">
                {trailing}
              </span>
            ) : null}
          </button>
          {actions ? (
            <div className="flex h-7 shrink-0 items-center pr-1.5 text-text-lighter">{actions}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
