import { cva } from "class-variance-authority";

export type MenuDensity = "default" | "compact";

export const menuSurfaceVariants = cva(
  "max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-surface/98 p-1 font-sans ui-text-chrome text-subtle-foreground shadow-(--shadow-card) ring-1 ring-border/50 outline-none backdrop-blur-sm",
  {
    variants: {
      density: {
        default: "min-w-44",
        compact: "min-w-32",
      },
    },
    defaultVariants: {
      density: "compact",
    },
  },
);

export const menuItemVariants = cva(
  "font-sans ui-text-chrome relative flex w-full cursor-default items-center justify-between whitespace-nowrap rounded-md text-left text-subtle-foreground outline-hidden select-none transition-colors focus:bg-accent/70 focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      density: {
        default: "gap-3 px-2.5 py-1.5",
        compact: "gap-2 px-2 py-1",
      },
      disabled: {
        true: "cursor-not-allowed opacity-50",
        false: "cursor-pointer hover:bg-accent",
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

export const menuLabelVariants = cva(
  "font-sans ui-text-chrome font-medium text-subtle-foreground",
  {
    variants: {
      density: {
        default: "px-2.5 py-1",
        compact: "px-2 py-0.5",
      },
    },
    defaultVariants: {
      density: "compact",
    },
  },
);

export const menuSeparatorVariants = cva("-mx-1 h-px bg-border/60", {
  variants: {
    density: {
      default: "my-1",
      compact: "my-0.5",
    },
  },
  defaultVariants: {
    density: "compact",
  },
});
