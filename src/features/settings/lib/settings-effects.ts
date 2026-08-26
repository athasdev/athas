import {
  cacheFontsForBootstrap,
  cacheThemeForBootstrap,
  cacheWindowTransparencyForBootstrap,
} from "@/features/settings/lib/appearance-bootstrap";
import {
  resolveEffectiveTheme,
  subscribeSystemThemePreference,
} from "@/features/settings/lib/theme-resolution";
import { invoke } from "@tauri-apps/api/core";
import type { Settings, Theme } from "@/features/settings/types/settings.types";
import { getUiRootAttributes } from "@/features/settings/lib/ui-preferences";

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

  void invoke("set_window_transparency_enabled", {
    enabled,
    themeType: getCurrentThemeType(),
  }).catch((error) => {
    console.warn("Failed to sync window transparency", error);
  });
}

function applyWindowTransparency(enabled: boolean) {
  requestedWindowTransparency = enabled;
  cacheWindowTransparencyForBootstrap(enabled);
  syncEffectiveWindowTransparency();
}

function applyUiPreferences(settings: Pick<Settings, "reduceMotion" | "showStatusBar">) {
  if (typeof document === "undefined") return;

  for (const [name, value] of Object.entries(getUiRootAttributes(settings))) {
    document.documentElement.setAttribute(name, value);
  }
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

  try {
    const { themeRegistry } = await import("@/extensions/themes/theme-registry");

    const applyRegisteredTheme = () => {
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
        if (!themeRegistry.getTheme(theme)) return;
        cancelPendingThemeApplication?.();
        cancelPendingThemeApplication = null;
        applyRegisteredTheme();
      });
    };

    if (!themeRegistry.isRegistryReady()) {
      themeRegistry.onReady(() => {
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

    cancelPendingThemeApplication?.();
    cancelPendingThemeApplication = null;
    applyRegisteredTheme();
  } catch (error) {
    console.error("Failed to apply theme via registry:", error);
    applyFallbackTheme(theme);
  }
}

function syncNativeWindowAppearance(themeType: "light" | "dark") {
  const transparencyEnabled =
    typeof document === "undefined" ? true : isEffectiveWindowTransparencyEnabled();

  void invoke("set_native_window_appearance", { themeType, transparencyEnabled }).catch((error) => {
    console.warn("Failed to sync native window appearance", error);
  });
}

function cacheFontSettings(settings: Pick<Settings, "fontFamily" | "uiFontFamily" | "uiFontSize">) {
  cacheFontsForBootstrap(settings.fontFamily, settings.uiFontFamily, settings.uiFontSize);
}

function syncOllamaBaseUrl(baseUrl: string) {
  if (!baseUrl) {
    return;
  }

  void import("@/features/ai/services/providers/ai-provider-registry").then(
    ({ setOllamaBaseUrl }) => {
      setOllamaBaseUrl(baseUrl);
    },
  );
}

function syncCustomProviderBaseUrl(baseUrl: string) {
  void import("@/features/ai/services/providers/ai-provider-registry").then(
    ({ setCustomProviderBaseUrl }) => {
      setCustomProviderBaseUrl(baseUrl);
    },
  );
}

/**
 * Pushes the Ollama API key (stored in Tauri's secure storage) into the
 * singleton provider instance so `getModels`, connection checks, and other
 * non-streaming calls can authenticate with Ollama Cloud.
 */
async function syncOllamaApiKey() {
  const [{ setOllamaApiKey }, { getProviderApiToken }] = await Promise.all([
    import("@/features/ai/services/providers/ai-provider-registry"),
    import("@/features/ai/services/ai-token-service"),
  ]);
  const token = await getProviderApiToken("ollama");
  setOllamaApiKey(token);
}

export function applySettingsSideEffects(settings: Settings) {
  cacheFontSettings(settings);
  applyWindowTransparency(settings.windowTransparency);
  applyUiPreferences(settings);
  void applyTheme(resolveEffectiveTheme(settings));
  if (settings.syncSystemTheme) {
    syncThemeWithSystem(settings);
  } else {
    stopSystemThemeSync();
  }
  syncOllamaBaseUrl(settings.ollamaBaseUrl);
  syncCustomProviderBaseUrl(settings.aiCustomBaseUrl);
  void syncOllamaApiKey();
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
    const settings = getSettings();
    void applyTheme(resolveEffectiveTheme(settings));

    if (settings.syncSystemTheme) {
      syncThemeWithSystem(settings);
    } else {
      stopSystemThemeSync();
    }
  }

  if (key === "ollamaBaseUrl") {
    syncOllamaBaseUrl(value as string);
  }

  if (key === "aiCustomBaseUrl") {
    syncCustomProviderBaseUrl(value as string);
  }

  if (key === "fontFamily" || key === "uiFontFamily" || key === "uiFontSize") {
    cacheFontSettings(getSettings());
  }

  if (key === "windowTransparency") {
    applyWindowTransparency(value as boolean);
  }

  if (key === "reduceMotion" || key === "showStatusBar") {
    applyUiPreferences(getSettings());
  }
}
