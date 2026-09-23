import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom utilities from src/styles, registered so merges resolve conflicts with them instead of
// dropping them (bg-checkerboard would otherwise read as a background color).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "bg-image": ["bg-checkerboard"],
      leading: ["leading-inherit"],
    },
    theme: {
      leading: ["row", "chrome"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
