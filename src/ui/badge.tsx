import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

const badgeVariants = cva(
  "ui-font inline-flex h-[var(--app-ui-badge-height,1.5rem)] items-center justify-center rounded-full font-normal leading-none",
  {
    variants: {
      variant: {
        default: "border border-border/60 bg-primary-bg/70 text-text-lighter",
        accent: "bg-accent/10 text-accent",
        muted: "text-text-lighter",
        error: "border border-error/30 bg-error/5 text-error/90",
      },
      size: {
        default: "ui-text-sm px-2 py-0.5",
        sm: "ui-text-sm px-2 py-0.5",
        compact: "ui-text-sm px-1.5 py-0.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export default function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
