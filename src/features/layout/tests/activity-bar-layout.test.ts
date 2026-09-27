import { describe, expect, it } from "vitest";
import { UI_FONT_SIZE_DEFAULT } from "@/features/settings/lib/ui-font-size";
import {
  COLLAPSED_ACTIVITY_BAR_WIDTH,
  getCollapsedActivityBarWidth,
} from "../utils/activity-bar-layout";

describe("activity bar layout", () => {
  it("keeps the default rail at 40 pixels", () => {
    expect(COLLAPSED_ACTIVITY_BAR_WIDTH).toBe(40);
    expect(getCollapsedActivityBarWidth(UI_FONT_SIZE_DEFAULT)).toBe(COLLAPSED_ACTIVITY_BAR_WIDTH);
    expect(getCollapsedActivityBarWidth(10)).toBe(COLLAPSED_ACTIVITY_BAR_WIDTH);
  });

  it("grows the collapsed rail with scaled chrome controls", () => {
    expect(getCollapsedActivityBarWidth(15)).toBeCloseTo(44.92, 2);
  });
});
