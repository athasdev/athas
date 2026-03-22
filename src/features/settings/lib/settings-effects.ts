import { cacheFontsForBootstrap, cacheThemeForBootstrap } from "@/features/settings/lib/appearance-bootstrap";
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

export function cacheFontSettings(settings: Pick<Settings, "fontFamily" | "uiFontFamily" | "uiFontSize">) {
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
  void applyTheme(settings.theme);
  syncOllamaBaseUrl(settings.ollamaBaseUrl);
}

export function applySettingSideEffect<K extends keyof Settings>(
  key: K,
  value: Settings[K],
  getSettings: () => Settings,
) {
  if (key === "theme") {
    void applyTheme(value as Theme);
  }

  if (key === "ollamaBaseUrl") {
    syncOllamaBaseUrl(value as string);
  }

  if (key === "fontFamily" || key === "uiFontFamily" || key === "uiFontSize") {
    cacheFontSettings(getSettings());
  }
}
