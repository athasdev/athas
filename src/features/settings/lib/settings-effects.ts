import {
  cacheFontsForBootstrap,
  cacheThemeForBootstrap,
  cacheWindowTransparencyForBootstrap,
  cacheUiDensityForBootstrap,
} from "@/features/settings/lib/appearance-bootstrap";
import {
  resolveEffectiveTheme,
  subscribeSystemThemePreference,
} from "@/features/settings/services/theme-resolution";
import { commands } from "@/bindings/commands";
import type { Settings, Theme } from "@/features/settings/types/settings.types";
import { getUiRootAttributes } from "@/features/settings/services/ui-preferences";
import {
  runSettingEffect,
  runSettingsEffects,
} from "@/features/settings/services/settings-effect-registry";

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

let removeThemeSyncListener: (() => void) | null = null;
let latestThemeSyncSettings: Settings | null = null;
let cancelPendingThemeApplication: (() => void) | null = null;
let themeApplicationVersion = 0;

function getCurrentThemeType(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme-type") === "light" ? "light" : "dark";
}

let requestedWindowTransparency = false;

function isEffectiveWindowTransparencyEnabled() {
  return (
    requestedWindowTransparency &&
    document.documentElement.getAttribute("data-reduce-transparency") !== "true"
  );
}

export function syncEffectiveWindowTransparency() {
  if (typeof document === "undefined") return;

  const enabled = isEffectiveWindowTransparencyEnabled();

  document.documentElement.setAttribute(
    "data-window-transparency",
    enabled ? "enabled" : "disabled",
  );

  void commands.setWindowTransparencyEnabled(enabled, getCurrentThemeType()).catch((error) => {
    console.warn("Failed to sync window transparency", error);
  });
}

function applyWindowTransparency(enabled: boolean) {
  requestedWindowTransparency = enabled;
  cacheWindowTransparencyForBootstrap(enabled);
  syncEffectiveWindowTransparency();
}

function applyUiPreferences(settings: Pick<Settings, "reduceMotion" | "uiDensity">) {
  if (typeof document === "undefined") return;

  for (const [name, value] of Object.entries(getUiRootAttributes(settings))) {
    document.documentElement.setAttribute(name, value);
  }
  cacheUiDensityForBootstrap(settings.uiDensity);
}

function stopSystemThemeSync() {
  removeThemeSyncListener?.();
  removeThemeSyncListener = null;
  latestThemeSyncSettings = null;
}

function syncThemeWithSystem(settings: Settings) {
  latestThemeSyncSettings = settings;
  const handleChange = () => {
    if (latestThemeSyncSettings) {
      void applyTheme(resolveEffectiveTheme(latestThemeSyncSettings));
    }
  };

  if (removeThemeSyncListener) {
    return;
  }

  removeThemeSyncListener = subscribeSystemThemePreference(handleChange);
}

async function applyTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  const version = ++themeApplicationVersion;
  cancelPendingThemeApplication?.();
  cancelPendingThemeApplication = null;

  try {
    const { themeRegistry } = await import("@/extensions/themes/theme-registry");
    if (version !== themeApplicationVersion) return;

    const applyRegisteredTheme = () => {
      if (version !== themeApplicationVersion) return;
      themeRegistry.applyTheme(theme);
      const appliedTheme = themeRegistry.getTheme(theme);
      if (appliedTheme) {
        cacheThemeForBootstrap(appliedTheme);
        syncNativeWindowAppearance(appliedTheme.isDark ? "dark" : "light");
      }
    };

    const waitForThemeRegistration = () => {
      cancelPendingThemeApplication?.();
      cancelPendingThemeApplication = themeRegistry.onRegistryChange(() => {
        if (version !== themeApplicationVersion) return;
        if (!themeRegistry.getTheme(theme)) return;
        cancelPendingThemeApplication?.();
        cancelPendingThemeApplication = null;
        applyRegisteredTheme();
      });
    };

    if (!themeRegistry.isRegistryReady()) {
      cancelPendingThemeApplication = themeRegistry.onReady(() => {
        if (version !== themeApplicationVersion) return;
        cancelPendingThemeApplication = null;
        if (themeRegistry.getTheme(theme)) {
          applyRegisteredTheme();
        } else {
          waitForThemeRegistration();
        }
      });
      return;
    }

    if (!themeRegistry.getTheme(theme)) {
      waitForThemeRegistration();
      return;
    }

    applyRegisteredTheme();
  } catch (error) {
    if (version !== themeApplicationVersion) return;
    console.error("Failed to apply theme via registry:", error);
    applyFallbackTheme(theme);
  }
}

function syncNativeWindowAppearance(themeType: "light" | "dark") {
  const transparencyEnabled =
    typeof document === "undefined" ? true : isEffectiveWindowTransparencyEnabled();

  void commands
    .setNativeWindowAppearance(themeType, transparencyEnabled, latestThemeSyncSettings !== null)
    .catch((error) => {
      console.warn("Failed to sync native window appearance", error);
    });
}

function cacheFontSettings(settings: Pick<Settings, "fontFamily" | "uiFontFamily" | "uiFontSize">) {
  cacheFontsForBootstrap(settings.fontFamily, settings.uiFontFamily, settings.uiFontSize);
}

export function applySettingsSideEffects(settings: Settings) {
  cacheFontSettings(settings);
  applyWindowTransparency(settings.windowTransparency);
  applyUiPreferences(settings);
  applyThemeSettings(settings);
  runSettingsEffects(settings);
}

function applyThemeSettings(settings: Settings) {
  if (settings.syncSystemTheme) {
    syncThemeWithSystem(settings);
  } else {
    stopSystemThemeSync();
  }
  void applyTheme(resolveEffectiveTheme(settings));
}

export function applySettingSideEffect<K extends keyof Settings>(
  key: K,
  value: Settings[K],
  getSettings: () => Settings,
) {
  if (key === "theme") {
    void applyTheme(resolveEffectiveTheme(getSettings()));
  }

  if (key === "syncSystemTheme" || key === "autoThemeLight" || key === "autoThemeDark") {
    applyThemeSettings(getSettings());
  }

  if (key === "fontFamily" || key === "uiFontFamily" || key === "uiFontSize") {
    cacheFontSettings(getSettings());
  }

  if (key === "windowTransparency") {
    applyWindowTransparency(value as boolean);
  }

  if (key === "reduceMotion" || key === "uiDensity") {
    applyUiPreferences(getSettings());
  }

  runSettingEffect(key, value);
}
