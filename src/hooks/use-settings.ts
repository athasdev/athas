import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { ThemeType } from "../types/theme";

export interface Settings {
  theme: ThemeType;
  autoThemeLight: ThemeType;
  autoThemeDark: ThemeType;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoSave: boolean;
  vimMode: boolean;
  aiCompletion: boolean;
  sidebarPosition: "left" | "right";
}

const defaultSettings: Settings = {
  theme: "auto",
  autoThemeLight: "light",
  autoThemeDark: "dark",
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  autoSave: false,
  vimMode: false,
  aiCompletion: true,
  sidebarPosition: "left",
};

// Initialize theme from localStorage synchronously to prevent flash
const getInitialSettings = (): Settings => {
  const stored = localStorage.getItem("athas-code-settings");
  if (stored) {
    try {
      const parsedSettings = JSON.parse(stored);
      return { ...defaultSettings, ...parsedSettings };
    } catch (error) {
      console.error("Error loading settings:", error);
    }
  }
  return defaultSettings;
};

// Initialize settings
const initialSettings = getInitialSettings();

const ALL_THEME_CLASSES = [
  "force-light",
  "force-dark",
  "force-midnight",
  "force-tokyo-night",
  "force-tokyonight",
  "force-dracula",
  "force-nord",
  "force-github",
  "force-github-dark",
  "force-github-light",
  "force-one-dark",
  "force-one-dark-pro",
  "force-material",
  "force-material-deep-ocean",
  "force-ayu-dark",
  "force-vesper",
  "force-catppuccin",
  "force-catppuccin-mocha",
  "force-catppuccin-macchiato",
  "force-catppuccin-frappe",
  "force-catppuccin-latte",
  "force-tokyo-night-storm",
  "force-tokyo-night-light",
  "force-dracula-soft",
  "force-nord-light",
  "force-github-dark-dimmed",
  "force-one-light-pro",
  "force-material-palenight",
  "force-material-lighter",
  "force-gruvbox",
  "force-gruvbox-light",
  "force-solarized-dark",
  "force-solarized-light",
  "force-synthwave-84",
  "force-monokai",
  "force-monokai-pro",
  "force-ayu",
  "force-ayu-mirage",
  "force-ayu-light",
  "force-vercel-dark",
  "force-aura",
];

const applySpecificTheme = (theme: ThemeType) => {
  if (typeof window === "undefined") return;

  ALL_THEME_CLASSES.forEach(cls => document.documentElement.classList.remove(cls));

  if (theme) {
    let themeClass = `force-${theme}`;
    if (theme === "gruvbox-dark") {
      themeClass = "force-gruvbox";
    }
    document.documentElement.classList.add(themeClass);
  }
};

const getSystemThemeSync = (): "light" | "dark" => {
  if (typeof window !== "undefined" && window.matchMedia) {
    try {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      return mediaQuery.matches ? "dark" : "light";
    } catch (error) {
      console.warn("matchMedia not available:", error);
    }
  }
  // default fallback to dark because who in right mind codes in light mode?
  return "dark";
};

const getSystemTheme = async (): Promise<"light" | "dark"> => {
  try {
    const theme = await invoke<string>("get_system_theme");
    return theme === "dark" ? "dark" : "light";
  } catch (error) {
    console.error("Error detecting system theme:", error);
    return getSystemThemeSync();
  }
};

// Apply initial theme with both sync and async detection
const applyInitialTheme = async () => {
  if (initialSettings.theme === "auto") {
    const syncTheme = getSystemThemeSync();
    const initialThemeToApply =
      syncTheme === "dark" ? initialSettings.autoThemeDark : initialSettings.autoThemeLight;
    applySpecificTheme(initialThemeToApply);

    try {
      const asyncTheme = await getSystemTheme();
      console.log("System theme detected (async):", asyncTheme);

      if (asyncTheme !== syncTheme) {
        const correctedTheme =
          asyncTheme === "dark" ? initialSettings.autoThemeDark : initialSettings.autoThemeLight;
        console.log("Correcting theme to:", correctedTheme);
        applySpecificTheme(correctedTheme);
      }

      // Start theme monitoring for auto mode
      await invoke("start_theme_monitoring");
    } catch (error) {
      console.error("Error with async theme detection:", error);
    }
  } else {
    applySpecificTheme(initialSettings.theme);
  }
};

applyInitialTheme().catch(console.error);

export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(initialSettings);

  useEffect(() => {
    if (settings.theme !== "auto") {
      applySpecificTheme(settings.theme);
      // Stop monitoring when not in auto mode
      invoke("stop_theme_monitoring").catch(console.error);
      return;
    }

    let unlistenThemeChange: (() => void) | null = null;

    // Set up event listener for system theme changes
    const setupThemeListener = async () => {
      try {
        // Start monitoring
        await invoke("start_theme_monitoring");

        // Listen for theme change events
        const unlisten = await listen<string>("system-theme-changed", event => {
          console.log("System theme changed to:", event.payload);
          const themeToApply =
            event.payload === "dark" ? settings.autoThemeDark : settings.autoThemeLight;
          applySpecificTheme(themeToApply);
        });

        unlistenThemeChange = unlisten;

        // Initial theme detection
        const detectedTheme = await getSystemTheme();
        const themeToApply =
          detectedTheme === "dark" ? settings.autoThemeDark : settings.autoThemeLight;
        applySpecificTheme(themeToApply);
      } catch (error) {
        console.error("Error setting up theme monitoring:", error);
      }
    };

    setupThemeListener();

    return () => {
      // Clean up event listener
      if (unlistenThemeChange) {
        unlistenThemeChange();
      }
      // Stop monitoring when component unmounts or theme changes
      invoke("stop_theme_monitoring").catch(console.error);
    };
  }, [settings.theme, settings.autoThemeLight, settings.autoThemeDark]);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: Settings) => {
    try {
      localStorage.setItem("athas-code-settings", JSON.stringify(newSettings, null, 2));
      setSettings(newSettings);
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  }, []);

  // Get settings as formatted JSON string
  const getSettingsJSON = useCallback(() => {
    return JSON.stringify(settings, null, 2);
  }, [settings]);

  // Update settings from JSON string
  const updateSettingsFromJSON = useCallback(
    (jsonString: string) => {
      try {
        const parsedSettings = JSON.parse(jsonString);
        const validatedSettings = { ...defaultSettings, ...parsedSettings };
        saveSettings(validatedSettings);
        return true;
      } catch (error) {
        console.error("Error parsing settings JSON:", error);
        return false;
      }
    },
    [saveSettings],
  );

  // Update individual setting
  const updateSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      const newSettings = { ...settings, [key]: value };
      saveSettings(newSettings);
    },
    [settings, saveSettings],
  );

  return {
    settings,
    getSettingsJSON,
    updateSettingsFromJSON,
    updateSetting,
    saveSettings,
  };
};
