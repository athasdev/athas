import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cva, type VariantProps } from "class-variance-authority";
import type { SVGProps } from "react";
import { cn } from "@/utils/cn";

const progressIndicatorVariants = cva(
  "h-full rounded-full transition-[width] duration-normal ease-smooth",
  {
    variants: {
      tone: {
        default: "bg-foreground/55",
        muted: "bg-subtle-foreground/55",
        accent: "bg-primary",
        success: "bg-success",
        warning: "bg-warning",
        error: "bg-destructive",
      },
    },
    defaultVariants: {
      tone: "accent",
    },
  },
);

function Progress({
  className,
  children,
  value,
  tone = "accent",
  ...props
}: ProgressPrimitive.Root.Props & VariantProps<typeof progressIndicatorVariants>) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      className={cn("flex w-full flex-wrap gap-2 font-sans ui-text-sm", className)}
      {...props}
    >
      {children}
      <ProgressTrack>
        <ProgressIndicator tone={tone} />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
  return (
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className={cn(
        "relative flex h-1 w-full items-center overflow-hidden rounded-full bg-surface",
        className,
      )}
      {...props}
    />
  );
}

function ProgressIndicator({
  className,
  tone = "accent",
  ...props
}: ProgressPrimitive.Indicator.Props & VariantProps<typeof progressIndicatorVariants>) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(progressIndicatorVariants({ tone }), className)}
      {...props}
    />
  );
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      data-slot="progress-label"
      className={cn("font-medium text-foreground", className)}
      {...props}
    />
  );
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      data-slot="progress-value"
      className={cn("ml-auto tabular-nums text-subtle-foreground", className)}
      {...props}
    />
  );
}

interface ProgressCircleProps extends Omit<SVGProps<SVGSVGElement>, "value"> {
  value: number;
}

function ProgressCircle({ className, value, ...props }: ProgressCircleProps) {
  const progress = Math.min(100, Math.max(0, value)) / 100;

  return (
    <svg
      viewBox="0 0 28 28"
      className={cn("size-4 -rotate-90", className)}
      aria-hidden="true"
      {...props}
    >
      <circle cx="14" cy="14" r="11.5" fill="none" strokeWidth="2" className="stroke-border" />
      <circle
        cx="14"
        cy="14"
        r="11.5"
        fill="none"
        strokeWidth="2"
        pathLength="1"
        strokeDasharray="1"
        strokeDashoffset={1 - progress}
        strokeLinecap="round"
        className="stroke-primary transition-[stroke-dashoffset] duration-normal ease-smooth"
      />
    </svg>
  );
}

export { Progress, ProgressCircle, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue };
