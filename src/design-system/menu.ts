import { cva } from "class-variance-authority";

export type MenuDensity = "default" | "compact";

export const menuSurfaceVariants = cva(
  "max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-surface p-1 font-sans ui-text-sm text-foreground shadow-(--shadow-popover) ring-1 ring-border/70 outline-none",
  {
    variants: {
      density: {
        default: "min-w-44",
        compact: "min-w-36",
      },
    },
    defaultVariants: {
      density: "compact",
    },
  },
);

export const menuItemVariants = cva(
  "font-sans ui-text-sm relative flex w-full cursor-default items-center justify-between whitespace-nowrap rounded-lg text-left text-foreground outline-hidden select-none transition-colors focus:bg-accent focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
          "text-destructive hover:text-destructive focus:bg-destructive/10 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:*:[svg]:text-destructive",
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

export const menuLabelVariants = cva("font-sans ui-text-sm font-medium text-subtle-foreground", {
  variants: {
    density: {
      default: "px-2.5 py-1",
      compact: "px-2 py-0.5",
    },
  },
  defaultVariants: {
    density: "compact",
  },
});

export const menuSeparatorVariants = cva("-mx-1 h-px bg-border", {
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

export const menuTriggerVariants = cva("rounded-full outline-none");
