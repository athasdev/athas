import { createContext } from "react";

export interface MainTabBarHost {
  header: HTMLElement;
  content: HTMLElement;
}

export const MainTabBarHostContext = createContext<MainTabBarHost | null>(null);
