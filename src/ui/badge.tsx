import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

const badgeVariants = cva(
  "ui-font ui-text-sm inline-flex h-6 items-center justify-center rounded-(--app-radius-pill) border-0 font-normal leading-none",
  {
    variants: {
      variant: {
        default: "bg-primary-bg/70 text-text-lighter",
        muted: "bg-hover/55 text-text-lighter",
        accent: "bg-accent/10 text-accent",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        error: "bg-error/8 text-error",
      },
      size: {
        default: "px-2 py-0.5",
        compact: "px-1.5 py-0.5",
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
