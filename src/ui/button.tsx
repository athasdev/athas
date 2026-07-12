import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { chromeControlVariants, type ChromeControlVariant } from "@/ui/chrome-control";
import { Slot } from "@/ui/slot";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "font-sans ui-text-sm inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent leading-[1.35] transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] select-none outline-none active:scale-[var(--app-press-scale)] focus:outline-none focus-visible:border-accent/45 focus-visible:ring-2 focus-visible:ring-accent/20 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-hover text-text hover:bg-selected",
        accent:
          "border-accent/30 bg-accent/12 text-accent hover:bg-accent/20 data-[active=true]:border-accent/45 data-[active=true]:bg-accent/24",
        ghost:
          "bg-transparent text-text-lighter hover:bg-hover hover:text-text data-[active=true]:bg-hover data-[active=true]:text-text",
        danger:
          "bg-transparent text-text hover:bg-error/10 hover:text-error data-[active=true]:bg-error/12 data-[active=true]:text-error",
      },
      size: {
        default: "h-8 px-3",
        xs: "h-6 gap-1 px-1.5",
        sm: "h-7 px-2.5",
        lg: "h-9 px-4",
        icon: "size-8 p-0",
        "icon-xs": "size-6 p-0",
        "icon-sm": "size-7 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    active?: boolean;
    asChild?: boolean;
    tooltip?: string;
    shortcut?: string;
    commandId?: string;
    chrome?: ChromeControlVariant;
    tooltipSide?: "top" | "bottom" | "left" | "right";
  };

export function Button({
  className,
  variant = "default",
  size = "default",
  active,
  asChild = false,
  tooltip,
  shortcut,
  commandId,
  chrome,
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
      data-size={size}
      data-active={active}
      className={cn(
        buttonVariants({ variant, size }),
        chromeControlVariants({ chrome }),
        className,
      )}
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
