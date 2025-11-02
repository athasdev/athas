import { create } from "zustand";
import { persist } from "zustand/middleware";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import type { IconThemeDefinition } from "@/extensions/icon-themes/types";

interface IconThemeState {
  currentTheme: string;
  setCurrentTheme: (theme: string) => void;
  getCurrentThemeDefinition: () => IconThemeDefinition | undefined;
}

export const useIconThemeStore = create<IconThemeState>()(
  persist(
    (set, get) => ({
      currentTheme: "material",
      setCurrentTheme: (theme: string) => set({ currentTheme: theme }),
      getCurrentThemeDefinition: () => {
        const { currentTheme } = get();
        return iconThemeRegistry.getTheme(currentTheme);
      },
    }),
    {
      name: "icon-theme-storage",
    },
  ),
);
