import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "min-w-0 max-w-full rounded-chrome font-sans inline-flex shrink-0 items-center justify-center whitespace-nowrap leading-row transition-[background-color,border-color,color,box-shadow,opacity] duration-fast ease-smooth select-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
        text: "h-auto rounded-none border-0 bg-transparent p-0 text-primary hover:text-primary/80",
        list: "h-auto min-h-7 rounded-none border-0 bg-transparent px-2.5 py-1.5 text-foreground hover:bg-accent focus-visible:bg-accent data-[active=true]:bg-selected",
        choice:
          "h-auto rounded-chrome border border-border bg-background px-3 py-2 text-foreground hover:bg-accent data-[active=true]:border-primary data-[active=true]:bg-primary/10",
        danger:
          "border-0 bg-transparent text-foreground hover:bg-destructive/10 hover:text-destructive data-[active=true]:bg-destructive/12 data-[active=true]:text-destructive",
      },
      tone: {
        default: "",
        muted: "text-subtle-foreground",
        foreground: "text-foreground hover:text-foreground",
        primary: "text-primary hover:text-primary",
        success: "text-success hover:text-success",
        added: "text-git-added hover:text-git-added",
        removed: "text-git-deleted hover:text-git-deleted",
        warning: "text-warning hover:text-warning",
        danger: "text-destructive hover:text-destructive",
      },
      width: { content: "", full: "w-full", grow: "flex-1" },
      align: {
        center: "justify-center",
        start: "justify-start text-left",
        between: "justify-between text-left",
      },
      truncate: { true: "overflow-hidden [&>span]:min-w-0 [&>span]:truncate", false: "" },
      capitalize: { true: "capitalize", false: "" },
      iconOnly: {
        true: "p-0",
        false: "px-2.5",
      },
      size: {
        compact: "h-5 gap-1 ui-text-caption [&_svg:not([class*='size-'])]:size-3",
        default: "h-7 gap-1.5 ui-text-sm [&_svg:not([class*='size-'])]:size-3.5",
        chrome:
          "h-chrome-control gap-chrome px-1.5 ui-text-chrome [&_svg:not([class*='size-'])]:size-[1em]",
      },
    },
    defaultVariants: {
      variant: "default",
      iconOnly: false,
      size: "default",
      tone: "default",
      width: "content",
      align: "center",
    },
    compoundVariants: [
      { variant: "text", className: "h-auto px-0 py-0" },
      { variant: "list", className: "h-auto" },
      { variant: "choice", className: "h-auto" },
      { iconOnly: true, size: "compact", className: "w-5" },
      { iconOnly: true, size: "default", className: "w-7" },
      { iconOnly: true, size: "chrome", className: "w-chrome-control" },
    ],
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

export type ButtonProps = Omit<
  useRender.ComponentProps<"button">,
  "className" | "style" | "render"
> &
  Omit<VariantProps<typeof buttonVariants>, "iconOnly"> & {
    className?: never;
    style?: never;
    render?: never;
    active?: boolean;
    iconOnly?: boolean;
    tooltip?: string;
    shortcut?: string;
    commandId?: string;
  };

export function Button({
  tone,
  width,
  align,
  truncate,
  capitalize,
  variant = "default",
  iconOnly = false,
  size = "default",
  active,
  disabled,
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
    ref,
    props: {
      ...props,
      style: undefined,
      "data-slot": "button",
      "data-variant": variant,
      "data-icon-only": iconOnly || undefined,
      "data-active": active,
      className: cn(
        buttonVariants({ variant, iconOnly, size, tone, width, align, truncate, capitalize }),
      ),
      "aria-label": ariaLabel ?? (tooltip ? tooltip : undefined),
      disabled,
    },
  });

  if (!tooltip) {
    return element;
  }

  return (
    <Tooltip content={tooltip} shortcut={effectiveShortcut} width={width}>
      {element}
    </Tooltip>
  );
}
