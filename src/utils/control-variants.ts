import { cva } from "class-variance-authority";

export const controlSurfaceVariants = cva(
  "font-sans min-w-0 text-text transition-[border-color,box-shadow,background-color,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "rounded-lg border border-border bg-secondary-bg focus:border-border-strong focus:bg-secondary-bg focus:ring-1 focus:ring-border-strong/35",
        ghost: "border-none bg-transparent focus:ring-0",
        inline:
          "rounded-none border-0 border-text border-b bg-transparent focus:border-text-lighter focus:ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const controlSizeVariants = cva("", {
  variants: {
    size: {
      xs: "h-6 ui-text-sm",
      sm: "h-7 ui-text-sm",
      md: "h-8 ui-text-base",
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

export const controlIconSizes = {
  xs: 12,
  sm: 12,
  md: 14,
} as const;
