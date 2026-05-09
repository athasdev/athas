import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "ui-font inline-flex h-[var(--app-ui-button-height,2rem)] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-[length:var(--app-ui-control-font-size)] leading-none transition-all duration-150 select-none outline-none focus:outline-none focus-visible:border-accent/45 focus-visible:ring-2 focus-visible:ring-accent/20 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-[length:var(--app-ui-control-icon-size)] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-hover text-text hover:bg-selected",
        accent:
          "border-accent/30 bg-accent/12 text-accent hover:bg-accent/20 data-[active=true]:border-accent/45 data-[active=true]:bg-accent/24",
        ghost:
          "bg-transparent text-text-lighter hover:bg-hover hover:text-text data-[active=true]:bg-hover data-[active=true]:text-text",
        danger:
          "border-error/25 bg-error/10 text-error hover:border-error/35 hover:bg-error/18 data-[active=true]:border-error/40 data-[active=true]:bg-error/22",
      },
      compact: {
        true: "h-[var(--app-ui-button-compact-height,1.5rem)] min-w-[var(--app-ui-button-compact-min-width,1.5rem)] px-1.5",
        false: "min-w-[var(--app-ui-button-min-width,2rem)] px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      compact: false,
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    active?: boolean;
    asChild?: boolean;
    tooltip?: string;
    shortcut?: string;
    commandId?: string;
    tooltipSide?: "top" | "bottom" | "left" | "right";
  };

export function Button({
  className,
  variant = "default",
  compact = false,
  active,
  asChild = false,
  tooltip,
  shortcut,
  commandId,
  tooltipSide,
  "aria-label": ariaLabel,
  ...props
}: ButtonProps) {
  const commandShortcut = useCommandShortcut(commandId);
  const effectiveShortcut = commandId ? commandShortcut : shortcut;

  const Comp = asChild ? Slot : "button";

  const element = (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-compact={compact}
      data-active={active}
      className={cn(buttonVariants({ variant, compact }), className)}
      aria-label={ariaLabel ?? (tooltip ? tooltip : undefined)}
      {...props}
    />
  );

  if (!tooltip) {
    return element;
  }

  return (
    <Tooltip content={tooltip} shortcut={effectiveShortcut} side={tooltipSide}>
      {element}
    </Tooltip>
  );
}
