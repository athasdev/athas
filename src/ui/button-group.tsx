import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { Separator } from "@/ui/separator";
import { cn } from "@/utils/cn";

const buttonGroupVariants = cva(
  "flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10",
  {
    variants: {
      orientation: {
        horizontal:
          "flex-row [&>[data-slot=button]:not(:first-child)]:rounded-l-none [&>[data-slot=button]:not(:last-child)]:rounded-r-none [&>[data-slot=button]:not(:first-child)]:border-l-0 *:data-[slot=button-group-separator]:h-auto",
        vertical:
          "flex-col [&>[data-slot=button]:not(:first-child)]:rounded-t-none [&>[data-slot=button]:not(:last-child)]:rounded-b-none [&>[data-slot=button]:not(:first-child)]:border-t-0",
      },
      variant: {
        default:
          "rounded-chrome bg-accent *:data-[slot=button]:bg-transparent *:data-[slot=button]:hover:bg-selected",
        accent:
          "overflow-hidden rounded-chrome bg-primary/10 *:data-[slot=button]:text-primary *:data-[slot=button]:hover:bg-primary/10 *:data-[slot=button-group-separator]:bg-primary/25",
        ghost: "rounded-chrome bg-transparent",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
      variant: "default",
    },
  },
);

function ButtonGroup({
  className,
  orientation = "horizontal",
  variant = "default",
  ...props
}: ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      data-variant={variant}
      className={cn(buttonGroupVariants({ orientation, variant }), className)}
      {...props}
    />
  );
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "relative m-0 self-stretch bg-border/70 data-[orientation=vertical]:h-auto",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup, ButtonGroupSeparator };
