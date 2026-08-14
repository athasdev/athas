import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

const toggleVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full border border-transparent font-sans font-medium text-subtle-foreground outline-none transition-[transform,background-color,border-color,color,box-shadow] duration-(--app-duration-fast) ease-(--app-ease-smooth) hover:bg-accent hover:text-foreground active:scale-(--app-press-scale) focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 data-pressed:bg-selected data-pressed:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-border bg-surface/55",
      },
      size: {
        xs: "size-6 ui-text-sm",
        sm: "size-7 ui-text-sm",
        md: "size-8 ui-text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "sm",
  tooltip,
  tooltipSide,
  shortcut,
  "aria-label": ariaLabel,
  ...props
}: TogglePrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    tooltip?: string;
    tooltipSide?: "top" | "bottom" | "left" | "right";
    shortcut?: string;
  }) {
  const element = (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size }), className)}
      aria-label={ariaLabel ?? tooltip}
      {...props}
    />
  );

  if (!tooltip) return element;

  return (
    <Tooltip content={tooltip} shortcut={shortcut} side={tooltipSide}>
      {element}
    </Tooltip>
  );
}

export { Toggle, toggleVariants };
