import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

export const chromeBarVariants = cva(
  "font-sans ui-text-chrome flex shrink-0 items-center text-subtle-foreground",
  {
    variants: {
      region: {
        title:
          "h-(--athas-title-bar-height) gap-(--athas-chrome-gap) bg-transparent px-(--athas-chrome-padding-inline)",
        footer:
          "h-(--athas-footer-height) gap-(--athas-chrome-gap) bg-transparent px-(--athas-chrome-padding-inline)",
        tabs: "h-(--athas-tab-bar-height) min-h-(--athas-tab-bar-height) gap-(--athas-chrome-gap) bg-background px-(--athas-chrome-padding-inline)",
        sidebar:
          "min-h-(--athas-sidebar-header-height) gap-(--athas-chrome-gap) bg-background/92 px-(--athas-chrome-padding-inline)",
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
      tight: "gap-(--athas-chrome-gap-tight)",
      default: "gap-(--athas-chrome-gap)",
      loose: "gap-(--athas-chrome-gap-loose)",
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

export const chromeLabelVariants = cva("min-w-0 truncate leading-(--athas-chrome-line-height)", {
  variants: {
    tone: {
      muted: "text-subtle-foreground",
      default: "text-muted-foreground",
      strong: "font-medium text-foreground",
      accent: "font-medium text-primary",
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
