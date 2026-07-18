import type { ComponentProps } from "react";
import { ArrowClockwiseIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

type SpinnerProps = ComponentProps<typeof ArrowClockwiseIcon> & {
  label?: string;
  showLabel?: boolean;
  compact?: boolean;
};

function Spinner({
  className,
  label = "Loading",
  showLabel = false,
  compact = false,
  ...props
}: SpinnerProps) {
  const icon = (
    <ArrowClockwiseIcon
      role={showLabel ? undefined : "status"}
      aria-hidden={showLabel || undefined}
      aria-label={showLabel ? undefined : label}
      className={cn("animate-spin", compact ? "size-3" : "size-4", !showLabel && className)}
      {...props}
    />
  );

  if (!showLabel) {
    return icon;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-2 font-sans ui-text-sm text-text-lighter",
        className,
      )}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

export { Spinner };
export type { SpinnerProps };
