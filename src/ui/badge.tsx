import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

const badgeVariants = cva(
  "font-sans ui-text-sm inline-flex h-6 items-center justify-center rounded-full border-0 font-normal leading-none",
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
