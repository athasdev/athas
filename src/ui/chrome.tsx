import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

export const chromeBarVariants = cva(
  "font-sans ui-text-chrome flex shrink-0 items-center text-subtle-foreground",
  {
    variants: {
      region: {
        title: "h-title-bar gap-chrome bg-transparent px-chrome-inline",
        footer: "h-footer gap-chrome bg-transparent px-chrome-inline",
        tabs: "h-tab-bar min-h-tab-bar gap-chrome bg-background px-chrome-inline",
        content: "h-7 min-h-7 gap-chrome bg-background px-chrome-inline",
        status: "h-7 min-h-7 gap-chrome-loose bg-background px-chrome-inline",
        sidebar: "min-h-sidebar-header gap-chrome bg-background/92 px-chrome-inline",
      },
      emphasis: {
        supporting: "text-subtle-foreground",
        neutral: "text-muted-foreground",
        primary: "text-foreground",
      },
      separated: {
        true: "border-border/55 border-b",
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
  },
  defaultVariants: {
    gap: "default",
    grow: false,
    align: "start",
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
  separated,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof chromeBarVariants>) {
  return (
    <div
      data-slot="chrome-bar"
      data-region={region}
      className={cn(chromeBarVariants({ region, emphasis, separated }), className)}
      {...props}
    />
  );
}

export function ChromeGroup({
  className,
  gap,
  grow,
  align,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof chromeGroupVariants>) {
  return (
    <div
      data-slot="chrome-group"
      className={cn(chromeGroupVariants({ gap, grow, align }), className)}
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
        "shrink-0 bg-border/55",
        orientation === "vertical" ? "mx-0.5 h-3.5 w-px" : "my-0.5 h-px w-full",
        className,
      )}
      {...props}
    />
  );
}
