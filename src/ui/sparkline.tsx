import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/utils/cn";

const sparklineVariants = cva("h-8 w-full overflow-visible", {
  variants: {
    tone: {
      default: "text-foreground/65",
      muted: "text-subtle-foreground/60",
      accent: "text-primary",
      success: "text-success",
      warning: "text-warning",
      error: "text-destructive",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

function sparklinePath(values: number[]): string {
  if (values.length === 0) return "";

  const width = 100;
  const height = 32;
  const padding = 2;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;

  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y =
        range === 0
          ? height / 2
          : padding + (1 - (value - minimum) / range) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

interface SparklineProps
  extends
    Omit<ComponentProps<"svg">, "children" | "values">,
    VariantProps<typeof sparklineVariants> {
  values: number[];
  label: string;
}

export function Sparkline({
  values,
  label,
  tone = "default",
  className,
  ...props
}: SparklineProps) {
  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-slot="sparkline"
      className={cn(sparklineVariants({ tone }), className)}
      {...props}
    >
      <title>{label}</title>
      <path
        d={sparklinePath(values)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
