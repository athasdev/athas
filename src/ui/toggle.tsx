import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

const toggleVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md font-sans font-medium ui-text-sm text-subtle-foreground outline-none transition-[background-color,color,box-shadow] duration-fast ease-smooth hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus data-pressed:bg-selected data-pressed:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-border bg-surface",
      },
      tone: {
        default: "",
        accent:
          "data-pressed:bg-primary-soft data-pressed:text-primary hover:data-pressed:bg-primary-soft hover:data-pressed:text-primary",
      },
      size: {
        sm: "size-chrome-control [&_svg:not([class*='size-'])]:size-[1em]",
        md: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "default",
      size: "md",
    },
  },
);

function Toggle({
  className,
  variant = "default",
  tone = "default",
  size = "md",
  tooltip,
  shortcut,
  commandId,
  "aria-label": ariaLabel,
  ...props
}: TogglePrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    tooltip?: string;
    shortcut?: string;
    commandId?: string;
  }) {
  const commandShortcut = useCommandShortcut(commandId);
  const effectiveShortcut = commandId ? commandShortcut : shortcut;
  const element = (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, tone, size }), className)}
      aria-label={ariaLabel ?? tooltip}
      {...props}
    />
  );

  if (!tooltip) return element;

  return (
    <Tooltip content={tooltip} shortcut={effectiveShortcut}>
      {element}
    </Tooltip>
  );
}

export { Toggle, toggleVariants };
