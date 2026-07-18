import { describe, expect, it } from "vite-plus/test";
import {
  getSystemSyncThemePreferencePatch,
  resolveEffectiveTheme,
} from "@/features/settings/lib/theme-resolution";

describe("theme resolution", () => {
  it("uses the manual theme when OS sync is disabled", () => {
    expect(
      resolveEffectiveTheme(
        {
          theme: "one-dark",
          syncSystemTheme: false,
          autoThemeLight: "one-light",
          autoThemeDark: "athas-dark",
        },
        "light",
      ),
    ).toBe("one-dark");
  });

  it("uses the configured light or dark theme when OS sync is enabled", () => {
    const settings = {
      theme: "one-dark",
      syncSystemTheme: true,
      autoThemeLight: "vitesse-light",
      autoThemeDark: "tokyo-night-dark",
    };

    expect(resolveEffectiveTheme(settings, "light")).toBe("vitesse-light");
    expect(resolveEffectiveTheme(settings, "dark")).toBe("tokyo-night-dark");
  });

  it("preserves the current light theme when enabling OS sync", () => {
    expect(
      getSystemSyncThemePreferencePatch({
        theme: "one-light",
        autoThemeLight: "athas-light",
        autoThemeDark: "athas-dark",
      }),
    ).toEqual({ autoThemeLight: "one-light" });
  });

  it("preserves the current dark theme when enabling OS sync", () => {
    expect(
      getSystemSyncThemePreferencePatch({
        theme: "one-dark",
        autoThemeLight: "athas-light",
        autoThemeDark: "athas-dark",
      }),
    ).toEqual({ autoThemeDark: "one-dark" });
  });
});
