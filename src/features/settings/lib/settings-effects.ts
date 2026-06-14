import {
  cacheFontsForBootstrap,
  cacheThemeForBootstrap,
} from "@/features/settings/lib/appearance-bootstrap";
import {
  resolveEffectiveTheme,
  subscribeSystemThemePreference,
} from "@/features/settings/lib/theme-resolution";
import { invoke } from "@tauri-apps/api/core";
import type { Settings, Theme } from "@/features/settings/types/settings.types";

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

function applyWindowTransparency(enabled: boolean) {
  if (typeof document === "undefined") return;

  document.documentElement.setAttribute(
    "data-window-transparency",
    enabled ? "enabled" : "disabled",
  );

  void invoke("set_window_transparency_enabled", { enabled }).catch((error) => {
    console.warn("Failed to sync window transparency", error);
  });
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
          syncMacOSWindowAppearance(appliedTheme.isDark ? "dark" : "light");
        }
      });
      return;
    }

    themeRegistry.applyTheme(theme);
    const appliedTheme = themeRegistry.getTheme(theme);
    if (appliedTheme) {
      cacheThemeForBootstrap(appliedTheme);
      syncMacOSWindowAppearance(appliedTheme.isDark ? "dark" : "light");
    }
  } catch (error) {
    console.error("Failed to apply theme via registry:", error);
    applyFallbackTheme(theme);
  }
}

function syncMacOSWindowAppearance(themeType: "light" | "dark") {
  const transparencyEnabled =
    typeof document === "undefined"
      ? true
      : document.documentElement.getAttribute("data-window-transparency") !== "disabled";

  void invoke("set_macos_window_appearance", { themeType, transparencyEnabled }).catch((error) => {
    console.warn("Failed to sync macOS window appearance", error);
  });
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

export function syncCustomProviderBaseUrl(baseUrl: string) {
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
export async function syncOllamaApiKey() {
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
}
