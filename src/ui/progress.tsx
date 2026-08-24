import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const progressTrackVariants = cva(
  "relative flex w-full items-center overflow-hidden rounded-full bg-surface",
  {
    variants: {
      size: {
        sm: "h-1",
        md: "h-1.5",
      },
    },
    defaultVariants: {
      size: "sm",
    },
  },
);

const progressIndicatorVariants = cva(
  "h-full rounded-full transition-[width] duration-(--app-duration-normal) ease-(--app-ease-smooth)",
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
  size = "sm",
  tone = "accent",
  ...props
}: ProgressPrimitive.Root.Props &
  VariantProps<typeof progressTrackVariants> &
  VariantProps<typeof progressIndicatorVariants>) {
  return (
    <ProgressPrimitive.Root
      value={value}
      data-slot="progress"
      data-size={size}
      className={cn("flex w-full flex-wrap gap-2 font-sans ui-text-sm", className)}
      {...props}
    >
      {children}
      <ProgressTrack size={size}>
        <ProgressIndicator tone={tone} />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}

function ProgressTrack({
  className,
  size = "sm",
  ...props
}: ProgressPrimitive.Track.Props & VariantProps<typeof progressTrackVariants>) {
  return (
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className={cn(progressTrackVariants({ size }), className)}
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

export { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue };
