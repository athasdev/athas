import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "font-sans ui-text-sm inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap leading-row transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-fast ease-smooth select-none outline-none active:scale-press focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-0 bg-accent text-foreground hover:bg-selected",
        accent:
          "border border-primary/30 bg-primary/12 text-primary hover:bg-primary/20 data-[active=true]:border-primary/45 data-[active=true]:bg-primary/24",
        "accent-ghost":
          "border-0 bg-transparent text-primary hover:bg-primary/10 data-[active=true]:bg-primary/12",
        ghost:
          "border-0 bg-transparent text-subtle-foreground hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground",
        danger:
          "border-0 bg-transparent text-foreground hover:bg-destructive/10 hover:text-destructive data-[active=true]:bg-destructive/12 data-[active=true]:text-destructive",
      },
      size: {
        default: "h-8 rounded-chrome px-3",
        xs: "h-6 gap-1 rounded-chrome px-1.5",
        sm: "h-7 rounded-chrome px-2.5",
        md: "h-8 rounded-chrome px-2.5 ui-text-base",
        lg: "h-9 rounded-chrome px-4",
        icon: "size-8 rounded-full p-0",
        "icon-xs": "size-6 rounded-full p-0",
        "icon-sm": "size-7 rounded-full p-0",
      },
      shape: {
        default: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "default",
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
  shape = "default",
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
      className: cn(buttonVariants({ variant, size, shape }), className),
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
