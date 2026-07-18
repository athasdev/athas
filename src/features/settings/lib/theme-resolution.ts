import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { Settings, Theme } from "@/features/settings/types/settings.types";

export type SystemThemePreference = "light" | "dark";

type ThemeResolutionSettings = Pick<
  Settings,
  "theme" | "syncSystemTheme" | "autoThemeLight" | "autoThemeDark"
>;

interface LegacyMediaQueryList extends MediaQueryList {
  addListener(listener: (event: MediaQueryListEvent) => void): void;
  removeListener(listener: (event: MediaQueryListEvent) => void): void;
}

export function getSystemThemePreference(): SystemThemePreference {
  if (typeof window !== "undefined" && window.matchMedia) {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      console.warn("matchMedia not available:", error);
    }
  }

  return "dark";
}

export function resolveEffectiveTheme(
  settings: ThemeResolutionSettings,
  systemTheme: SystemThemePreference = getSystemThemePreference(),
): Theme {
  if (!settings.syncSystemTheme) {
    return settings.theme;
  }

  return systemTheme === "dark" ? settings.autoThemeDark : settings.autoThemeLight;
}

export function getThemeColorScheme(themeId: Theme): SystemThemePreference | null {
  const registeredTheme = themeRegistry.getTheme(themeId);
  if (registeredTheme) {
    return registeredTheme.isDark ? "dark" : "light";
  }

  if (/\bdark\b/i.test(themeId)) return "dark";
  if (/\blight\b/i.test(themeId)) return "light";
  return null;
}

export function getSystemSyncThemePreferencePatch(
  settings: Pick<Settings, "theme" | "autoThemeLight" | "autoThemeDark">,
): Partial<Pick<Settings, "autoThemeLight" | "autoThemeDark">> {
  const themeType = getThemeColorScheme(settings.theme);
  if (themeType === "light" && settings.autoThemeLight !== settings.theme) {
    return { autoThemeLight: settings.theme };
  }
  if (themeType === "dark" && settings.autoThemeDark !== settings.theme) {
    return { autoThemeDark: settings.theme };
  }

  return {};
}

export function subscribeSystemThemePreference(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {};
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  if ("addEventListener" in mediaQuery) {
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
  }

  const legacyMediaQuery = mediaQuery as LegacyMediaQueryList;
  legacyMediaQuery.addListener(callback);
  return () => legacyMediaQuery.removeListener(callback);
}
