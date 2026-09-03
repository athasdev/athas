import { getUiFontScale } from "@/features/settings/lib/ui-font-size";

const COLLAPSED_ACTIVITY_BAR_INLINE_PADDING = 8;
const COLLAPSED_ACTIVITY_BAR_CONTROL_WIDTH = 24;

export const COLLAPSED_ACTIVITY_BAR_WIDTH =
  COLLAPSED_ACTIVITY_BAR_INLINE_PADDING * 2 + COLLAPSED_ACTIVITY_BAR_CONTROL_WIDTH;

export function getCollapsedActivityBarWidth(uiFontSize: number) {
  return Math.max(
    COLLAPSED_ACTIVITY_BAR_WIDTH,
    COLLAPSED_ACTIVITY_BAR_INLINE_PADDING * 2 +
      COLLAPSED_ACTIVITY_BAR_CONTROL_WIDTH * getUiFontScale(uiFontSize),
  );
}
