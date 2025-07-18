import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
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
  autoSave: true,
  vimMode: false,
  aiCompletion: true,
  sidebarPosition: "left",
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
  return defaultSettings;
};

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

            set(state => {
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
          set(state => {
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
          set(state => {
            state.settings = newSettings;
          });
          localStorage.setItem("athas-code-settings", JSON.stringify(newSettings, null, 2));
        },

        // Update theme
        updateTheme: (theme: ThemeType) => {
          set(state => {
            state.settings.theme = theme;
          });
          localStorage.setItem("athas-code-settings", JSON.stringify(get().settings, null, 2));
        },
      }),
    ),
  ),
);
