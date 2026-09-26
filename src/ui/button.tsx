import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { useControlSize } from "@/ui/control-size";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export const buttonVariants = cva(
  "inline-flex min-w-0 max-w-full shrink-0 items-center justify-center whitespace-nowrap rounded-md font-sans leading-row transition-[background-color,color,box-shadow,opacity] duration-fast ease-smooth select-none outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      /** How the button is filled. */
      variant: {
        /** Neutral filled button: secondary actions, form controls. */
        default: "bg-accent text-foreground hover:bg-selected data-[active=true]:bg-selected",
        /** Solid primary button: the one call to action on a surface. */
        accent:
          "bg-primary text-primary-foreground hover:bg-primary-hover data-[active=true]:bg-primary-hover",
        /** A field-shaped trigger: selects and pickers that sit among inputs. */
        outline:
          "border border-border bg-surface text-foreground hover:border-border-strong data-[active=true]:border-primary data-popup-open:border-primary",
        /** Borderless: toolbars, icon buttons, quiet actions. */
        ghost:
          "bg-transparent text-subtle-foreground hover:bg-accent hover:text-foreground data-[active=true]:bg-selected data-[active=true]:text-foreground",
        /** Inline text link. Sizes itself to its text. */
        link: "h-auto rounded-sm bg-transparent p-0 text-primary underline-offset-4 hover:underline",
      },
      /** Colour of the label, for status-bearing actions. */
      tone: {
        default: "",
        neutral: "text-foreground hover:text-foreground",
        accent: "text-primary hover:text-primary",
        success: "text-success hover:text-success",
        warning: "text-warning hover:text-warning",
        danger:
          "text-destructive hover:text-destructive data-[active=true]:text-destructive data-[variant=ghost]:hover:bg-destructive-soft data-[variant=ghost]:data-[active=true]:bg-destructive-soft",
      },
      /** Label weight. `regular` suits inline content such as breadcrumb segments. */
      weight: { medium: "font-medium", regular: "font-normal" },
      width: { content: "", full: "w-full", grow: "flex-1" },
      align: {
        center: "justify-center",
        start: "justify-start text-left",
        between: "justify-between text-left",
      },
      truncate: { true: "overflow-hidden [&>span]:min-w-0 [&>span]:truncate", false: "" },
      iconOnly: { true: "p-0", false: "" },
      size: {
        /** Text-height segments that read as part of a line, such as breadcrumbs. */
        inline: "h-5 gap-1 rounded-sm px-1 ui-text-sm [&_svg:not([class*='size-'])]:size-3",
        /** Inside inputs and table cells. */
        xs: "h-5 gap-1 px-1.5 ui-text-caption [&_svg:not([class*='size-'])]:size-3",
        /** Toolbars, chrome bars, sidebars. */
        sm: "h-chrome-control gap-chrome px-2 ui-text-chrome [&_svg:not([class*='size-'])]:size-[1em]",
        /** Forms, dialogs, and page content. */
        md: "h-7 gap-1.5 px-2.5 ui-text-sm [&_svg:not([class*='size-'])]:size-3.5",
        /** The activity rail and other primary navigation. */
        lg: "h-rail-control gap-2 rounded-lg px-3 ui-text-base [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "default",
      weight: "medium",
      size: "md",
      width: "content",
      align: "center",
      iconOnly: false,
    },
    compoundVariants: [
      { variant: "link", className: "h-auto px-0" },
      // The size's inline padding is listed after `iconOnly`'s p-0 and would win, squeezing
      // non-SVG content such as project images to a few pixels.
      { iconOnly: true, size: "inline", className: "w-5 px-0" },
      { iconOnly: true, size: "xs", className: "w-5 px-0" },
      { iconOnly: true, size: "sm", className: "w-chrome-control px-0" },
      { iconOnly: true, size: "md", className: "w-7 px-0" },
      { iconOnly: true, size: "lg", className: "w-rail-control px-0" },
    ],
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonTone = NonNullable<VariantProps<typeof buttonVariants>["tone"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

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
  weight,
  width,
  align,
  truncate,
  variant = "default",
  iconOnly = false,
  size: sizeProp,
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
  const contextSize = useControlSize();
  const size = sizeProp ?? contextSize ?? "md";

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
        buttonVariants({ variant, iconOnly, size, tone, weight, width, align, truncate }),
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
