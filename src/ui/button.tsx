import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "rounded-chrome font-sans inline-flex shrink-0 items-center justify-center whitespace-nowrap leading-row transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-fast ease-smooth select-none outline-none active:scale-press focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
      iconOnly: {
        true: "rounded-full p-0",
        false: "px-2.5",
      },
      size: {
        default: "h-7 gap-1.5 ui-text-sm [&_svg:not([class*='size-'])]:size-3.5",
        chrome:
          "h-chrome-control gap-chrome px-1.5 ui-text-chrome [&_svg:not([class*='size-'])]:size-[1em]",
      },
      shape: {
        default: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      iconOnly: false,
      size: "default",
      shape: "default",
    },
    compoundVariants: [
      { iconOnly: true, size: "default", className: "w-7" },
      { iconOnly: true, size: "chrome", className: "w-chrome-control" },
    ],
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

export type ButtonProps = useRender.ComponentProps<"button"> &
  Omit<VariantProps<typeof buttonVariants>, "iconOnly"> & {
    active?: boolean;
    iconOnly?: boolean;
    tooltip?: string;
    shortcut?: string;
    commandId?: string;
  };

export function Button({
  className,
  variant = "default",
  iconOnly = false,
  size = "default",
  shape = "default",
  active,
  render,
  ref,
  tooltip,
  shortcut,
  commandId,
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
      "data-icon-only": iconOnly || undefined,
      "data-active": active,
      className: cn(buttonVariants({ variant, iconOnly, size, shape }), className),
      "aria-label": ariaLabel ?? (tooltip ? tooltip : undefined),
      ...props,
    },
  });

  if (!tooltip) {
    return element;
  }

  return (
    <Tooltip content={tooltip} shortcut={effectiveShortcut}>
      {element}
    </Tooltip>
  );
}
