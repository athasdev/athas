import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

export const chromeBarVariants = cva(
  "font-sans ui-text-chrome flex shrink-0 items-center text-subtle-foreground",
  {
    variants: {
      region: {
        title: "h-title-bar gap-chrome bg-transparent px-chrome-inline",
        tabs: "h-tab-bar min-h-tab-bar gap-chrome bg-background px-chrome-inline",
        content: "h-7 min-h-7 gap-chrome bg-background px-chrome-inline",
        status: "h-7 min-h-7 gap-chrome-loose bg-background px-chrome-inline",
        sidebar: "min-h-sidebar-header gap-chrome bg-background px-chrome-inline",
      },
      emphasis: {
        supporting: "text-subtle-foreground",
        neutral: "text-muted-foreground",
        primary: "text-foreground",
      },
      surface: {
        default: "",
        transparent: "bg-transparent",
      },
      separated: {
        true: "border-divider border-b",
        false: "border-transparent border-b",
      },
    },
    defaultVariants: {
      emphasis: "supporting",
      separated: false,
    },
  },
);

export const chromeGroupVariants = cva("flex min-w-0 items-center", {
  variants: {
    gap: {
      none: "gap-0",
      tight: "gap-chrome-tight",
      default: "gap-chrome",
      loose: "gap-chrome-loose",
    },
    grow: {
      true: "flex-1",
      false: "shrink-0",
    },
    align: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
    /**
     * Secondary actions that stay ghosted until the pointer is over the surrounding
     * `group/chrome-host` (a pane or panel), keyboard focus is inside them, a menu of theirs is
     * open or a toggle of theirs is on. They keep their size, so revealing them never shifts the row.
     */
    reveal: {
      true: "opacity-0 transition-opacity duration-fast ease-smooth group-hover/chrome-host:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 has-aria-pressed:opacity-100 has-data-[active=true]:opacity-100 motion-reduce:transition-none",
      false: "",
    },
  },
  defaultVariants: {
    gap: "default",
    grow: false,
    align: "start",
    reveal: false,
  },
});

export const chromeLabelVariants = cva("min-w-0 truncate leading-chrome", {
  variants: {
    tone: {
      muted: "text-subtle-foreground",
      default: "text-muted-foreground",
      strong: "text-foreground",
      accent: "text-primary",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export function ChromeBar({
  className,
  region,
  emphasis,
  surface,
  separated,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof chromeBarVariants>) {
  return (
    <div
      data-slot="chrome-bar"
      data-region={region}
      className={cn(chromeBarVariants({ region, emphasis, surface, separated }), className)}
      {...props}
    />
  );
}

export function ChromeGroup({
  className,
  gap,
  grow,
  align,
  reveal,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof chromeGroupVariants>) {
  return (
    <div
      data-slot="chrome-group"
      className={cn(chromeGroupVariants({ gap, grow, align, reveal }), className)}
      {...props}
    />
  );
}

export function ChromeLabel({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof chromeLabelVariants>) {
  return (
    <span
      data-slot="chrome-label"
      className={cn(chromeLabelVariants({ tone }), className)}
      {...props}
    />
  );
}

export function ChromeSeparator({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      data-slot="chrome-separator"
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-divider",
        orientation === "vertical" ? "mx-0.5 h-3.5 w-px" : "my-0.5 h-px w-full",
        className,
      )}
      {...props}
    />
  );
}
