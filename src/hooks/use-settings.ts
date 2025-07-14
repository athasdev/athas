import { useCallback, useState } from "react";
import type { ThemeType } from "../types/theme";

export interface Settings {
  theme: ThemeType;
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
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  autoSave: true,
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

// Apply theme immediately on load
const initialSettings = getInitialSettings();
if (typeof window !== "undefined") {
  const themeClasses = [
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

  themeClasses.forEach(cls => document.documentElement.classList.remove(cls));

  if (initialSettings.theme !== "auto") {
    let themeClass = `force-${initialSettings.theme}`;
    if (initialSettings.theme === "gruvbox-dark") {
      themeClass = "force-gruvbox";
    }
    document.documentElement.classList.add(themeClass);
  }
}

export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(initialSettings);

  // Apply theme changes
  const applyTheme = useCallback((theme: Settings["theme"]) => {
    // Remove all existing theme classes
    const themeClasses = [
      "force-light",
      "force-dark",
      "force-midnight",
      "force-tokyo-night",
      "force-tokyonight", // Handle both old and new
      "force-dracula",
      "force-nord",
      "force-github",
      "force-github-dark",
      "force-github-light",
      "force-one-dark",
      "force-one-dark-pro",
      "force-material",
      "force-material-deep-ocean",
      "force-ayu",
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
      "force-ayu-mirage",
      "force-ayu-light",
      "force-vercel-dark",
      "force-aura",
    ];

    themeClasses.forEach(cls => document.documentElement.classList.remove(cls));

    // Apply specific theme class
    if (theme !== "auto") {
      // Handle special case for gruvbox-dark which maps to force-gruvbox
      let themeClass = `force-${theme}`;
      if (theme === "gruvbox-dark") {
        themeClass = "force-gruvbox";
      }
      document.documentElement.classList.add(themeClass);
    }
    // 'auto' doesn't add any class, so it follows system preference
  }, []);

  // Theme is now applied synchronously on load, so we don't need to apply it here

  // Save settings to localStorage
  const saveSettings = useCallback(
    (newSettings: Settings) => {
      try {
        localStorage.setItem("athas-code-settings", JSON.stringify(newSettings, null, 2));
        setSettings(newSettings);

        // Apply theme change immediately
        applyTheme(newSettings.theme);
      } catch (error) {
        console.error("Error saving settings:", error);
      }
    },
    [applyTheme],
  );

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
    applyTheme,
  };
};
