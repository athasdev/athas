import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "font-sans ui-text-sm inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md leading-row transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-(--app-duration-fast) ease-(--app-ease-smooth) select-none outline-none active:scale-(--app-press-scale) focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-0 bg-accent text-foreground hover:bg-selected",
        accent:
          "border border-primary/30 bg-primary/12 text-primary hover:bg-primary/20 data-[active=true]:border-primary/45 data-[active=true]:bg-primary/24",
        ghost:
          "border-0 bg-transparent text-subtle-foreground hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground",
        danger:
          "border-0 bg-transparent text-foreground hover:bg-destructive/10 hover:text-destructive data-[active=true]:bg-destructive/12 data-[active=true]:text-destructive",
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

export type ButtonProps = useRender.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    active?: boolean;
    tooltip?: string;
    shortcut?: string;
    commandId?: string;
    tooltipSide?: "top" | "bottom" | "left" | "right";
  };

export function Button({
  className,
  variant = "default",
  size = "default",
  active,
  render,
  ref,
  tooltip,
  shortcut,
  commandId,
  tooltipSide,
  "aria-label": ariaLabel,
  ...props
}: ButtonProps) {
  const commandShortcut = useCommandShortcut(commandId);
  const effectiveShortcut = commandId ? commandShortcut : shortcut;

  const element = useRender({
    defaultTagName: "button",
    render,
    ref,
    props: {
      "data-slot": "button",
      "data-variant": variant,
      "data-size": size,
      "data-active": active,
      className: cn(buttonVariants({ variant, size }), className),
      "aria-label": ariaLabel ?? (tooltip ? tooltip : undefined),
      ...props,
    },
  });

  if (!tooltip) {
    return element;
  }

  return (
    <Tooltip content={tooltip} shortcut={effectiveShortcut} side={tooltipSide}>
      {element}
    </Tooltip>
  );
}
