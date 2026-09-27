import { createCn } from "cn/config";

// Custom utilities from src/styles, registered so merges resolve conflicts with them instead of
// dropping them (bg-checkerboard would otherwise read as a background color).
export const cn = createCn({
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
