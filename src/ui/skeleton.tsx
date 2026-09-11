import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

/**
 * Placeholder block for content that is still loading. Size it with width and
 * height utilities where it is used; the pulse stops under reduced motion.
 */
export function Skeleton({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "block animate-pulse rounded-md bg-accent/70 motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}
