import { useMemo, useSyncExternalStore } from "react";
import { iconThemeRegistry } from "./icon-theme-registry";
import type { IconThemeDefinition } from "./types";
import { getVisibleIconThemes } from "./icon-theme-normalization";

const subscribeToIconThemeRegistry = (callback: () => void) =>
  iconThemeRegistry.onRegistryChange(callback);

const getIconThemeRegistrySnapshot = () => iconThemeRegistry.getVersion();

export function useRegisteredIconThemes(): IconThemeDefinition[] {
  const registryVersion = useSyncExternalStore(
    subscribeToIconThemeRegistry,
    getIconThemeRegistrySnapshot,
    getIconThemeRegistrySnapshot,
  );

  return useMemo(() => getVisibleIconThemes(iconThemeRegistry.getAllThemes()), [registryVersion]);
}
