import { cva } from "class-variance-authority";

export const controlFieldSurfaceVariants = cva(
  "ui-font min-w-0 text-text transition-[border-color,box-shadow,background-color,color] outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "rounded-lg border border-border bg-secondary-bg focus:border-border-strong focus:bg-secondary-bg focus:ring-1 focus:ring-border-strong/35",
        secondary:
          "rounded-lg border border-border bg-secondary-bg focus:border-border-strong focus:bg-secondary-bg focus:ring-1 focus:ring-border-strong/35",
        outline:
          "rounded-lg border border-border/70 bg-transparent focus:border-border-strong focus:ring-1 focus:ring-border-strong/25",
        ghost: "border-none bg-transparent focus:ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const controlFieldSizeVariants = cva("", {
  variants: {
    size: {
      xs: "h-6 ui-text-sm",
      sm: "h-7 ui-text-sm",
      md: "h-8 ui-text-md",
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

export const controlFieldIconSizes = {
  xs: 12,
  sm: 12,
  md: 14,
} as const;
