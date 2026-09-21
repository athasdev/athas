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
          "flex-row [&>[data-slot=button]:not(:first-child)]:border-l-0 *:data-[slot=button-group-separator]:h-auto",
        vertical: "flex-col [&>[data-slot=button]:not(:first-child)]:border-t-0",
      },
      variant: {
        default:
          "rounded-md bg-accent *:data-[slot=button]:bg-transparent *:data-[slot=button]:hover:bg-selected",
        accent:
          "overflow-hidden rounded-md bg-primary-soft *:data-[slot=button]:text-primary *:data-[slot=button]:hover:bg-primary-soft *:data-[slot=button-group-separator]:bg-primary",
        ghost: "rounded-md bg-transparent",
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
        "relative m-0 self-stretch bg-border data-[orientation=vertical]:h-auto",
        className,
      )}
      {...props}
    />
  );
}

export { ButtonGroup, ButtonGroupSeparator };
