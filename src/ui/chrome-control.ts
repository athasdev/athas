import { cva } from "class-variance-authority";

export type ChromeControlVariant = "icon" | "pill";

const chromeControlBase =
  "athas-chrome-control pointer-events-auto min-h-6 min-w-7 rounded-[var(--app-radius-control-sm)] border-0 bg-transparent leading-[1.35] focus-visible:rounded-[var(--app-radius-control-sm)] [&_svg]:size-4 [&_svg]:min-h-4 [&_svg]:min-w-4";

export const chromeControlVariants = cva("", {
  variants: {
    chrome: {
      icon: `${chromeControlBase} w-7 px-0`,
      pill: `${chromeControlBase} px-2`,
    },
  },
});
