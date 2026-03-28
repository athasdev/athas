import { load, type Store } from "@tauri-apps/plugin-store";
import {
  defaultSettings,
  getDefaultSettingsSnapshot,
} from "@/features/settings/config/default-settings";
import type { Settings } from "@/features/settings/types/settings";

let storeInstance: Store;

async function initializeStoreDefaults(store: Store) {
  for (const [key, value] of Object.entries(defaultSettings)) {
    const current = await store.get(key);
    if (current === null || current === undefined) {
      await store.set(key, value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const merged = { ...value, ...current };
      await store.set(key, merged);
    }
  }
  await store.save();
}

export async function getSettingsStore() {
  if (!storeInstance) {
    storeInstance = await load("settings.json", {
      autoSave: true,
    } as Parameters<typeof load>[1]);
    await initializeStoreDefaults(storeInstance);
  }

  return storeInstance;
}

export async function loadSettingsFromStore(): Promise<Settings> {
  const store = await getSettingsStore();
  const loadedSettings = getDefaultSettingsSnapshot();

  for (const key of Object.keys(defaultSettings) as Array<keyof Settings>) {
    const value = await store.get(key);
    if (value !== null && value !== undefined) {
      (loadedSettings as Record<keyof Settings, Settings[keyof Settings]>)[key] =
        value as Settings[typeof key];
    }
  }

  return loadedSettings;
}

export async function saveSettingsToStore(settings: Partial<Settings>) {
  try {
    const store = await getSettingsStore();

    for (const [key, value] of Object.entries(settings)) {
      await store.set(key, value);
    }

    await store.save();
  } catch (error) {
    console.error("Failed to save settings to store:", error);
  }
}

let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingSettings: Partial<Settings> = {};

export function debouncedSaveSettingsToStore(settings: Partial<Settings>) {
  pendingSettings = { ...pendingSettings, ...settings };

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = setTimeout(() => {
    const settingsToSave = pendingSettings;
    pendingSettings = {};
    saveTimeout = null;
    void saveSettingsToStore(settingsToSave);
  }, 300);
}
