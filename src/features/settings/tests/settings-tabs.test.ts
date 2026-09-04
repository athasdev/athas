import { describe, expect, it } from "vite-plus/test";
import { SETTINGS_TAB_GROUPS, SETTINGS_TAB_ITEMS } from "@/features/settings/config/settings-tabs";

describe("settings tab groups", () => {
  it("places every settings tab in exactly one navigation group", () => {
    const tabIds = SETTINGS_TAB_ITEMS.map((item) => item.id).sort();
    const groupedTabIds = SETTINGS_TAB_GROUPS.flatMap((group) => group.tabs).sort();

    expect(groupedTabIds).toEqual(tabIds);
    expect(new Set(groupedTabIds).size).toBe(groupedTabIds.length);
  });
});
