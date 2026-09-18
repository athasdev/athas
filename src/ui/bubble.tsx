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
  "group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end",
  {
    variants: {
      variant: {
        /** A tinted reply from the assistant. */
        default:
          "*:data-[slot=bubble-content]:bg-accent *:data-[slot=bubble-content]:text-foreground",
        /** The user's own message, on the surface plane with an edge. */
        user: "w-full max-w-full *:data-[slot=bubble-content]:w-full *:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-surface",
        /** Plain text with no box, for streamed prose. */
        ghost:
          "w-full max-w-full *:data-[slot=bubble-content]:w-full *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:border-0 *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0",
        danger:
          "*:data-[slot=bubble-content]:bg-destructive-soft *:data-[slot=bubble-content]:text-destructive",
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
        "w-fit max-w-full min-w-0 overflow-hidden rounded-lg border border-transparent px-3 py-2.5 leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end",
        className,
      )}
      {...props}
    />
  );
}

export { Bubble, BubbleContent, BubbleGroup, bubbleVariants };
