import { useMemo, useSyncExternalStore } from "react";
import { themeRegistry } from "./theme-registry";
import type { ThemeDefinition } from "./types";

const subscribeToThemeRegistry = (callback: () => void) => themeRegistry.onRegistryChange(callback);

const getThemeRegistrySnapshot = () => themeRegistry.getVersion();

export function useRegisteredThemes(): ThemeDefinition[] {
  const registryVersion = useSyncExternalStore(
    subscribeToThemeRegistry,
    getThemeRegistrySnapshot,
    getThemeRegistrySnapshot,
  );

  return useMemo(() => themeRegistry.getAllThemes(), [registryVersion]);
}
