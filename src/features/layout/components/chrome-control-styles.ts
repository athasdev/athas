import { cva } from "class-variance-authority";

export const chromeControlGroup = cva(
  "pointer-events-auto gap-1 overflow-visible border-0 bg-transparent p-0",
);

export const chromeControl = cva(
  "athas-chrome-control min-h-6 min-w-7 rounded-md border-0 bg-transparent leading-[1.35] focus-visible:rounded-md [&_svg]:size-4 [&_svg]:min-h-4 [&_svg]:min-w-4",
  {
    variants: {
      shape: {
        icon: "w-7 px-0",
        pill: "px-2",
        sidebar: "size-9 rounded-lg",
        tab: "w-8 rounded-md",
      },
    },
    defaultVariants: {
      shape: "icon",
    },
  },
);

export const chromeIcon = cva("size-4");

export const chromeItemWrapper = cva("flex min-h-6 items-center");
