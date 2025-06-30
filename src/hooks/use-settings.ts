import { useState, useEffect, useCallback } from "react";

export interface Settings {
  theme:
    | "auto"
    | "light"
    | "dark"
    | "midnight"
    | "tokyonight"
    | "monokai"
    | "dracula"
    | "nord"
    | "github"
    | "one-dark"
    | "material"
    | "ayu"
    | "vesper";
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  autoSave: boolean;
  vimMode: boolean;
  aiCompletion: boolean;
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
};

export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  // Load settings from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("athas-code-settings");
    if (stored) {
      try {
        const parsedSettings = JSON.parse(stored);
        setSettings({ ...defaultSettings, ...parsedSettings });
      } catch (error) {
        console.error("Error loading settings:", error);
      }
    }
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: Settings) => {
    try {
      localStorage.setItem(
        "athas-code-settings",
        JSON.stringify(newSettings, null, 2),
      );
      setSettings(newSettings);

      // Apply theme change immediately
      applyTheme(newSettings.theme);
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  }, []);

  // Apply theme changes
  const applyTheme = useCallback((theme: Settings["theme"]) => {
    document.documentElement.classList.remove(
      "force-light",
      "force-dark",
      "force-midnight",
      "force-tokyonight",
      "force-monokai",
      "force-dracula",
      "force-nord",
      "force-github",
      "force-one-dark",
      "force-material",
      "force-ayu",
      "force-vesper",
    );

    if (theme === "light") {
      document.documentElement.classList.add("force-light");
    } else if (theme === "dark") {
      document.documentElement.classList.add("force-dark");
    } else if (theme === "midnight") {
      document.documentElement.classList.add("force-midnight");
    } else if (theme === "tokyonight") {
      document.documentElement.classList.add("force-tokyonight");
    } else if (theme === "monokai") {
      document.documentElement.classList.add("force-monokai");
    } else if (theme === "dracula") {
      document.documentElement.classList.add("force-dracula");
    } else if (theme === "nord") {
      document.documentElement.classList.add("force-nord");
    } else if (theme === "github") {
      document.documentElement.classList.add("force-github");
    } else if (theme === "one-dark") {
      document.documentElement.classList.add("force-one-dark");
    } else if (theme === "material") {
      document.documentElement.classList.add("force-material");
    } else if (theme === "ayu") {
      document.documentElement.classList.add("force-ayu");
    } else if (theme === "vesper") {
      document.documentElement.classList.add("force-vesper");
    }
    // 'auto' doesn't add any class, so it follows system preference
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
    applyTheme,
  };
};
