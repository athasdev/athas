import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

const badgeVariants = cva(
  "inline-flex h-5 max-w-full items-center justify-center gap-1 rounded-md px-1.5 font-sans ui-text-caption font-medium leading-none tabular-nums whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-accent text-muted-foreground",
        accent: "bg-primary-soft text-primary",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-destructive-soft text-destructive",
        info: "bg-info-soft text-info",
      },
      truncate: { true: "min-w-0 shrink overflow-hidden", false: "shrink-0" },
    },
    defaultVariants: { tone: "neutral", truncate: false },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, "className" | "style" | "color"> &
  VariantProps<typeof badgeVariants> & {
    className?: never;
    style?: never;
    /** A hex colour supplied by the data (a GitHub label). Replaces the tone. */
    labelColor?: string;
  };

export default function Badge({ tone, truncate, labelColor, children, ...props }: BadgeProps) {
  const color =
    labelColor && /^#?[\da-f]{6}$/i.test(labelColor)
      ? `#${labelColor.replace(/^#/, "")}`
      : undefined;
  return (
    <span
      {...props}
      data-slot="badge"
      data-tone={color ? "custom" : (tone ?? "neutral")}
      className={badgeVariants({ tone, truncate })}
      style={
        color
          ? { color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }
          : undefined
      }
    >
      {truncate ? <span className="min-w-0 truncate">{children}</span> : children}
    </span>
  );
}

export { badgeVariants };
