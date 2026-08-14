import { useMemo, type ReactNode } from "react";
import type { InlineDropdownPosition } from "@/features/ai/types/chat-composer.types";
import { Popover, PopoverListContent } from "@/ui/popover";
import { cn } from "@/utils/cn";

interface ComposerAttachedPanelProps {
  open: boolean;
  position: InlineDropdownPosition;
  onClose: () => void;
  children: ReactNode;
  ariaLabel: string;
  className?: string;
  maxHeight?: number;
}

export function ComposerAttachedPanel({
  open,
  position,
  onClose,
  children,
  ariaLabel,
  className,
  maxHeight = 320,
}: ComposerAttachedPanelProps) {
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        new DOMRect(position.left, position.top, 0, Math.max(position.bottom - position.top, 1)),
    }),
    [position.bottom, position.left, position.top],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      modal={false}
    >
      <PopoverListContent
        anchor={anchor}
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        initialFocus={false}
        role="dialog"
        aria-label={ariaLabel}
        data-prevent-dialog-escape="true"
        className={cn("min-h-0 select-auto", className)}
        style={{
          width: position.width,
          maxHeight: `min(${maxHeight}px, var(--available-height))`,
        }}
      >
        {children}
      </PopoverListContent>
    </Popover>
  );
}
