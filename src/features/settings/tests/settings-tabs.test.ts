import { describe, expect, it } from "vite-plus/test";
import { SETTINGS_TAB_ITEMS } from "@/features/settings/config/settings-tabs";
import { normalizeSettingValue } from "../lib/settings-normalization";

describe("settings tabs", () => {
  it("preserves every selectable page when restoring settings", () => {
    for (const item of SETTINGS_TAB_ITEMS) {
      expect(normalizeSettingValue("lastSettingsTab", item.id)).toBe(item.id);
    }
  });
});
