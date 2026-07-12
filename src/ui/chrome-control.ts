import { cva } from "class-variance-authority";

export type ChromeControlVariant = "icon" | "pill";

const chromeControlBase =
  "athas-chrome-control pointer-events-auto h-6 rounded-md border-0 bg-transparent leading-[1.35] [&_svg]:size-4";

export const chromeControlVariants = cva("", {
  variants: {
    chrome: {
      icon: `${chromeControlBase} w-7 px-0`,
      pill: `${chromeControlBase} min-w-7 px-2`,
    },
  },
});
