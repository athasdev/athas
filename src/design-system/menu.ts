import { cva } from "class-variance-authority";

export const menuSurfaceVariants = cva(
  "max-h-(--available-height) w-fit min-w-32 max-w-[min(480px,calc(100vw-16px))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-surface/98 p-1 font-sans text-subtle-foreground shadow-(--shadow-card) ring-1 ring-border/50 outline-none backdrop-blur-sm ui-text-chrome",
);

export const menuItemVariants = cva(
  "relative flex w-full cursor-default items-center justify-start gap-2 whitespace-nowrap rounded-md px-2 py-1 text-left font-sans text-subtle-foreground outline-hidden select-none transition-colors focus:bg-accent/70 focus:text-foreground data-highlighted:bg-accent/70 data-highlighted:text-foreground data-selected:bg-selected disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 ui-text-chrome [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      disabled: {
        true: "cursor-not-allowed opacity-50",
        false: "hover:bg-accent",
      },
      focused: {
        true: "bg-accent",
        false: "",
      },
      selected: {
        true: "bg-selected",
        false: "",
      },
      tone: {
        default: "",
        accent: "text-primary",
        destructive:
          "hover:bg-destructive/8 hover:text-destructive focus:bg-destructive/10 focus:text-destructive data-[variant=destructive]:hover:bg-destructive/8 data-[variant=destructive]:hover:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive",
      },
    },
    defaultVariants: {
      disabled: false,
      focused: false,
      selected: false,
      tone: "default",
    },
  },
);

export const menuLabelVariants = cva(
  "px-2 py-0.5 font-sans font-medium text-subtle-foreground ui-text-chrome",
);

export const menuSeparatorVariants = cva("-mx-1 my-0.5 h-px bg-border/60");
