import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

const toggleVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full border border-transparent font-sans font-medium ui-text-sm text-subtle-foreground outline-none transition-[transform,background-color,border-color,color,box-shadow] duration-fast ease-smooth hover:bg-accent hover:text-foreground active:scale-press focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 data-pressed:bg-selected data-pressed:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-border bg-surface/55",
      },
      size: {
        default: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        chrome: "size-chrome-control [&_svg:not([class*='size-'])]:size-[1em]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  size = "default",
  tooltip,
  tooltipSide,
  shortcut,
  commandId,
  "aria-label": ariaLabel,
  ...props
}: TogglePrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    tooltip?: string;
    tooltipSide?: "top" | "bottom" | "left" | "right";
    shortcut?: string;
    commandId?: string;
  }) {
  const commandShortcut = useCommandShortcut(commandId);
  const effectiveShortcut = commandId ? commandShortcut : shortcut;
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
    <Tooltip content={tooltip} shortcut={effectiveShortcut} side={tooltipSide}>
      {element}
    </Tooltip>
  );
}

export { Toggle, toggleVariants };
