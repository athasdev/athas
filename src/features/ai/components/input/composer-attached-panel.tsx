import type { ReactNode, RefObject } from "react";
import { Popover, PopoverContent } from "@/ui/popover";
import { cn } from "@/utils/cn";

interface ComposerAttachedPanelProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
  maxHeight?: number;
}

export function ComposerAttachedPanel({
  open,
  anchorRef,
  onClose,
  children,
  ariaLabel,
  className,
  maxHeight = 320,
}: ComposerAttachedPanelProps) {
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      modal={false}
    >
      <PopoverContent
        anchor={anchorRef}
        side="top"
        align="start"
        sideOffset={-1}
        collisionPadding={8}
        initialFocus={false}
        role="dialog"
        aria-label={ariaLabel}
        data-prevent-dialog-escape="true"
        className={cn(
          "flex min-h-0 w-(--anchor-width) max-w-[calc(100vw-16px)] select-auto flex-col gap-0 overflow-hidden rounded-t-2xl rounded-b-none border border-border/70 border-b-0 bg-background p-0 shadow-(--shadow-card)",
          className,
        )}
        style={{
          maxHeight: `min(${maxHeight}px, var(--available-height))`,
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
