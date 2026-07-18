import { describe, expect, it } from "vite-plus/test";
import { getDefaultSettingsSnapshot } from "@/features/settings/config/default-settings";

describe("default settings", () => {
  it("starts with window transparency disabled", () => {
    expect(getDefaultSettingsSnapshot().windowTransparency).toBe(false);
  });
});
