import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

const badgeVariants = cva(
  "ui-font inline-flex items-center justify-center font-medium leading-none",
  {
    variants: {
      variant: {
        default: "border border-border/60 bg-primary-bg/70 text-text-lighter",
        accent: "bg-accent/10 text-accent",
        muted: "text-text-lighter",
        error: "border border-error/30 bg-error/5 text-error/90",
      },
      shape: {
        default: "rounded-md",
        pill: "rounded-full",
      },
      size: {
        default: "px-2 py-0.5 text-[10px]",
        sm: "px-2 py-0.5 text-xs",
        compact: "px-1.5 py-0.5 text-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "default",
      size: "default",
    },
  },
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export default function Badge({ className, variant, shape, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, shape, size }), className)} {...props} />;
}
