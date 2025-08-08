import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

type Theme = string;

interface Settings {
  theme: Theme;
  autoThemeLight: Theme;
  autoThemeDark: Theme;
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoSave: boolean;
  aiCompletion: boolean;
  sidebarPosition: "left" | "right";
  mouseWheelZoom: boolean;
}

const defaultSettings: Settings = {
  theme: "athas-dark", // Changed from "auto" since we don't support continuous monitoring
  autoThemeLight: "athas-light",
  autoThemeDark: "athas-dark",
  fontSize: 14,
  fontFamily: "JetBrains Mono",
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  autoSave: true,
  aiCompletion: true,
  sidebarPosition: "left",
  mouseWheelZoom: false,
};

// Theme class constants
const ALL_THEME_CLASSES = ["force-athas-light", "force-athas-dark"];

// Apply theme to document
const applyTheme = async (theme: Theme) => {
  if (typeof window === "undefined") return;

  // Handle auto theme by detecting system preference
  if (theme === "auto") {
    const systemTheme = getSystemThemePreference();
    // For auto theme, use the default light/dark behavior
    ALL_THEME_CLASSES.forEach((cls) => document.documentElement.classList.remove(cls));
    document.documentElement.classList.add(
      systemTheme === "dark" ? "force-athas-dark" : "force-athas-light",
    );
    return;
  }

  // For TOML themes, use the theme registry
  try {
    const { themeRegistry } = await import("@/extensions/themes/theme-registry");
    console.log(`Settings store: Attempting to apply theme "${theme}"`);

    // Check if theme registry is ready
    if (!themeRegistry.isRegistryReady()) {
      console.log("Settings store: Theme registry not ready, waiting...");
      themeRegistry.onReady(() => {
        console.log("Settings store: Theme registry ready, applying theme");
        themeRegistry.applyTheme(theme);
      });
      return;
    }

    themeRegistry.applyTheme(theme);
  } catch (error) {
    console.error("Failed to apply theme via registry:", error);
    applyFallbackTheme(theme);
  }
};

// Fallback theme application using CSS classes
const applyFallbackTheme = (theme: Theme) => {
  console.log(`Settings store: Falling back to class-based theme "${theme}"`);
  ALL_THEME_CLASSES.forEach((cls) => document.documentElement.classList.remove(cls));
  const themeClass = `force-${theme}`;
  document.documentElement.classList.add(themeClass);
};

// Get system theme preference
const getSystemThemePreference = (): "light" | "dark" => {
  if (typeof window !== "undefined" && window.matchMedia) {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (error) {
      console.warn("matchMedia not available:", error);
    }
  }
  return "dark";
};

// Initialize settings from localStorage
const getInitialSettings = (): Settings => {
  if (typeof window === "undefined") return defaultSettings;

  const stored = localStorage.getItem("athas-code-settings");
  if (stored) {
    try {
      const parsedSettings = JSON.parse(stored);
      return { ...defaultSettings, ...parsedSettings };
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  }

  // No stored settings, detect OS theme for better default
  const systemTheme = getSystemThemePreference();
  const defaultWithOSTheme = {
    ...defaultSettings,
    theme: systemTheme === "dark" ? "athas-dark" : ("athas-light" as Theme),
  };

  // Also detect OS theme asynchronously for more accurate detection
  invoke<string>("get_system_theme")
    .then((detectedTheme) => {
      const theme = detectedTheme === "dark" ? "dark" : "light";
      if (theme !== systemTheme && !localStorage.getItem("athas-code-settings")) {
        // Update to more accurate theme if user hasn't set preferences yet
        localStorage.setItem(
          "athas-code-settings",
          JSON.stringify({
            ...defaultWithOSTheme,
            theme: theme === "dark" ? "athas-dark" : "athas-light",
          }),
        );
        applyTheme(theme === "dark" ? "athas-dark" : ("athas-light" as Theme)).catch(console.error);
      }
    })
    .catch(() => {
      // Tauri command failed, stick with browser detection
    });

  return defaultWithOSTheme;
};

// Apply initial theme
const initialSettings = getInitialSettings();
if (typeof window !== "undefined") {
  // Apply theme immediately on module load
  applyTheme(initialSettings.theme).catch(console.error);
}

export const useSettingsStore = create(
  immer(
    combine(
      {
        settings: getInitialSettings(),
      },
      (set, get) => ({
        // Update settings from JSON string
        updateSettingsFromJSON: (jsonString: string): boolean => {
          try {
            const parsedSettings = JSON.parse(jsonString);
            const validatedSettings = { ...defaultSettings, ...parsedSettings };

            set((state) => {
              state.settings = validatedSettings;
            });

            // Save to localStorage
            localStorage.setItem("athas-code-settings", JSON.stringify(validatedSettings, null, 2));
            return true;
          } catch (error) {
            console.error("Error parsing settings JSON:", error);
            return false;
          }
        },

        // Update individual setting
        updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => {
          console.log(`Updating setting ${key} to:`, value);
          set((state) => {
            state.settings[key] = value;
          });

          // Save to localStorage
          const newSettings = get().settings;
          localStorage.setItem("athas-code-settings", JSON.stringify(newSettings, null, 2));
        },

        // Get settings as formatted JSON string
        getSettingsJSON: () => {
          return JSON.stringify(get().settings, null, 2);
        },

        // Save settings
        saveSettings: (newSettings: Settings) => {
          set((state) => {
            state.settings = newSettings;
          });
          localStorage.setItem("athas-code-settings", JSON.stringify(newSettings, null, 2));
        },

        // Update theme
        updateTheme: (theme: Theme) => {
          set((state) => {
            state.settings.theme = theme;
          });
          localStorage.setItem("athas-code-settings", JSON.stringify(get().settings, null, 2));

          // Apply theme to document immediately
          applyTheme(theme).catch(console.error);
        },
      }),
    ),
  ),
);
