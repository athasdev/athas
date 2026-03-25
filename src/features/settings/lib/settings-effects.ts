import {
  cacheFontsForBootstrap,
  cacheThemeForBootstrap,
} from "@/features/settings/lib/appearance-bootstrap";
import type { Settings, Theme } from "@/features/settings/types/settings";

const ALL_THEME_CLASSES = [
  "force-athas-light",
  "force-athas-dark",
  "force-vitesse-light",
  "force-vitesse-dark",
];

function applyFallbackTheme(theme: Theme) {
  console.log(`Settings store: Falling back to class-based theme "${theme}"`);
  ALL_THEME_CLASSES.forEach((cls) => document.documentElement.classList.remove(cls));
  document.documentElement.classList.add(`force-${theme}`);
}

type SystemThemePreference = "light" | "dark";

interface LegacyMediaQueryList extends MediaQueryList {
  addListener(listener: (event: MediaQueryListEvent) => void): void;
  removeListener(listener: (event: MediaQueryListEvent) => void): void;
}

let currentThemeSyncQuery: MediaQueryList | null = null;
let removeThemeSyncListener: (() => void) | null = null;

function getSystemThemePreference(): SystemThemePreference {
  if (typeof window !== "undefined" && window.matchMedia) {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      console.warn("matchMedia not available:", error);
    }
  }

  return "dark";
}

function getEffectiveTheme(settings: Pick<Settings, "theme" | "syncSystemTheme" | "autoThemeLight" | "autoThemeDark">): Theme {
  if (!settings.syncSystemTheme) {
    return settings.theme;
  }

  return getSystemThemePreference() === "dark" ? settings.autoThemeDark : settings.autoThemeLight;
}

function stopSystemThemeSync() {
  removeThemeSyncListener?.();
  removeThemeSyncListener = null;
  currentThemeSyncQuery = null;
}

function syncThemeWithSystem(settings: Settings) {
  if (typeof window === "undefined" || !window.matchMedia) {
    return;
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => {
    void applyTheme(getEffectiveTheme(settings));
  };

  if (currentThemeSyncQuery === mediaQuery && removeThemeSyncListener) {
    return;
  }

  stopSystemThemeSync();

  if ("addEventListener" in mediaQuery) {
    mediaQuery.addEventListener("change", handleChange);
    removeThemeSyncListener = () => mediaQuery.removeEventListener("change", handleChange);
  } else {
    const legacyMediaQuery = mediaQuery as LegacyMediaQueryList;
    legacyMediaQuery.addListener(handleChange);
    removeThemeSyncListener = () => legacyMediaQuery.removeListener(handleChange);
  }

  currentThemeSyncQuery = mediaQuery;
}

export async function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;

  try {
    const { themeRegistry } = await import("@/extensions/themes/theme-registry");

    if (!themeRegistry.isRegistryReady()) {
      themeRegistry.onReady(() => {
        themeRegistry.applyTheme(theme);
        const appliedTheme = themeRegistry.getTheme(theme);
        if (appliedTheme) {
          cacheThemeForBootstrap(appliedTheme);
        }
      });
      return;
    }

    themeRegistry.applyTheme(theme);
    const appliedTheme = themeRegistry.getTheme(theme);
    if (appliedTheme) {
      cacheThemeForBootstrap(appliedTheme);
    }
  } catch (error) {
    console.error("Failed to apply theme via registry:", error);
    applyFallbackTheme(theme);
  }
}

export function cacheFontSettings(
  settings: Pick<Settings, "fontFamily" | "uiFontFamily" | "uiFontSize">,
) {
  cacheFontsForBootstrap(settings.fontFamily, settings.uiFontFamily, settings.uiFontSize);
}

export function syncOllamaBaseUrl(baseUrl: string) {
  if (!baseUrl) {
    return;
  }

  void import("@/features/ai/services/providers/ai-provider-registry").then(
    ({ setOllamaBaseUrl }) => {
      setOllamaBaseUrl(baseUrl);
    },
  );
}

export function applySettingsSideEffects(settings: Settings) {
  cacheFontSettings(settings);
  void applyTheme(getEffectiveTheme(settings));
  if (settings.syncSystemTheme) {
    syncThemeWithSystem(settings);
  } else {
    stopSystemThemeSync();
  }
  syncOllamaBaseUrl(settings.ollamaBaseUrl);
}

export function applySettingSideEffect<K extends keyof Settings>(
  key: K,
  value: Settings[K],
  getSettings: () => Settings,
) {
  if (key === "theme") {
    void applyTheme(getEffectiveTheme(getSettings()));
  }

  if (key === "syncSystemTheme" || key === "autoThemeLight" || key === "autoThemeDark") {
    const settings = getSettings();
    void applyTheme(getEffectiveTheme(settings));

    if (settings.syncSystemTheme) {
      syncThemeWithSystem(settings);
    } else {
      stopSystemThemeSync();
    }
  }

  if (key === "ollamaBaseUrl") {
    syncOllamaBaseUrl(value as string);
  }

  if (key === "fontFamily" || key === "uiFontFamily" || key === "uiFontSize") {
    cacheFontSettings(getSettings());
  }
}
