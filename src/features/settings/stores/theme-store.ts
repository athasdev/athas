import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";

interface ThemeState {
  currentTheme: "light" | "dark";
  actions: ThemeActions;
}

interface ThemeActions {
  setTheme: (theme: "light" | "dark") => void;
}

export const useThemeStore = createSelectors(
  create<ThemeState>()((set) => ({
    currentTheme: document.documentElement.classList.contains("force-one-light") ? "light" : "dark",
    actions: {
      setTheme: (theme: "light" | "dark") => {
        set({ currentTheme: theme });
      },
    },
  })),
);
