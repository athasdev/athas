import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

const badgeVariants = cva(
  "ui-text-sm inline-flex max-w-full items-center justify-center gap-1 rounded-chrome border-0 px-1.5 py-0.5 font-normal leading-none tabular-nums",
  {
    variants: {
      variant: {
        default: "bg-background/70 text-subtle-foreground",
        muted: "bg-accent/55 text-subtle-foreground",
        accent: "bg-primary/10 text-primary",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        error: "bg-destructive/8 text-destructive",
      },
      size: { default: "h-6", compact: "h-5" },
      font: { default: "font-sans", mono: "font-mono" },
      truncate: { true: "min-w-0 shrink overflow-hidden", false: "shrink-0" },
    },
    defaultVariants: { variant: "default", size: "default", font: "default", truncate: false },
  },
);

type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "className" | "style" | "color"> &
  VariantProps<typeof badgeVariants> & {
    className?: never;
    style?: never;
    labelColor?: string;
  };

export default function Badge({
  variant,
  size,
  font,
  truncate,
  labelColor,
  children,
  ...props
}: BadgeProps) {
  const color =
    labelColor && /^#?[\da-f]{6}$/i.test(labelColor)
      ? `#${labelColor.replace(/^#/, "")}`
      : undefined;
  return (
    <span
      {...props}
      className={badgeVariants({ variant, size, font, truncate })}
      style={color ? { color, backgroundColor: `${color}20` } : undefined}
    >
      {truncate ? <span className="min-w-0 truncate">{children}</span> : children}
    </span>
  );
}

export { badgeVariants };
