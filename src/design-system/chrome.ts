import { cva } from "class-variance-authority";

export const chromeBarVariants = cva(
  "font-sans ui-text-chrome flex shrink-0 items-center text-text-lighter",
  {
    variants: {
      region: {
        title:
          "h-[var(--athas-title-bar-height)] gap-[var(--athas-chrome-gap)] bg-transparent px-[var(--athas-chrome-padding-inline)]",
        footer:
          "h-[var(--athas-footer-height)] gap-[var(--athas-chrome-gap)] bg-transparent px-[var(--athas-chrome-padding-inline)]",
        tabs: "h-[var(--athas-tab-bar-height)] min-h-[var(--athas-tab-bar-height)] gap-[var(--athas-chrome-gap)] bg-tab-bar px-[var(--athas-chrome-padding-inline)]",
        sidebar:
          "min-h-[var(--athas-sidebar-header-height)] gap-[var(--athas-chrome-gap)] bg-primary-bg/92 px-[var(--athas-chrome-padding-inline)]",
      },
      emphasis: {
        supporting: "text-text-lighter",
        neutral: "text-text-light",
        primary: "text-text",
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
      tight: "gap-[var(--athas-chrome-gap-tight)]",
      default: "gap-[var(--athas-chrome-gap)]",
      loose: "gap-[var(--athas-chrome-gap-loose)]",
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

export const chromeLabelVariants = cva(
  "min-w-0 truncate leading-[var(--athas-chrome-line-height)]",
  {
    variants: {
      tone: {
        muted: "text-text-lighter",
        default: "text-text-light",
        strong: "font-medium text-text",
        accent: "font-medium text-accent",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);
