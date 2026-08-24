import { cva } from "class-variance-authority";

export type MenuDensity = "default" | "compact";

export const menuSurfaceVariants = cva(
  "max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto bg-surface/98 font-sans ring-1 outline-none backdrop-blur-sm",
  {
    variants: {
      density: {
        default:
          "min-w-44 rounded-xl p-1.5 text-foreground shadow-(--shadow-popover) ring-border/70 ui-text-sm",
        compact:
          "min-w-32 rounded-lg p-1 text-subtle-foreground shadow-(--shadow-card) ring-border/50 ui-text-chrome",
      },
    },
    defaultVariants: {
      density: "compact",
    },
  },
);

export const menuItemVariants = cva(
  "relative flex w-full cursor-default items-center justify-start whitespace-nowrap text-left font-sans outline-hidden select-none transition-colors focus:bg-accent/70 focus:text-foreground data-highlighted:bg-accent/70 data-highlighted:text-foreground data-selected:bg-selected disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      density: {
        default:
          "min-h-8 gap-2.5 rounded-lg px-2.5 py-1.5 text-foreground ui-text-sm [&_svg:not([class*='size-'])]:size-4",
        compact:
          "gap-2 rounded-md px-2 py-1 text-subtle-foreground ui-text-chrome [&_svg:not([class*='size-'])]:size-3.5",
      },
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
      density: "compact",
      disabled: false,
      focused: false,
      selected: false,
      tone: "default",
    },
  },
);

export const menuLabelVariants = cva("font-sans font-medium text-subtle-foreground", {
  variants: {
    density: {
      default: "px-2.5 py-1 ui-text-sm",
      compact: "px-2 py-0.5 ui-text-chrome",
    },
  },
  defaultVariants: {
    density: "compact",
  },
});

export const menuSeparatorVariants = cva("h-px bg-border/60", {
  variants: {
    density: {
      default: "-mx-1.5 my-1",
      compact: "-mx-1 my-0.5",
    },
  },
  defaultVariants: {
    density: "compact",
  },
});
