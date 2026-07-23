import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/utils/cn";

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

const bubbleVariants = cva(
  "group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full",
  {
    variants: {
      variant: {
        default: "*:data-[slot=bubble-content]:bg-accent/15 *:data-[slot=bubble-content]:text-text",
        secondary:
          "*:data-[slot=bubble-content]:bg-secondary-bg *:data-[slot=bubble-content]:text-text [&>[data-slot=bubble-content]:is(button,a):hover]:bg-hover",
        muted: "*:data-[slot=bubble-content]:bg-hover/70 *:data-[slot=bubble-content]:text-text",
        outline:
          "*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-primary-bg",
        ghost:
          "w-full max-w-full *:data-[slot=bubble-content]:w-full *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:border-0 *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0",
        destructive:
          "*:data-[slot=bubble-content]:bg-error/10 *:data-[slot=bubble-content]:text-error",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end";
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

function BubbleContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-content"
      className={cn(
        "w-fit max-w-full min-w-0 overflow-hidden rounded-xl border border-transparent px-3 py-2 leading-relaxed break-words group-data-[align=end]/bubble:self-end",
        className,
      )}
      {...props}
    />
  );
}

export { Bubble, BubbleContent, BubbleGroup, bubbleVariants };
