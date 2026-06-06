import { useMemo, useSyncExternalStore } from "react";
import { iconThemeRegistry } from "./icon-theme-registry";
import type { IconThemeDefinition } from "./types";

const subscribeToIconThemeRegistry = (callback: () => void) =>
  iconThemeRegistry.onRegistryChange(callback);

const getIconThemeRegistrySnapshot = () => iconThemeRegistry.getVersion();

export function useRegisteredIconThemes(): IconThemeDefinition[] {
  const registryVersion = useSyncExternalStore(
    subscribeToIconThemeRegistry,
    getIconThemeRegistrySnapshot,
    getIconThemeRegistrySnapshot,
  );

  return useMemo(() => iconThemeRegistry.getAllThemes(), [registryVersion]);
}
