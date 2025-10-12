import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconThemeDefinition } from "@/extensions/icon-themes";
import { iconThemeRegistry } from "@/extensions/icon-themes";

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
