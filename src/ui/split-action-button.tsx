import { forwardRef, type ReactNode } from "react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface SplitActionButtonProps {
  label: ReactNode;
  actionAriaLabel: string;
  menuAriaLabel: string;
  menuIcon: ReactNode;
  onAction: () => void;
  onMenu: () => void;
  disabled?: boolean;
  menuDisabled?: boolean;
  active?: boolean;
  expanded?: boolean;
  actionTooltip?: string;
  menuTooltip?: string;
}

export const SplitActionButton = forwardRef<HTMLDivElement, SplitActionButtonProps>(
  function SplitActionButton(
    {
      label,
      actionAriaLabel,
      menuAriaLabel,
      menuIcon,
      onAction,
      onMenu,
      disabled = false,
      menuDisabled = disabled,
      active,
      expanded,
      actionTooltip,
      menuTooltip,
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        data-active={active}
        className={cn(
          "inline-flex h-6 w-fit max-w-full flex-none overflow-hidden rounded-md border border-transparent text-text transition-colors",
          "hover:border-border/60 hover:bg-hover/70",
          "data-[active=true]:border-border/70 data-[active=true]:bg-hover/80",
          disabled && "opacity-50",
        )}
      >
        <Button
          type="button"
          variant="default"
          size="xs"
          onClick={onAction}
          disabled={disabled}
          tooltip={actionTooltip}
          className="h-full min-h-0 min-w-0 flex-none justify-start rounded-none border-0 bg-transparent px-2 font-medium hover:bg-hover/70 focus-visible:ring-1 focus-visible:ring-border-strong/35 disabled:pointer-events-none disabled:opacity-100"
          aria-label={actionAriaLabel}
        >
          <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
        </Button>
        <div className="my-1 w-px shrink-0 bg-border/70" />
        <Button
          type="button"
          variant="default"
          size="icon-xs"
          onClick={onMenu}
          disabled={menuDisabled}
          tooltip={menuTooltip}
          className="h-full min-h-0 w-5 min-w-0 rounded-none border-0 bg-transparent px-0 hover:bg-hover/80 focus-visible:ring-1 focus-visible:ring-border-strong/35 disabled:pointer-events-none disabled:opacity-100"
          aria-label={menuAriaLabel}
          aria-haspopup="menu"
          aria-expanded={expanded}
        >
          {menuIcon}
        </Button>
      </div>
    );
  },
);
