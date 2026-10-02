import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/utils/cn";

const bubbleVariants = cva(
  "group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end",
  {
    variants: {
      variant: {
        /** A tinted reply from the assistant. */
        default:
          "*:data-[slot=bubble-content]:bg-accent *:data-[slot=bubble-content]:text-foreground",
        /** The user's own message: a compact tinted card that sits at the end of the row. */
        user: "max-w-[85%] self-end *:data-[slot=bubble-content]:bg-accent *:data-[slot=bubble-content]:text-foreground",
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

export { Bubble, BubbleContent, bubbleVariants };
