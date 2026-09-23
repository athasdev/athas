import type { ComponentProps, CSSProperties } from "react";
import { cn } from "@/utils/cn";

interface ShimmerProps extends Omit<ComponentProps<"span">, "style"> {
  /** Sweep duration in seconds. */
  duration?: number;
  /** Set to false to render the text statically without the sweep. */
  active?: boolean;
}

/**
 * Animated gradient sweep for transient text such as "Thinking…" or a running
 * tool label. The sweep is disabled automatically under reduced motion.
 */
export function Shimmer({ active = true, duration, className, ...props }: ShimmerProps) {
  return (
    <span
      data-slot="shimmer"
      data-active={active || undefined}
      className={cn(active && "shimmer text-subtle-foreground shimmer-color-foreground", className)}
      style={
        active && duration ? ({ "--shimmer-duration": `${duration}s` } as CSSProperties) : undefined
      }
      {...props}
    />
  );
}

export default Shimmer;
